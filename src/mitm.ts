import type { Socket } from "bun";
import type { ProxyEvent } from "./models";
import type { CaCert } from "./ca";
import { getHostCert } from "./ca";
import { Effect } from "effect";
import { isWebSocketUpgrade, headersToRecord } from "./http";
import { createFrameParser } from "./wsFrameParser";

/**
 * MITM tunnel handler for HTTPS interception.
 *
 * Instead of blindly piping TCP bytes, this:
 * 1. Sends 200 Connection Established to the client
 * 2. Starts a local TLS listener with a per-host certificate (signed by our CA)
 * 3. Bridges the client socket to the local TLS listener
 * 4. Parses decrypted HTTP requests inside the TLS connection
 * 5. Forwards them through the standard proxy pipeline (fetch to upstream)
 * 6. Returns responses back through the TLS connection to the client
 */

type FetchHandler = (req: Request) => Effect.Effect<Response, any>;

/** Context for a MITM connection, shared via closure instead of socket.data */
type MitmContext = {
  /** Accumulated bytes for HTTP header parsing */
  buffer: Buffer;
  /** The hostname being intercepted */
  hostname: string;
  /** The port being intercepted */
  port: number;
  /** Callback to emit proxy events */
  emitEvent: (event: ProxyEvent) => void;
  /** The fetch handler (route handler / proxy pipeline) */
  fetchHandler: FetchHandler;
  /** Whether a request is currently being processed (prevents concurrent handling) */
  processing: boolean;
  /** Parser state: "headers" = waiting for full headers, "body" = waiting for full body, "websocket" = raw piping mode */
  state: "headers" | "body" | "websocket";
  /** Parsed request info (set during "body" state while waiting for body bytes) */
  pendingRequest?: {
    method: string;
    path: string;
    headers: Headers;
    expectedBodyLength: number;
  };
  /** Resolve function for the current drain wait (backpressure) */
  drainResolve?: () => void;
  /** Upstream socket for WebSocket piping mode */
  wsUpstream?: Socket<any>;
  /** Request ID for emitting WebSocket message events */
  wsRequestId?: string;
  /** Frame parser for client->server (send) direction */
  wsClientParser?: (data: Buffer | Uint8Array) => void;
  /** Frame parser for server->client (receive) direction */
  wsServerParser?: (data: Buffer | Uint8Array) => void;
};

/**
 * Write data to a socket, waiting for drain if the socket buffer is full.
 * Handles partial writes by retrying remaining bytes after each drain.
 */
async function socketWrite(socket: Socket<{}>, data: string | Uint8Array, ctx: MitmContext): Promise<void> {
  // Convert string to Buffer so we can slice it for partial writes
  let buf: Uint8Array = typeof data === "string" ? Buffer.from(data) : data;
  let offset = 0;

  while (offset < buf.length) {
    const slice = offset === 0 ? buf : buf.subarray(offset);
    const written = socket.write(slice);
    if (written === 0) {
      // Socket buffer completely full — wait for drain
      await new Promise<void>((resolve) => {
        ctx.drainResolve = resolve;
      });
      ctx.drainResolve = undefined;
    } else {
      offset += written;
      if (offset < buf.length) {
        // Partial write — wait for drain before sending the rest
        await new Promise<void>((resolve) => {
          ctx.drainResolve = resolve;
        });
        ctx.drainResolve = undefined;
      }
    }
  }
}

/**
 * Handle a CONNECT request with MITM interception.
 *
 * We start a local TLS listener on an ephemeral port, send 200 to the client,
 * then bridge the client socket to the TLS listener. The TLS listener decrypts
 * the traffic, parses HTTP requests, and forwards them through the proxy.
 */
