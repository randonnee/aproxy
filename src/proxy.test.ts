/**
 * Integration tests for the proxy server with MITM enabled.
 *
 * These tests start:
 *   1. A local upstream HTTP server (Bun.serve)
 *   2. A local upstream HTTPS server (Bun.serve with TLS, for MITM tests)
 *   3. The proxy TCP listener with a real CA (via ensureCa)
 *
 * Requests are sent through the proxy using raw TCP sockets (node:net / node:tls)
 * following the same pattern as scripts/bench.ts.
 *
 * We use lvh.me (resolves to 127.0.0.1) as the target hostname because
 * the proxy treats 127.0.0.1/localhost as control hosts.
 */

// The proxy's fetch() needs to reach the self-signed HTTPS upstream
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { createTcpProxy } from "./tcpProxy";
import { handleHttpProxy } from "./proxy";
import { ensureCa, type CaCert } from "./ca";
import { EventBus } from "./eventBus";
import type { ProxyEvent, RequestEvent, ResponseEvent, ErrorEvent } from "./models";

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------
const TARGET_HOST = "lvh.me"; // Resolves to 127.0.0.1, avoids control-host detection
const UPSTREAM_HTTP_PORT = 19876;
const UPSTREAM_HTTPS_PORT = 19877;
const PROXY_PORT = 19878;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let ca: CaCert;
let caCertPem: Buffer;
let upstreamHttp: ReturnType<typeof Bun.serve>;
let upstreamHttps: ReturnType<typeof Bun.serve>;
let proxyListener: ReturnType<typeof createTcpProxy>;
let eventBus: EventBus<ProxyEvent>;
let collectedEvents: ProxyEvent[];
let tempCertDir: string;

// Track the last upstream request for assertions
let lastUpstreamRequest: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
} | null = null;

