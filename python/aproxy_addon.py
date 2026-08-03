"""aproxy <-> mitmproxy bridge addon.

Runs inside ``mitmdump`` and forwards every flow to the aproxy Bun control
server so the existing SSE/React UI and TypeScript rule sandbox keep working
unchanged.

Protocol (all POSTs to the control server, JSON in / JSON out):

  POST /_mitm/request   -> emits the ``request`` event AND returns the rule
                           decision: ``{"mock": null}`` or
                           ``{"mock": {"status", "headers", "bodyBase64"}}``
  POST /_mitm/response  -> emits the ``response`` event
  POST /_mitm/error     -> emits the ``error`` event
  POST /_mitm/ws        -> emits ``ws_open`` / ``ws_message`` / ``ws_close``

Only ``/_mitm/request`` blocks the flow; everything else is queued onto a
single background thread so ordering within a flow is preserved without
stalling mitmproxy's event loop.

Configuration comes from the environment (set by ``src/mitmBackend.ts``):

  APROXY_CONTROL_URL           base URL of the Bun control server
  APROXY_BRIDGE_TOKEN          shared secret sent as ``X-Aproxy-Token``
  APROXY_MAX_BODY_BYTES        bodies larger than this are reported as truncated
  APROXY_INTERCEPT_TIMEOUT_MS  budget for the blocking rule lookup
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import queue
import sys
import threading
import time
from http.client import HTTPConnection
from typing import Any, Optional
from urllib.parse import urlparse

from mitmproxy import http


def _log(message: str) -> None:
    """Report addon diagnostics to the supervisor.

    mitmdump runs with ``flow_detail=0`` so its own per-flow logging (and the
    stdlib ``logging`` bridge it installs) is silenced. Writing straight to
    stderr is the only channel that still reaches ``src/mitmBackend.ts``.

    Never raises: stderr is a pipe to the supervisor, so once that process is
    gone every write fails with ``BrokenPipeError``. Diagnostics must not take
    down the caller — especially the shutdown watchdog.
    """
    try:
        print(f"[addon] {message}", file=sys.stderr, flush=True)
    except Exception:  # noqa: BLE001 - logging is always best-effort
        pass


CONTROL_URL = os.environ.get("APROXY_CONTROL_URL", "http://127.0.0.1:8080")
BRIDGE_TOKEN = os.environ.get("APROXY_BRIDGE_TOKEN", "")
MAX_BODY_BYTES = int(os.environ.get("APROXY_MAX_BODY_BYTES", str(1024 * 1024)))
INTERCEPT_TIMEOUT = int(os.environ.get("APROXY_INTERCEPT_TIMEOUT_MS", "10000")) / 1000
EVENT_TIMEOUT = 10.0
EVENT_QUEUE_MAX = 10_000

MEDIA_PREFIXES = ("image/", "video/", "audio/")
HOP_BY_HOP = frozenset(
    {"content-length", "transfer-encoding", "connection", "keep-alive", "upgrade"}
)

# Set by src/mitmBackend.ts so we can spot requests aimed at our own listener.
LISTEN_HOST = os.environ.get("APROXY_LISTEN_HOST", "127.0.0.1").lower()
LISTEN_PORT = int(os.environ.get("APROXY_LISTEN_PORT", "0") or 0)
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})

SELF_REQUEST_BODY = (
    b"This port is the aproxy proxy listener, not an origin server.\n"
    b"Configure this address as an HTTP proxy instead of requesting it directly.\n"
)


def _is_self_addressed(request: Any) -> bool:
    """True when a client requested the proxy's own address as an origin server.

    Clients that expect some other service on this port (React Native's Metro
    bundler is the classic one — its default port is 8081) send origin-form
    requests whose Host header points back at us. mitmproxy cannot forward
    those anywhere, so each one becomes a request event plus a "destination
    unknown" error. Recognising them keeps that noise out of the UI.
    """
    if not LISTEN_PORT or request.port != LISTEN_PORT:
        return False
    host = (request.host or "").strip("[]").lower()
    return host in LOOPBACK_HOSTS or host == LISTEN_HOST


def _now_ms() -> int:
    return int(time.time() * 1000)


def _watch_parent(interval: float = 2.0) -> None:
    """Exit when the supervising aproxy process goes away.

    ``src/mitmBackend.ts`` kills this process on a clean shutdown, but that only
    covers cooperative exits — a SIGKILL, a crash, or a host runtime that
    swallows signals (Electrobun does) would otherwise leave mitmdump running
    and holding the proxy port, with the system proxy still pointing at it.
    Polling the parent PID is cheap and covers every one of those cases.
    """
    original = os.getppid()
    while True:
        time.sleep(interval)
        # Reparented to launchd/init means the supervisor is gone.
        current = os.getppid()
        if current != original or current == 1:
            _log("supervisor exited, shutting down")
            os._exit(0)


def _to_ms(timestamp: Optional[float]) -> int:
    return int(timestamp * 1000) if timestamp else _now_ms()


class ControlClient:
    """Minimal keep-alive JSON client for the local Bun control server.

    ``HTTPConnection`` is not thread-safe, so each thread gets its own
    connection via thread-local storage.
    """

    def __init__(self, base_url: str, token: str) -> None:
        parsed = urlparse(base_url)
        self._host = parsed.hostname or "127.0.0.1"
        self._port = parsed.port or (443 if parsed.scheme == "https" else 80)
        self._token = token
        self._local = threading.local()

    def _connection(self, timeout: float) -> HTTPConnection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = HTTPConnection(self._host, self._port, timeout=timeout)
            self._local.conn = conn
        conn.timeout = timeout
        return conn

    def _drop_connection(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        self._local.conn = None

    def post(self, path: str, payload: dict, timeout: float) -> Optional[dict]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "X-Aproxy-Token": self._token,
        }
        # One retry: a pooled keep-alive connection may have been closed by the
        # server between requests, which surfaces as an exception on send.
        for attempt in (0, 1):
            try:
                conn = self._connection(timeout)
                conn.request("POST", path, body=body, headers=headers)
                response = conn.getresponse()
                raw = response.read()
                if response.status >= 400:
                    raise RuntimeError(f"{path} -> HTTP {response.status}")
                return json.loads(raw) if raw else None
            except Exception:
                self._drop_connection()
                if attempt == 1:
                    raise
        return None


class EventSender:
    """Serialises fire-and-forget events onto a single background thread."""

    def __init__(self, client: ControlClient) -> None:
        self._client = client
        self._queue: queue.Queue = queue.Queue(maxsize=EVENT_QUEUE_MAX)
        self._dropped = 0
        self._warned = False
        self._thread = threading.Thread(target=self._run, name="aproxy-events", daemon=True)
        self._thread.start()

    def send(self, path: str, payload: dict) -> None:
        try:
            self._queue.put_nowait((path, payload))
        except queue.Full:
            self._dropped += 1
            if self._dropped % 100 == 1:
                _log(f"event queue full, dropped {self._dropped} events")

    def _run(self) -> None:
        while True:
            path, payload = self._queue.get()
            try:
                self._client.post(path, payload, EVENT_TIMEOUT)
            except Exception as exc:  # noqa: BLE001 - never kill the sender thread
                if not self._warned:
                    self._warned = True
                    _log(f"failed to deliver {path}: {exc}")
            else:
                self._warned = False
            finally:
                self._queue.task_done()


def _headers_to_dict(headers: Any) -> dict:
    """Flatten mitmproxy headers to the lowercase record the UI expects.

    Repeated headers are joined with ", " to match the Fetch API semantics used
    by the built-in backend.
    """
    record: dict = {}
    try:
        items = headers.items(multi=True)
    except TypeError:
        items = headers.items()
    for key, value in items:
        key = key.lower()
        record[key] = f"{record[key]}, {value}" if key in record else value
    return record


def _safe_content(message: Any) -> Optional[bytes]:
    """Read a decoded body, tolerating streamed or undecodable payloads."""
    if message is None:
        return None
    try:
        return message.content
    except Exception:
        try:
            return message.raw_content
        except Exception:
            return None


def _body_fields(content: Optional[bytes], content_type: str, allow_base64: bool) -> dict:
    if not content:
        return {}
    if len(content) > MAX_BODY_BYTES:
        return {"bodyTruncated": True}
    if allow_base64 and content_type.lower().startswith(MEDIA_PREFIXES):
        return {"bodyBase64": base64.b64encode(content).decode("ascii"), "bodyEncoding": "base64"}
    try:
        return {"body": content.decode("utf-8")}
    except UnicodeDecodeError:
        if not allow_base64:
            return {}
        return {"bodyBase64": base64.b64encode(content).decode("ascii"), "bodyEncoding": "base64"}


class AproxyBridge:
    def __init__(self) -> None:
        self._client = ControlClient(CONTROL_URL, BRIDGE_TOKEN)
        self._events = EventSender(self._client)
        self._warned = False
        self._self_warned: set = set()
        threading.Thread(target=_watch_parent, name="aproxy-parent-watch", daemon=True).start()

    def _reject_self_request(self, flow: http.HTTPFlow) -> None:
        """Answer a request aimed at our own port without reporting it."""
        path = flow.request.path.split("?", 1)[0]
        if path not in self._self_warned:
            self._self_warned.add(path)
            _log(
                f"ignoring request to the proxy's own address ({flow.request.host}:"
                f"{flow.request.port}{path}) — a client expects a different service here"
            )
        flow.metadata["aproxy_ignore"] = True
        flow.response = http.Response.make(
            421, SELF_REQUEST_BODY, {"content-type": "text/plain; charset=utf-8"}
        )

    # --- HTTP ---------------------------------------------------------------

    async def request(self, flow: http.HTTPFlow) -> None:
        request = flow.request
        if _is_self_addressed(request):
            self._reject_self_request(flow)
            return

        content = _safe_content(request)
        event = {
            "type": "request",
            "id": flow.id,
            "method": request.method,
            "url": request.pretty_url,
            "headers": _headers_to_dict(request.headers),
            "timestamp": _to_ms(request.timestamp_start),
        }
        # RequestEvent only carries text bodies, matching the built-in backend.
        event.update(
            _body_fields(content, request.headers.get("content-type", ""), allow_base64=False)
        )

        try:
            result = await asyncio.to_thread(
                self._client.post, "/_mitm/request", event, INTERCEPT_TIMEOUT
            )
        except Exception as exc:  # noqa: BLE001 - never break traffic on bridge failure
            if not self._warned:
                self._warned = True
                _log(f"control server unreachable ({exc}); passing traffic through")
            return
        self._warned = False

        mock = (result or {}).get("mock")
        if not mock:
            return

        body = base64.b64decode(mock.get("bodyBase64") or "")
        headers = {
            key: value
            for key, value in (mock.get("headers") or {}).items()
            if key.lower() not in HOP_BY_HOP
        }
        flow.metadata["aproxy_mocked"] = True
        flow.response = http.Response.make(int(mock.get("status", 200)), body, headers)

    def response(self, flow: http.HTTPFlow) -> None:
        response = flow.response
        if response is None:
            return
        # Never emitted a request event for these, so skip the response too.
        if flow.metadata.get("aproxy_ignore"):
            return
        # 101 upgrades are reported through the websocket hooks instead.
        if response.status_code == 101:
            return

        content = _safe_content(response)
        started = flow.request.timestamp_start or 0
        ended = response.timestamp_end or time.time()
        event = {
            "type": "response",
            "id": flow.id,
            "status": response.status_code,
            "headers": _headers_to_dict(response.headers),
            "durationMs": max(0, int((ended - started) * 1000)) if started else 0,
            "timestamp": _to_ms(ended),
            "mocked": bool(flow.metadata.get("aproxy_mocked")),
        }
        event.update(
            _body_fields(content, response.headers.get("content-type", ""), allow_base64=True)
        )
        self._events.send("/_mitm/response", event)

    def error(self, flow: http.HTTPFlow) -> None:
        if flow.metadata.get("aproxy_ignore"):
            return
        message = str(flow.error) if flow.error else "Proxy error"
        self._events.send(
            "/_mitm/error",
            {"type": "error", "id": flow.id, "message": message, "timestamp": _now_ms()},
        )

    # --- WebSocket ----------------------------------------------------------

    def websocket_start(self, flow: http.HTTPFlow) -> None:
        self._events.send(
            "/_mitm/ws",
            {
                "type": "ws_open",
                "id": flow.id,
                "url": flow.request.pretty_url,
                "headers": _headers_to_dict(flow.request.headers),
                "responseHeaders": _headers_to_dict(flow.response.headers) if flow.response else {},
                "timestamp": _now_ms(),
            },
        )

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        if flow.websocket is None or not flow.websocket.messages:
            return
        message = flow.websocket.messages[-1]
        binary = not message.is_text
        if binary:
            data = base64.b64encode(message.content).decode("ascii")
        else:
            data = message.content.decode("utf-8", errors="replace")
        self._events.send(
            "/_mitm/ws",
            {
                "type": "ws_message",
                "id": flow.id,
                "direction": "send" if message.from_client else "receive",
                "data": data,
                "binary": binary,
                "size": len(message.content),
                "timestamp": _now_ms(),
            },
        )

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self._events.send(
            "/_mitm/ws", {"type": "ws_close", "id": flow.id, "timestamp": _now_ms()}
        )


addons = [AproxyBridge()]