export async function handleMitm(
  clientSocket: Socket<any>,
  host: string,
  port: number,
  pendingData: Buffer[],
  emitEvent: (event: ProxyEvent) => void,
  ca: CaCert,
  fetchHandler: FetchHandler
): Promise<void> {
  try {
    // Generate a per-host certificate
    const hostCert = await getHostCert(host, ca);

    // Create the context via closure (avoids socket.data timing issues)
    const ctx: MitmContext = {
      buffer: Buffer.alloc(0),
      hostname: host,
      port,
      emitEvent,
      fetchHandler,
      processing: false,
      state: "headers",
    };

    // Start a local TLS listener on an ephemeral port
    const tlsListener = Bun.listen<{}>({
      hostname: "127.0.0.1",
      port: 0, // ephemeral
      tls: {
        key: hostCert.keyPem,
        cert: hostCert.certPem + "\n" + ca.certPem, // chain: leaf + CA
        // ALPN: Bun accepts a wire-format Buffer (length-prefixed protocol names)
        // \x08 = 8 bytes for "http/1.1"
        ALPNProtocols: Buffer.from("\x08http/1.1"),
      },
      socket: {
        open(_socket) {
          // Context is captured via closure, no socket.data needed
        },
        data(socket, data) {
          // Accumulate decrypted HTTP data and process
          handleDecryptedData(socket, data, ctx);
        },
        drain(socket) {
          // Socket buffer drained — resolve any pending write
          ctx.drainResolve?.();
        },
        close(_socket) {
          // TLS client disconnected — close WebSocket upstream if active
          if (ctx.state === "websocket" && ctx.wsUpstream) {
            ctx.wsUpstream.end();
          }
        },
        error(_socket, error) {
          console.error(`[mitm] TLS socket error for ${host}:${port}:`, error?.message ?? error);
        },
      },
    });

    const localPort = (tlsListener as any).port as number;

    // Overflow buffer for client socket backpressure.
    // When the client socket can't keep up, we queue bytes here
    // and flush them from the client socket's drain handler.
    let clientOverflow: Buffer[] = [];

    /**
     * Write data to the client socket with backpressure handling.
     * If the client socket buffer is full, queue remaining bytes in clientOverflow.
     */
    function writeToClient(data: Buffer | Uint8Array) {
      // If there's already overflow queued, just append (preserve ordering)
      if (clientOverflow.length > 0) {
        clientOverflow.push(Buffer.from(data));
        return;
      }

      const written = clientSocket.write(data);
      if (written < data.length) {
        // Partial or zero write — queue the remainder
        clientOverflow.push(Buffer.from(data.subarray(written)));
      }
    }

    /**
     * Flush overflow buffer to the client socket.
     * Called from the client socket's drain handler (set up in tcpProxy.ts).
     */
    function flushClientOverflow() {
      while (clientOverflow.length > 0) {
        const chunk = clientOverflow[0];
        const written = clientSocket.write(chunk);
        if (written === 0) {
          // Still full — wait for next drain
          return;
        }
        if (written < chunk.length) {
          // Partial write — keep remainder at front of queue
          clientOverflow[0] = Buffer.from(chunk.subarray(written));
          return;
        }
        // Fully written — remove from queue
        clientOverflow.shift();
      }
    }

    // Now bridge: connect to our local TLS listener and pipe data from the client
    await Bun.connect<{ peer: Socket<any> }>({
      hostname: "127.0.0.1",
      port: localPort,
      socket: {
        open(bridgeSocket) {
          bridgeSocket.data = { peer: clientSocket };

          // Link the client to the bridge
          clientSocket.data.peer = bridgeSocket;

          // Store the flush function so tcpProxy drain handler can call it
          clientSocket.data.flushOverflow = flushClientOverflow;

          // Tell the client the tunnel is established
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

          // Flush pending data (bytes client sent before we were ready)
          for (const buf of pendingData) {
            bridgeSocket.write(buf);
          }
          pendingData.length = 0;
        },
        data(bridgeSocket, data) {
          // TLS listener -> client (encrypted responses)
          writeToClient(Buffer.from(data));
        },
        close(bridgeSocket) {
          bridgeSocket.data.peer?.end();
          // Clean up the TLS listener when the bridge closes
          tlsListener.stop();
        },
        error(bridgeSocket, error) {
          console.error(`[mitm] bridge error for ${host}:${port}:`, error?.message ?? error);
          bridgeSocket.data.peer?.end();
          tlsListener.stop();
        },
        connectError(_socket, error) {
          console.error(`[mitm] bridge connect failed for ${host}:${port}:`, error?.message ?? error);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
          tlsListener.stop();
        },
      },
    });

  } catch (err: any) {
    console.error(`[mitm] failed to set up MITM for ${host}:${port}:`, err?.message ?? err);
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();
  }
}

/**
 * Handle decrypted data from the TLS socket.
 * Parse HTTP requests and forward through the proxy pipeline.
 *
 * This function is called synchronously by Bun's socket data handler.
 * It accumulates bytes and kicks off async processing, ensuring only
 * one request is processed at a time via the processing flag.
 */