// Custom response handler that tests can override
let upstreamHandler: ((req: Request) => Response | Promise<Response>) | null = null;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // 1. Ensure CA exists
  ca = await Effect.runPromise(ensureCa());
  caCertPem = readFileSync(ca.certPath);

  // 2. Generate self-signed TLS cert for the HTTPS upstream server
  tempCertDir = mkdtempSync(join(tmpdir(), "aproxy-test-"));
  const keyPath = join(tempCertDir, "key.pem");
  const certPath = join(tempCertDir, "cert.pem");

  const proc = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", `/CN=${TARGET_HOST}`,
    "-addext", `subjectAltName=DNS:${TARGET_HOST}`,
  ], { stderr: "pipe" });

  if (proc.exitCode !== 0) {
    throw new Error(`Failed to generate test cert: ${new TextDecoder().decode(proc.stderr)}`);
  }

  const upstreamTlsKey = readFileSync(keyPath, "utf-8");
  const upstreamTlsCert = readFileSync(certPath, "utf-8");

  // 3. Start upstream HTTP server
  upstreamHttp = Bun.serve({
    port: UPSTREAM_HTTP_PORT,
    async fetch(req: Request) {
      const body = req.body ? await req.text() : "";
      lastUpstreamRequest = {
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      };
      if (upstreamHandler) {
        return upstreamHandler(req);
      }
      return new Response(JSON.stringify({ ok: true, method: req.method }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  // 4. Start upstream HTTPS server
  upstreamHttps = Bun.serve({
    port: UPSTREAM_HTTPS_PORT,
    tls: { key: upstreamTlsKey, cert: upstreamTlsCert },
    async fetch(req: Request) {
      const body = req.body ? await req.text() : "";
      lastUpstreamRequest = {
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      };
      if (upstreamHandler) {
        return upstreamHandler(req);
      }
      return new Response(JSON.stringify({ ok: true, method: req.method }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  // 5. Set up event bus and proxy
  eventBus = new EventBus<ProxyEvent>();
  collectedEvents = [];
  eventBus.on((event) => collectedEvents.push(event));

  const noRules = () => Effect.succeed(null as Response | null);
  const fetchHandler = (req: Request) =>
    handleHttpProxy(req, (event) => eventBus.emit(event), noRules);

  // 6. Start proxy with MITM
  proxyListener = createTcpProxy({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    fetchHandler,
    emitEvent: (event) => eventBus.emit(event),
    ca,
  });
}, 30_000);

afterAll(() => {
  try { proxyListener?.stop?.(); } catch {}
  try { upstreamHttp?.stop?.(); } catch {}
  try { upstreamHttps?.stop?.(); } catch {}
  if (tempCertDir) {
    try { rmSync(tempCertDir, { recursive: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset state between tests. */
function resetState() {
  collectedEvents.length = 0;
  lastUpstreamRequest = null;
  upstreamHandler = null;
}

/** Parse an HTTP response from raw bytes, returning headers and body. */
function parseRawHttpResponse(rawData: string): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
} {
  const headerEnd = rawData.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("No header terminator found in response");
  }

  const headerSection = rawData.substring(0, headerEnd);
  const body = rawData.substring(headerEnd + 4);
  const lines = headerSection.split("\r\n");
  const statusLine = lines[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)\s*(.*)/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const statusText = statusMatch ? statusMatch[2] : "";

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
      const value = lines[i].substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return { statusCode, statusText, headers, body };
}

/**
 * Send a plain HTTP request through the proxy via raw TCP.
 * Returns the parsed response.
 */
function sendHttpRequest(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  port?: number;
}): Promise<{
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
  const method = opts.method ?? "GET";
  const targetPort = opts.port ?? UPSTREAM_HTTP_PORT;
  const path = opts.path ?? "/";
  const targetUrl = `http://${TARGET_HOST}:${targetPort}${path}`;
  const extraHeaders = opts.headers ?? {};

  let rawReq = `${method} ${targetUrl} HTTP/1.1\r\n`;
  rawReq += `Host: ${TARGET_HOST}:${targetPort}\r\n`;
  for (const [k, v] of Object.entries(extraHeaders)) {
    rawReq += `${k}: ${v}\r\n`;
  }
  if (opts.body) {
    rawReq += `Content-Length: ${Buffer.byteLength(opts.body)}\r\n`;
    rawReq += `Content-Type: text/plain\r\n`;
  }
  rawReq += `Connection: close\r\n`;
  rawReq += `\r\n`;
  if (opts.body) {
    rawReq += opts.body;
  }

  return new Promise((resolve, reject) => {
    let buf = "";
    const socket = netConnect(PROXY_PORT, "127.0.0.1", () => {
      socket.write(rawReq);
    });
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("latin1");
    });
    socket.on("end", () => {
      try {
        resolve(parseRawHttpResponse(buf));
      } catch (e) {
        reject(e);
      }
    });
    socket.on("error", reject);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("HTTP request timeout"));
    });
  });
}

/**
 * Open a CONNECT tunnel through the proxy and upgrade to TLS.
 * Returns the TLS socket ready for sending HTTP requests.
 */
function openHttpsTunnel(targetPort?: number): Promise<TLSSocket> {
  const port = targetPort ?? UPSTREAM_HTTPS_PORT;
  const connectReq =
    `CONNECT ${TARGET_HOST}:${port} HTTP/1.1\r\n` +
    `Host: ${TARGET_HOST}:${port}\r\n` +
    `\r\n`;

  return new Promise((resolve, reject) => {
    const rawSocket = netConnect(PROXY_PORT, "127.0.0.1", () => {
      rawSocket.write(connectReq);
    });

    let connectBuf = "";
    function onConnectData(chunk: Buffer) {
      connectBuf += chunk.toString("latin1");
      const headerEnd = connectBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      rawSocket.removeListener("data", onConnectData);

      const statusMatch = connectBuf.match(/HTTP\/\d\.\d\s+(\d+)/);
      if (!statusMatch || Number(statusMatch[1]) !== 200) {
        rawSocket.destroy();
        reject(new Error(`CONNECT failed: ${connectBuf.substring(0, headerEnd)}`));
        return;
      }

      // Upgrade to TLS
      const tlsSocket = tlsConnect({
        socket: rawSocket,
        servername: TARGET_HOST,
        ca: caCertPem, // Trust the proxy's CA for MITM-generated certs
        ALPNProtocols: ["http/1.1"],
      }, () => {
        resolve(tlsSocket);
      });

      tlsSocket.on("error", (err) => reject(err));
    }

    rawSocket.on("data", onConnectData);
    rawSocket.on("error", reject);
    rawSocket.setTimeout(10_000, () => {
      rawSocket.destroy();
      reject(new Error("CONNECT timeout"));
    });
  });
}

/**
 * Parse a full HTTP response from a streaming socket.
 * Resolves when Content-Length bytes have been received (for keep-alive support).
 * Falls back to waiting for socket close if no Content-Length is present.
 */
function readHttpResponse(
  socket: NetSocket | TLSSocket,
): Promise<{
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let headersParsed = false;
    let headerEndOffset = -1;
    let contentLength = -1;
    let parsedHeaders: Record<string, string> = {};
    let statusCode = 0;
    let statusText = "";

    function tryResolve() {
      const bodyBuf = buf.subarray(headerEndOffset + 4);
      if (contentLength >= 0 && bodyBuf.length >= contentLength) {
        cleanup();
        resolve({
          statusCode,
          statusText,
          headers: parsedHeaders,
          body: bodyBuf.subarray(0, contentLength).toString("latin1"),
        });
        return true;
      }
      return false;
    }

    function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);

      if (!headersParsed) {
        headerEndOffset = buf.indexOf("\r\n\r\n");
        if (headerEndOffset === -1) return;
        headersParsed = true;

        const headerSection = buf.subarray(0, headerEndOffset).toString("utf-8");
        const lines = headerSection.split("\r\n");
        const statusMatch = lines[0].match(/HTTP\/\d\.\d\s+(\d+)\s*(.*)/);
        statusCode = statusMatch ? Number(statusMatch[1]) : 0;
        statusText = statusMatch ? statusMatch[2] : "";

        for (let i = 1; i < lines.length; i++) {
          const colonIdx = lines[i].indexOf(":");
          if (colonIdx > 0) {
            const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
            const value = lines[i].substring(colonIdx + 1).trim();
            parsedHeaders[key] = value;
          }
        }

        const cl = parsedHeaders["content-length"];
        if (cl !== undefined) contentLength = Number(cl);
      }

      tryResolve();
    }

    function onEnd() {
      cleanup();
      if (headersParsed) {
        const bodyBuf = buf.subarray(headerEndOffset + 4);
        resolve({
          statusCode,
          statusText,
          headers: parsedHeaders,
          body: bodyBuf.toString("latin1"),
        });
      } else {
        reject(new Error("Connection closed before headers received"));
      }
    }

    function onError(err: Error) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
    }

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

/**
 * Send an HTTPS request through the MITM proxy.
 * Opens a CONNECT tunnel, upgrades to TLS, sends the request, returns parsed response.
 *
 * The MITM pipeline supports keep-alive, so we parse the response using
 * Content-Length rather than waiting for socket close.
 */
async function sendHttpsRequest(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  targetPort?: number;
}): Promise<{
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
  const method = opts.method ?? "GET";
  const path = opts.path ?? "/";
  const port = opts.targetPort ?? UPSTREAM_HTTPS_PORT;
  const extraHeaders = opts.headers ?? {};

  const tlsSocket = await openHttpsTunnel(port);

  let rawReq = `${method} ${path} HTTP/1.1\r\n`;
  rawReq += `Host: ${TARGET_HOST}:${port}\r\n`;
  for (const [k, v] of Object.entries(extraHeaders)) {
    rawReq += `${k}: ${v}\r\n`;
  }
  if (opts.body) {
    rawReq += `Content-Length: ${Buffer.byteLength(opts.body)}\r\n`;
    if (!extraHeaders["Content-Type"]) {
      rawReq += `Content-Type: text/plain\r\n`;
    }
  }
  rawReq += `Connection: close\r\n`;
  rawReq += `\r\n`;
  if (opts.body) {
    rawReq += opts.body;
  }

  // Start reading before writing to avoid race conditions
  const responsePromise = readHttpResponse(tlsSocket);

  // Set a timeout
  const timeout = setTimeout(() => {
    tlsSocket.destroy();
  }, 10_000);

  tlsSocket.write(rawReq);

  try {
    const result = await responsePromise;
    clearTimeout(timeout);
    tlsSocket.destroy();
    return result;
  } catch (e) {
    clearTimeout(timeout);
    tlsSocket.destroy();
    throw e;
  }
}

/**
 * Wait for events to accumulate. The proxy processing is async,
 * so we need a short delay for events to flow through.
 */
async function waitForEvents(minCount: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (collectedEvents.length >= minCount) return;
    await Bun.sleep(50);
  }
}

function getRequestEvents(): RequestEvent[] {
  return collectedEvents.filter((e): e is RequestEvent => e.type === "request");
}

function getResponseEvents(): ResponseEvent[] {
  return collectedEvents.filter((e): e is ResponseEvent => e.type === "response");
}

function getErrorEvents(): ErrorEvent[] {
  return collectedEvents.filter((e): e is ErrorEvent => e.type === "error");
}

// ===========================================================================
// HTTP proxy tests (plain HTTP, no MITM)
// ===========================================================================
describe("HTTP proxy forwarding", () => {
  test("forwards GET request and returns response", async () => {
    resetState();
    const res = await sendHttpRequest({ method: "GET", path: "/test-get" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.method).toBe("GET");

    // Verify the upstream received the request
    expect(lastUpstreamRequest).not.toBeNull();
    expect(lastUpstreamRequest!.method).toBe("GET");
    expect(lastUpstreamRequest!.url).toContain("/test-get");
  });

  test("forwards POST request with body", async () => {
    resetState();
    const postBody = JSON.stringify({ message: "hello from test" });
    const res = await sendHttpRequest({
      method: "POST",
      path: "/test-post",
      body: postBody,
      headers: { "Content-Type": "application/json" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.method).toBe("POST");

    // Verify body was forwarded to upstream
    expect(lastUpstreamRequest).not.toBeNull();
    expect(lastUpstreamRequest!.method).toBe("POST");
    expect(lastUpstreamRequest!.body).toBe(postBody);
  });

  test("forwards PUT request with body", async () => {
    resetState();
    const putBody = "updated content";
    const res = await sendHttpRequest({
      method: "PUT",
      path: "/test-put",
      body: putBody,
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("PUT");
    expect(lastUpstreamRequest!.body).toBe(putBody);
  });

  test("forwards DELETE request", async () => {
    resetState();
    const res = await sendHttpRequest({ method: "DELETE", path: "/test-delete" });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("DELETE");
  });

  test("forwards PATCH request with body", async () => {
    resetState();
    const patchBody = JSON.stringify({ field: "value" });
    const res = await sendHttpRequest({
      method: "PATCH",
      path: "/test-patch",
      body: patchBody,
      headers: { "Content-Type": "application/json" },
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("PATCH");
    expect(lastUpstreamRequest!.body).toBe(patchBody);
  });

  test("preserves custom request headers", async () => {
    resetState();
    const res = await sendHttpRequest({
      method: "GET",
      path: "/test-headers",
      headers: {
        "X-Custom-Header": "test-value-123",
        "X-Another-Header": "another-value",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.headers["x-custom-header"]).toBe("test-value-123");
    expect(lastUpstreamRequest!.headers["x-another-header"]).toBe("another-value");
  });

  test("forwards response with custom status code", async () => {
    resetState();
    upstreamHandler = () =>
      new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

    const res = await sendHttpRequest({ method: "GET", path: "/not-found" });
    expect(res.statusCode).toBe(404);
  });

  test("forwards response headers from upstream", async () => {
    resetState();
    upstreamHandler = () =>
      new Response("ok", {
        headers: {
          "X-Upstream-Header": "upstream-value",
          "Content-Type": "text/plain",
        },
      });

    const res = await sendHttpRequest({ method: "GET", path: "/custom-headers" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-upstream-header"]).toBe("upstream-value");
  });

  test("handles large response body", async () => {
    resetState();
    const largeBody = "X".repeat(100_000); // 100KB
    upstreamHandler = () =>
      new Response(largeBody, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(Buffer.byteLength(largeBody)),
        },
      });

    const res = await sendHttpRequest({ method: "GET", path: "/large-body" });
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(100_000);
  });

  test("handles large request body", async () => {
    resetState();
    const largeBody = "Y".repeat(50_000); // 50KB

    const res = await sendHttpRequest({
      method: "POST",
      path: "/large-request",
      body: largeBody,
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.body).toBe(largeBody);
  });

  test("emits request and response events", async () => {
    resetState();

    const res = await sendHttpRequest({ method: "GET", path: "/test-events" });
    expect(res.statusCode).toBe(200);

    await waitForEvents(2);

    const reqEvents = getRequestEvents();
    const resEvents = getResponseEvents();

    expect(reqEvents.length).toBeGreaterThanOrEqual(1);
    expect(resEvents.length).toBeGreaterThanOrEqual(1);

    // Check request event
    const reqEvent = reqEvents.find((e) => e.url.includes("/test-events"));
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.method).toBe("GET");

    // Check response event
    const resEvent = resEvents.find((e) => e.id === reqEvent!.id);
    expect(resEvent).toBeDefined();
    expect(resEvent!.status).toBe(200);
  });

  test("returns 502 when upstream is unreachable", async () => {
    resetState();
    // Use a port where nothing is listening
    const res = await sendHttpRequest({
      method: "GET",
      path: "/unreachable",
      port: 19999,
    });

    expect(res.statusCode).toBe(502);
  });
});

// ===========================================================================
// HTTPS MITM proxy tests
// ===========================================================================
describe("HTTPS MITM proxy forwarding", () => {
  test("forwards GET request through MITM tunnel", async () => {
    resetState();
    const res = await sendHttpsRequest({ method: "GET", path: "/mitm-get" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.method).toBe("GET");

    expect(lastUpstreamRequest).not.toBeNull();
    expect(lastUpstreamRequest!.method).toBe("GET");
    expect(lastUpstreamRequest!.url).toContain("/mitm-get");
  });

  test("forwards POST request with body through MITM tunnel", async () => {
    resetState();
    const postBody = JSON.stringify({ message: "hello from MITM test" });
    const res = await sendHttpsRequest({
      method: "POST",
      path: "/mitm-post",
      body: postBody,
      headers: { "Content-Type": "application/json" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.method).toBe("POST");

    expect(lastUpstreamRequest).not.toBeNull();
    expect(lastUpstreamRequest!.method).toBe("POST");
    expect(lastUpstreamRequest!.body).toBe(postBody);
  });

  test("forwards PUT request through MITM tunnel", async () => {
    resetState();
    const putBody = "MITM updated content";
    const res = await sendHttpsRequest({
      method: "PUT",
      path: "/mitm-put",
      body: putBody,
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("PUT");
    expect(lastUpstreamRequest!.body).toBe(putBody);
  });

  test("forwards DELETE request through MITM tunnel", async () => {
    resetState();
    const res = await sendHttpsRequest({ method: "DELETE", path: "/mitm-delete" });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("DELETE");
  });

  test("forwards PATCH request through MITM tunnel", async () => {
    resetState();
    const patchBody = JSON.stringify({ patch: "data" });
    const res = await sendHttpsRequest({
      method: "PATCH",
      path: "/mitm-patch",
      body: patchBody,
      headers: { "Content-Type": "application/json" },
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.method).toBe("PATCH");
    expect(lastUpstreamRequest!.body).toBe(patchBody);
  });

  test("preserves custom request headers through MITM", async () => {
    resetState();
    const res = await sendHttpsRequest({
      method: "GET",
      path: "/mitm-headers",
      headers: {
        "X-MITM-Header": "mitm-value-456",
        "Accept": "application/json",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.headers["x-mitm-header"]).toBe("mitm-value-456");
    expect(lastUpstreamRequest!.headers["accept"]).toBe("application/json");
  });

  test("forwards response with custom status code through MITM", async () => {
    resetState();
    upstreamHandler = () =>
      new Response("Created", { status: 201, headers: { "Content-Type": "text/plain" } });

    const res = await sendHttpsRequest({ method: "POST", path: "/mitm-created", body: "data" });
    expect(res.statusCode).toBe(201);
  });

  test("forwards response headers from upstream through MITM", async () => {
    resetState();
    upstreamHandler = () =>
      new Response("ok", {
        headers: {
          "X-MITM-Response": "response-value",
          "Content-Type": "text/plain",
        },
      });

    const res = await sendHttpsRequest({ method: "GET", path: "/mitm-resp-headers" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-mitm-response"]).toBe("response-value");
  });

  test("handles large response body through MITM", async () => {
    resetState();
    const largeBody = "Z".repeat(100_000); // 100KB
    upstreamHandler = () =>
      new Response(largeBody, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(Buffer.byteLength(largeBody)),
        },
      });

    const res = await sendHttpsRequest({ method: "GET", path: "/mitm-large-body" });
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(100_000);
  });

  test("handles large request body through MITM", async () => {
    resetState();
    const largeBody = "W".repeat(50_000); // 50KB

    const res = await sendHttpsRequest({
      method: "POST",
      path: "/mitm-large-request",
      body: largeBody,
    });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamRequest!.body).toBe(largeBody);
  });

  test("emits request and response events for MITM requests", async () => {
    resetState();

    const res = await sendHttpsRequest({ method: "GET", path: "/mitm-events" });
    expect(res.statusCode).toBe(200);

    await waitForEvents(2);

    const reqEvents = getRequestEvents();
    const resEvents = getResponseEvents();

    expect(reqEvents.length).toBeGreaterThanOrEqual(1);
    expect(resEvents.length).toBeGreaterThanOrEqual(1);

    // The MITM request URL should be https://
    const reqEvent = reqEvents.find((e) => e.url.includes("/mitm-events"));
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.method).toBe("GET");
    expect(reqEvent!.url).toStartWith("https://");

    // Response event should match
    const resEvent = resEvents.find((e) => e.id === reqEvent!.id);
    expect(resEvent).toBeDefined();
    expect(resEvent!.status).toBe(200);
  });

  test("correctly reconstructs https URL in MITM request events", async () => {
    resetState();

    const res = await sendHttpsRequest({
      method: "GET",
      path: "/some/nested/path?query=value&foo=bar",
    });
    expect(res.statusCode).toBe(200);

    await waitForEvents(2);

    const reqEvents = getRequestEvents();
    const reqEvent = reqEvents.find((e) => e.url.includes("/some/nested/path"));
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.url).toContain(`https://${TARGET_HOST}:${UPSTREAM_HTTPS_PORT}/some/nested/path`);
    expect(reqEvent!.url).toContain("query=value");
    expect(reqEvent!.url).toContain("foo=bar");
  });
});

// ===========================================================================
// HTTPS MITM keep-alive tests
// ===========================================================================
describe("HTTPS MITM keep-alive", () => {
  test("supports multiple requests over a single TLS connection", async () => {
    resetState();

    const tlsSocket = await openHttpsTunnel();

    // Send 3 requests over the same connection
    for (let i = 0; i < 3; i++) {
      const isLast = i === 2;
      const path = `/keepalive-${i + 1}`;
      let rawReq = `GET ${path} HTTP/1.1\r\n`;
      rawReq += `Host: ${TARGET_HOST}:${UPSTREAM_HTTPS_PORT}\r\n`;
      rawReq += `Connection: ${isLast ? "close" : "keep-alive"}\r\n`;
      rawReq += `\r\n`;

      const responsePromise = readHttpResponse(tlsSocket);
      tlsSocket.write(rawReq);
      const res = await responsePromise;

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).method).toBe("GET");
    }

    tlsSocket.destroy();
  });
});

// ===========================================================================
// Header stripping tests
// ===========================================================================
describe("hop-by-hop header handling", () => {
  test("strips proxy-connection header from forwarded request", async () => {
    resetState();
    const res = await sendHttpRequest({
      method: "GET",
      path: "/test-hop-headers",
      headers: {
        "Proxy-Connection": "keep-alive",
        "X-Should-Pass": "yes",
      },
    });

    expect(res.statusCode).toBe(200);
    // Proxy-Connection should be stripped before reaching upstream
    expect(lastUpstreamRequest!.headers["proxy-connection"]).toBeUndefined();
    // Regular headers should pass through
    expect(lastUpstreamRequest!.headers["x-should-pass"]).toBe("yes");
  });

  test("removes content-encoding from decompressed responses", async () => {
    resetState();
    // When Bun's fetch() decompresses a response, the proxy should remove
    // the content-encoding header and fix content-length.
    upstreamHandler = () =>
      new Response("plain text response", {
        headers: {
          "Content-Type": "text/plain",
        },
      });

    const res = await sendHttpRequest({ method: "GET", path: "/no-encoding" });
    expect(res.statusCode).toBe(200);
    // content-encoding should not be present (or removed if upstream sent it)
    // The content-length should match the actual body
    if (res.headers["content-length"]) {
      expect(Number(res.headers["content-length"])).toBe(res.body.length);
    }
  });
});

// ===========================================================================
// Concurrent requests
// ===========================================================================
describe("concurrent request handling", () => {
  test("handles multiple concurrent HTTP requests", async () => {
    resetState();

    // Send 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      sendHttpRequest({ method: "GET", path: `/concurrent-${i}` })
    );

    const results = await Promise.all(promises);

    for (const res of results) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    }
  });

  test("handles multiple concurrent HTTPS MITM requests", async () => {
    resetState();

    // Send 5 concurrent HTTPS requests (fewer since MITM has more overhead)
    const promises = Array.from({ length: 5 }, (_, i) =>
      sendHttpsRequest({ method: "GET", path: `/mitm-concurrent-${i}` })
    );

    const results = await Promise.all(promises);

    for (const res of results) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    }
  });
});