function handleDecryptedData(
  socket: Socket<{}>,
  data: Buffer | Uint8Array,
  ctx: MitmContext
) {
  // WebSocket mode: parse frames and forward raw bytes to upstream
  if (ctx.state === "websocket") {
    if (ctx.wsUpstream && data.length > 0) {
      // Parse frames for event emission (client->server = "send")
      ctx.wsClientParser?.(data);
      ctx.wsUpstream.write(data);
    }
    return;
  }

  // Accumulate bytes
  if (data.length > 0) {
    ctx.buffer = Buffer.concat([ctx.buffer, Buffer.from(data)]);
  }

  // If we're already processing a request, just accumulate and return.
  // When processing finishes, it will re-enter via processNext().
  if (ctx.processing) return;

  processNext(socket, ctx);
}

/**
 * Try to parse and process the next request from the buffer.
 * Called after accumulation or after a previous request completes.
 */
function processNext(socket: Socket<{}>, ctx: MitmContext) {
  const { hostname, port } = ctx;

  if (ctx.state === "headers") {
    // Look for end-of-headers
    const headerEnd = ctx.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (ctx.buffer.length > 65536) {
        socket.write("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
        socket.end();
      }
      return; // Wait for more data
    }

    const headerSection = ctx.buffer.subarray(0, headerEnd).toString("utf-8");
    const remaining = ctx.buffer.subarray(headerEnd + 4);
    ctx.buffer = Buffer.from(remaining);

    const lines = headerSection.split("\r\n");
    const firstLine = lines[0];
    const parts = firstLine.split(" ");
    const method = parts[0];
    const path = parts[1] ?? "/";

    // Validate this looks like a real HTTP request line
    const validMethods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"]);
    if (!validMethods.has(method) || parts.length < 3 || !parts[2]?.startsWith("HTTP/")) {
      console.error(`[mitm] invalid HTTP request line from ${hostname}:${port}: ${firstLine.substring(0, 80)}`);
      return;
    }

    // Parse headers
    const headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(":");
      if (colonIdx > 0) {
        const name = lines[i].substring(0, colonIdx).trim();
        const value = lines[i].substring(colonIdx + 1).trim();
        headers.append(name, value);
      }
    }

    // Check for WebSocket upgrade
    if (isWebSocketUpgrade(headers)) {
      dispatchWebSocketUpgrade(socket, ctx, path, headers);
      return;
    }

    const contentLengthStr = headers.get("content-length");
    const expectedBodyLength = (method !== "GET" && method !== "HEAD" && contentLengthStr)
      ? parseInt(contentLengthStr, 10)
      : 0;

    if (expectedBodyLength > 0 && ctx.buffer.length < expectedBodyLength) {
      // Need more body bytes — save parsed state and wait
      ctx.state = "body";
      ctx.pendingRequest = { method, path, headers, expectedBodyLength };
      return;
    }

    // We have everything — dispatch immediately
    dispatchRequest(socket, ctx, method, path, headers, expectedBodyLength);

  } else if (ctx.state === "body") {
    // Waiting for body bytes
    const req = ctx.pendingRequest!;
    if (ctx.buffer.length < req.expectedBodyLength) {
      return; // Still waiting
    }
    // Got enough — dispatch
    ctx.state = "headers";
    ctx.pendingRequest = undefined;
    dispatchRequest(socket, ctx, req.method, req.path, req.headers, req.expectedBodyLength);
  }
}

/**
 * Dispatch a fully-parsed HTTP request through the proxy pipeline.
 * Serializes the response back as raw HTTP/1.1 over the TLS socket.
 */
function dispatchRequest(
  socket: Socket<{}>,
  ctx: MitmContext,
  method: string,
  path: string,
  headers: Headers,
  bodyLength: number
) {
  const { hostname, port, fetchHandler } = ctx;
  ctx.processing = true;

  // Extract body from buffer
  let requestBody: Uint8Array | undefined;
  if (bodyLength > 0) {
    requestBody = new Uint8Array(ctx.buffer.subarray(0, bodyLength));
    ctx.buffer = Buffer.from(ctx.buffer.subarray(bodyLength));
  }

  const url = `https://${hostname}${port !== 443 ? `:${port}` : ""}${path}`;

  const request = new Request(url, {
    method,
    headers,
    body: requestBody ? requestBody as BodyInit : undefined,
  });

  // Run async work
  (async () => {
    try {
      const response = await Effect.runPromise(fetchHandler(request));

      // Read full body first so we know the exact length
      let bodyBytes: Uint8Array | null = null;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (chunks.length === 1) {
          bodyBytes = chunks[0];
        } else if (chunks.length > 1) {
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          bodyBytes = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            bodyBytes.set(chunk, offset);
            offset += chunk.length;
          }
        }
      }

      const totalLength = bodyBytes?.length ?? 0;

      // Build response headers — always use our computed content-length
      const statusText = response.statusText || "OK";
      let headerStr = `HTTP/1.1 ${response.status} ${statusText}\r\n`;
      response.headers.forEach((value, key) => {
        // Skip content-length from upstream — we set the correct one below
        if (key === "content-length") return;
        headerStr += `${key}: ${value}\r\n`;
      });
      headerStr += `content-length: ${totalLength}\r\n`;
      headerStr += "\r\n";

      await socketWrite(socket, headerStr, ctx);
      if (bodyBytes) {
        // Write body in chunks to avoid overwhelming the socket buffer
        const CHUNK_SIZE = 16384; // 16KB chunks
        for (let offset = 0; offset < bodyBytes.length; offset += CHUNK_SIZE) {
          const end = Math.min(offset + CHUNK_SIZE, bodyBytes.length);
          const chunk = bodyBytes.subarray(offset, end);
          await socketWrite(socket, chunk, ctx);
        }
      }
    } catch (err: any) {
      console.error(`[mitm] proxy error for ${method} ${url}:`, err?.message ?? err);
      socket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    }

    ctx.processing = false;
    ctx.state = "headers";
    ctx.pendingRequest = undefined;

    // Process next request if data is buffered (keep-alive)
    if (ctx.buffer.length > 0) {
      processNext(socket, ctx);
    }
  })();
}

/**
 * Handle a WebSocket upgrade request detected in the MITM decrypted HTTP parser.
 *
 * Opens a raw TLS connection to the upstream server, forwards the upgrade request
 * with hop-by-hop headers preserved, and on receiving a 101 response, transitions
 * the MITM context to "websocket" state for bidirectional raw piping.
 */
function dispatchWebSocketUpgrade(
  tlsSocket: Socket<{}>,
  ctx: MitmContext,
  path: string,
  headers: Headers
) {
  const { hostname, port, emitEvent } = ctx;
  ctx.processing = true;

  const id = crypto.randomUUID();
  const fullUrl = `wss://${hostname}${port !== 443 ? `:${port}` : ""}${path}`;
  const startedAt = Date.now();

  // Emit request event for the WebSocket upgrade
  emitEvent({
    type: "request",
    id,
    method: "WS",
    url: fullUrl,
    headers: headersToRecord(headers),
    timestamp: startedAt,
  });

  console.log(`[mitm-ws] upgrading ${fullUrl}`);

  // Build the raw HTTP upgrade request to forward to the upstream.
  // We explicitly set Connection: Upgrade and Upgrade: websocket because some
  // clients (e.g. iOS URLSessionWebSocketTask) may not include these headers
  // when going through a MITM proxy, relying on the transport layer instead.
  let upgradeRequest = `GET ${path} HTTP/1.1\r\n`;
  upgradeRequest += `Host: ${hostname}${port !== 443 ? `:${port}` : ""}\r\n`;
  upgradeRequest += `Upgrade: websocket\r\n`;
  upgradeRequest += `Connection: Upgrade\r\n`;
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    // Skip headers we already wrote explicitly above
    if (k === "host" || k === "connection" || k === "upgrade") return;
    // Skip hop-by-hop headers that shouldn't be forwarded
    if (k === "keep-alive" || k === "proxy-authenticate" || k === "proxy-authorization" ||
        k === "te" || k === "trailer" || k === "transfer-encoding" || k === "proxy-connection") return;
    upgradeRequest += `${key}: ${value}\r\n`;
  });
  upgradeRequest += "\r\n";

  // Open a TLS connection to the upstream server
  let handshakeComplete = false;
  let handshakeBuffer = Buffer.alloc(0);

  (async () => {
    try {
      await Bun.connect<{}>({
        hostname,
        port,
        tls: {
          // Force HTTP/1.1 — WebSocket upgrade requires HTTP/1.1 and cannot work over h2.
          // Without this, servers that prefer h2 (e.g. echo.websocket.org) will negotiate
          // HTTP/2 and the 101 Switching Protocols response will never come.
          ALPNProtocols: Buffer.from("\x08http/1.1"),
        },
        socket: {
          open(upstreamSocket) {
            // Send the upgrade request to upstream
            upstreamSocket.write(upgradeRequest);

            // Also forward any buffered data that arrived after the upgrade headers
            if (ctx.buffer.length > 0) {
              // This shouldn't normally happen for WebSocket (no body in upgrade request),
              // but handle it defensively
            }
          },
          data(upstreamSocket, data) {
            if (handshakeComplete) {
              // After handshake: parse frames (server->client = "receive") and pipe to TLS socket
              ctx.wsServerParser?.(data);
              tlsSocket.write(data);
              return;
            }

            // Accumulate handshake response
            handshakeBuffer = Buffer.concat([handshakeBuffer, Buffer.from(data)]);
            const headerEnd = handshakeBuffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return; // waiting for more headers

            const responseHeaderStr = handshakeBuffer.subarray(0, headerEnd).toString("utf-8");
            const remaining = handshakeBuffer.subarray(headerEnd + 4);

            // Check for 101 status
            const statusLine = responseHeaderStr.split("\r\n")[0];
            const statusMatch = statusLine.match(/HTTP\/1\.\d\s+(\d+)/);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

            if (statusCode === 101) {
              handshakeComplete = true;

              // Parse response headers for the event
              const responseHeaders: Record<string, string> = {};
              const respLines = responseHeaderStr.split("\r\n");
              for (let i = 1; i < respLines.length; i++) {
                const ci = respLines[i].indexOf(":");
                if (ci > 0) {
                  responseHeaders[respLines[i].substring(0, ci).trim().toLowerCase()] = respLines[i].substring(ci + 1).trim();
                }
              }

              // Transition the MITM context to WebSocket piping mode
              ctx.state = "websocket";
              ctx.wsUpstream = upstreamSocket;
              ctx.wsRequestId = id;
              ctx.processing = false;

              // Set up frame parsers for message capture
              ctx.wsClientParser = createFrameParser((msg) => {
                emitEvent({
                  type: "ws_message",
                  id,
                  direction: "send",
                  data: msg.data,
                  binary: msg.opcode === "binary",
                  size: msg.size,
                  timestamp: Date.now(),
                });
              });
              ctx.wsServerParser = createFrameParser((msg) => {
                emitEvent({
                  type: "ws_message",
                  id,
                  direction: "receive",
                  data: msg.data,
                  binary: msg.opcode === "binary",
                  size: msg.size,
                  timestamp: Date.now(),
                });
              });

              // Forward the 101 response back to the client via the TLS socket
              tlsSocket.write(handshakeBuffer.subarray(0, headerEnd + 4));

              // Forward any remaining data after the 101 headers
              if (remaining.length > 0) {
                tlsSocket.write(remaining);
              }

              // Emit ws_open event
              emitEvent({
                type: "ws_open",
                id,
                url: fullUrl,
                headers: headersToRecord(headers),
                responseHeaders,
                timestamp: Date.now(),
              });

              // Emit a response event so the UI shows the 101 status
              emitEvent({
                type: "response",
                id,
                status: 101,
                headers: responseHeaders,
                durationMs: Date.now() - startedAt,
                timestamp: Date.now(),
              });
            } else {
              // Non-101 response — forward it as raw HTTP and resume normal parsing
              ctx.processing = false;
              ctx.state = "headers";

              // Write the full response back through the TLS socket
              socketWrite(tlsSocket, handshakeBuffer, ctx).then(() => {
                // Resume processing any buffered data
                if (ctx.buffer.length > 0) {
                  processNext(tlsSocket, ctx);
                }
              });

              emitEvent({
                type: "response",
                id,
                status: statusCode,
                headers: {},
                durationMs: Date.now() - startedAt,
                timestamp: Date.now(),
              });

              upstreamSocket.end();
            }
          },
          close(_upstreamSocket) {
            if (handshakeComplete) {
              emitEvent({
                type: "ws_close",
                id,
                timestamp: Date.now(),
              });
              // Close the TLS socket when upstream closes
              tlsSocket.end();
            }
          },
          error(_upstreamSocket, error) {
            console.error(`[mitm-ws] upstream error for ${fullUrl}:`, error?.message ?? error);
            if (!handshakeComplete) {
              ctx.processing = false;
              ctx.state = "headers";
              tlsSocket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
            }
          },
          connectError(_socket, error) {
            console.error(`[mitm-ws] connect failed for ${fullUrl}:`, error?.message ?? error);
            ctx.processing = false;
            ctx.state = "headers";
            tlsSocket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
            emitEvent({
              type: "error",
              id,
              message: `WebSocket connect failed: ${error?.message ?? error}`,
              timestamp: Date.now(),
            });
          },
        },
      });
    } catch (err: any) {
      console.error(`[mitm-ws] failed to connect to ${hostname}:${port}:`, err?.message ?? err);
      ctx.processing = false;
      ctx.state = "headers";
      tlsSocket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    }
  })();
}
