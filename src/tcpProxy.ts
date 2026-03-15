import type { Socket } from "bun";
import type { ProxyEvent } from "./models";
import type { CaCert } from "./ca";
import { Effect } from "effect";
import { handleConnect } from "./tunnel";
import { handleMitm } from "./mitm";
import { isWebSocketUpgrade, stripHopByHopForWebSocket, headersToRecord } from "./http";
import { createFrameParser } from "./wsFrameParser";

/**
 * State machine for each client connection.
 *
 * "parsing"  – accumulating the initial HTTP request line + headers
 * "body"     – headers parsed, accumulating request body bytes (Content-Length)
 * "chunked"  – headers parsed, accumulating chunked transfer-encoding body
 * "tunnel"   – CONNECT established, bidirectional pipe active
 * "http"     – dispatched to the fetch handler
 */
type ConnectionState = "parsing" | "body" | "chunked" | "tunnel" | "http";

/** Max bytes to buffer while waiting for upstream connect or request body (10MB) */
const BUFFER_MAX_BYTES = 10 * 1024 * 1024;

type SocketData = {
  state: ConnectionState;
  /** Raw bytes accumulated while parsing the first request */
  buffer: Buffer;
  /** For tunnel mode: the paired upstream socket */
  peer: Socket<any> | null;
  /** Data buffered before upstream connects */
  pendingData: Buffer[];
  /** Parsed header section (set when transitioning to "body" state) */
  headerSection?: string;
  /** HTTP method (set when transitioning to "body" state) */
  method?: string;
  /** HTTP target (set when transitioning to "body" state) */
  target?: string;
  /** Body bytes accumulated so far */
  bodyBuffer?: Buffer;
  /** Expected Content-Length */
  expectedBodyLength?: number;
  /** Raw chunked data being accumulated (undecoded, including chunk headers) */
  chunkedRaw?: Buffer;
  /** Decoded body chunks accumulated so far */
  chunkedDecoded?: Buffer[];
  /** Flush overflow callback for MITM backpressure handling */
  flushOverflow?: () => void;
  /** Frame parser for client->server WebSocket messages (send direction) */
  wsClientParser?: (data: Buffer | Uint8Array) => void;
  /** Frame parser for server->client WebSocket messages (receive direction) */
  wsServerParser?: (data: Buffer | Uint8Array) => void;
};

type FetchHandler = (req: Request) => Effect.Effect<Response, any>;

/**
 * Create the main TCP listener that handles both HTTP proxy and CONNECT tunneling
 * on a single port.
 *
 * - CONNECT requests are handled directly as TCP tunnels.
 * - All other HTTP requests are converted to a Request object and passed to
 *   the provided fetchHandler (the same route handler used by Bun.serve).
 */
export function createTcpProxy(opts: {
  port: number;
  hostname: string;
  fetchHandler: FetchHandler;
  emitEvent: (event: ProxyEvent) => void;
  /** When provided, CONNECT tunnels are intercepted with MITM instead of blind piping */
  ca?: CaCert;
}) {
  const { port, hostname, fetchHandler, emitEvent, ca } = opts;

  return Bun.listen<SocketData>({
    hostname,
    port,
    socket: {
      open(socket) {
        socket.data = {
          state: "parsing",
          buffer: Buffer.alloc(0),
          peer: null,
          pendingData: []
        };
      },

      data(socket, data) {
        if (socket.data.state === "tunnel") {
          // Tunnel mode: forward to peer
          const peer = socket.data.peer;
          if (peer) {
            // Parse WebSocket frames if parsers are attached (client->server = send)
            socket.data.wsClientParser?.(data);
            peer.write(data);
          } else {
            // Upstream not connected yet, buffer (with size limit)
            socket.data.pendingData.push(Buffer.from(data));
            const totalPending = socket.data.pendingData.reduce((sum, b) => sum + b.length, 0);
            if (totalPending > BUFFER_MAX_BYTES) {
              console.error(`[tcp] pending data exceeded ${BUFFER_MAX_BYTES} bytes, closing`);
              socket.end();
            }
          }
          return;
        }

        if (socket.data.state === "http") {
          // Already dispatched, ignore (no HTTP keep-alive support via raw TCP)
          return;
        }

        if (socket.data.state === "body") {
          // Accumulating body bytes (Content-Length mode)
          socket.data.bodyBuffer = Buffer.concat([socket.data.bodyBuffer!, Buffer.from(data)]);
          if (socket.data.bodyBuffer.length > BUFFER_MAX_BYTES) {
            console.error(`[tcp] request body exceeded ${BUFFER_MAX_BYTES} bytes, rejecting`);
            socket.write("HTTP/1.1 413 Content Too Large\r\nContent-Length: 0\r\n\r\n");
            socket.end();
            return;
          }
          if (socket.data.bodyBuffer.length >= socket.data.expectedBodyLength!) {
            socket.data.state = "http";
            handleHttpRequest(
              socket,
              socket.data.headerSection!,
              socket.data.bodyBuffer,
              socket.data.method!,
              socket.data.target!,
              fetchHandler,
              emitEvent
            );
          }
          return;
        }

        if (socket.data.state === "chunked") {
          // Accumulating chunked transfer-encoding body
          socket.data.chunkedRaw = Buffer.concat([socket.data.chunkedRaw!, Buffer.from(data)]);
          if (socket.data.chunkedRaw.length > BUFFER_MAX_BYTES) {
            console.error(`[tcp] chunked request body exceeded ${BUFFER_MAX_BYTES} bytes, rejecting`);
            socket.write("HTTP/1.1 413 Content Too Large\r\nContent-Length: 0\r\n\r\n");
            socket.end();
            return;
          }
          const result = tryDecodeChunked(socket.data.chunkedRaw);
          if (result !== null) {
            socket.data.state = "http";
            handleHttpRequest(
              socket,
              socket.data.headerSection!,
              result,
              socket.data.method!,
              socket.data.target!,
              fetchHandler,
              emitEvent
            );
          }
          return;
        }

        // Parsing mode: accumulate bytes and look for end of headers
        socket.data.buffer = Buffer.concat([socket.data.buffer, Buffer.from(data)]);
        const headerEnd = socket.data.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          if (socket.data.buffer.length > 65536) {
            socket.write("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
            socket.end();
          }
          return;
        }

        const headerSection = socket.data.buffer.subarray(0, headerEnd).toString("utf-8");
        const bodyStart = socket.data.buffer.subarray(headerEnd + 4);
        const firstLine = headerSection.split("\r\n")[0];
        const parts = firstLine.split(" ");
        const method = parts[0];
        const target = parts[1];

        if (method === "CONNECT") {
          socket.data.state = "tunnel";
          const colonIdx = target.lastIndexOf(":");
          const host = colonIdx > 0 ? target.substring(0, colonIdx) : target;
          const targetPort = colonIdx > 0 ? parseInt(target.substring(colonIdx + 1), 10) : 443;

          console.log(`[tunnel] CONNECT ${host}:${targetPort}${ca ? " (MITM)" : ""}`);

          const pending: Buffer[] = [];
          if (bodyStart.length > 0) {
            pending.push(Buffer.from(bodyStart));
          }

          if (ca) {
            handleMitm(socket, host, targetPort, pending, emitEvent, ca, fetchHandler);
          } else {
            handleConnect(socket, host, targetPort, pending);
          }
        } else {
          // Check if we need to wait for body bytes
          const contentLengthHeader = headerSection.split("\r\n").find(
            (l) => l.toLowerCase().startsWith("content-length:")
          );
          const expectedBodyLength = contentLengthHeader
            ? parseInt(contentLengthHeader.split(":")[1].trim(), 10)
            : 0;

          // Check for chunked transfer-encoding
          const isChunked = headerSection.split("\r\n").some(
            (l) => l.toLowerCase().startsWith("transfer-encoding:") &&
              l.toLowerCase().includes("chunked")
          );

          if (isChunked) {
            // Chunked transfer-encoding: try to decode what we have so far
            const result = tryDecodeChunked(bodyStart);
            if (result !== null) {
              // Complete chunked body already arrived
              socket.data.state = "http";
              handleHttpRequest(socket, headerSection, result, method, target, fetchHandler, emitEvent);
            } else {
              // Need more data
              socket.data.state = "chunked";
              socket.data.headerSection = headerSection;
              socket.data.method = method;
              socket.data.target = target;
              socket.data.chunkedRaw = Buffer.from(bodyStart);
            }
          } else if (expectedBodyLength > 0 && bodyStart.length < expectedBodyLength) {
            // Body hasn't fully arrived yet — transition to "body" state
            socket.data.state = "body";
            socket.data.headerSection = headerSection;
            socket.data.method = method;
            socket.data.target = target;
            socket.data.bodyBuffer = Buffer.from(bodyStart);
            socket.data.expectedBodyLength = expectedBodyLength;
          } else {
            socket.data.state = "http";
            handleHttpRequest(socket, headerSection, bodyStart, method, target, fetchHandler, emitEvent);
          }
        }
      },

      close(socket) {
        if (socket.data.state === "tunnel" && socket.data.peer) {
          socket.data.peer.end();
        }
      },

      error(socket, error) {
        console.error("[tcp] socket error:", error?.message ?? error);
        if (socket.data.state === "tunnel" && socket.data.peer) {
          socket.data.peer.end();
        }
      },

      drain(socket) {
        // Flush any MITM overflow data queued due to backpressure
        socket.data.flushOverflow?.();
      }
    }
  });
}

/**
 * Try to decode a chunked transfer-encoding body from raw data.
 *
 * Chunked format: (<hex-size>\r\n<data>\r\n)* 0\r\n\r\n
 *
 * Returns the decoded body Buffer if the entire chunked body is present,
 * or null if more data is needed.
 */
function tryDecodeChunked(raw: Buffer): Buffer | null {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < raw.length) {
    // Find the end of the chunk size line
    const lineEnd = raw.indexOf("\r\n", offset);
    if (lineEnd === -1) return null; // Need more data

    const sizeLine = raw.subarray(offset, lineEnd).toString("utf-8").trim();
    // Chunk size may include chunk extensions (;ext=val), ignore them
    const semiIdx = sizeLine.indexOf(";");
    const sizeHex = semiIdx >= 0 ? sizeLine.substring(0, semiIdx).trim() : sizeLine;
    const chunkSize = parseInt(sizeHex, 16);

    if (isNaN(chunkSize)) {
      // Invalid chunk — treat as complete with what we have
      console.error(`[tcp] invalid chunk size: "${sizeLine.substring(0, 40)}"`);
      return Buffer.concat(chunks);
    }

    if (chunkSize === 0) {
      // Terminal chunk — need the trailing \r\n after "0\r\n"
      // We've consumed "0" at offset..lineEnd, lineEnd+2 is past the \r\n after "0"
      // Now we need to skip optional trailers and the final \r\n
      const trailerEnd = raw.indexOf("\r\n", lineEnd + 2);
      if (trailerEnd === -1) return null; // Need more data for final CRLF
      return Buffer.concat(chunks);
    }

    // We need: lineEnd + 2 (past \r\n) + chunkSize bytes + 2 (trailing \r\n)
    const dataStart = lineEnd + 2;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd + 2 > raw.length) return null; // Need more data

    chunks.push(Buffer.from(raw.subarray(dataStart, dataEnd)));
    offset = dataEnd + 2; // Skip trailing \r\n after chunk data
  }

  // Ran out of data without seeing terminal chunk
  return null;
}

/**
 * Convert raw HTTP request into a Request object, pass through the fetch handler,
 * and write the Response back to the client socket as raw HTTP.
 */
async function handleHttpRequest(
  clientSocket: Socket<SocketData>,
  headerSection: string,
  body: Buffer,
  method: string,
  target: string,
  fetchHandler: FetchHandler,
  emitEvent?: (event: ProxyEvent) => void
) {
  try {
    const lines = headerSection.split("\r\n");

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

    // Check for WebSocket upgrade before entering the fetch pipeline
    if (isWebSocketUpgrade(headers) && emitEvent) {
      return handleWebSocketUpgrade(clientSocket, headerSection, headers, target, emitEvent);
    }

    // Build URL
    // For proxy requests: target is absolute (http://example.com/path)
    // For control/direct requests: target is a path (/events)
    let url: string;
    if (target.startsWith("http://") || target.startsWith("https://")) {
      url = target;
    } else {
      const host = headers.get("host") ?? "localhost";
      url = `http://${host}${target}`;
    }

    // Build request body
    const contentLength = headers.get("content-length");
    const hasBody = method !== "GET" && method !== "HEAD" && body.length > 0;

    // If the body was decoded from chunked transfer-encoding, fix up headers:
    // remove transfer-encoding (already decoded) and set the correct content-length
    if (hasBody && !contentLength) {
      headers.delete("transfer-encoding");
      headers.set("content-length", body.length.toString());
    }

    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? new Uint8Array(body) : undefined
    });

    // Run through the Effect-based fetch handler
    const response = await Effect.runPromise(fetchHandler(request));

    // Serialize response to raw HTTP
    const statusText = response.statusText || "OK";
    let headerStr = `HTTP/1.1 ${response.status} ${statusText}\r\n`;
    response.headers.forEach((value, key) => {
      headerStr += `${key}: ${value}\r\n`;
    });
    headerStr += "\r\n";

    clientSocket.write(headerStr);

    // Stream body
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          clientSocket.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    clientSocket.end();
  } catch (err: any) {
    console.error("[tcp] http handler error:", err?.message ?? err);
    try {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
      clientSocket.end();
    } catch {
      // socket already closed
    }
  }
}

/**
 * Handle a WebSocket upgrade request for plain HTTP (ws://).
 *
 * Instead of using fetch() (which cannot handle 101 Switching Protocols),
 * we open a raw TCP connection to the upstream, forward the upgrade request
 * with hop-by-hop headers preserved, and then transition to bidirectional piping.
 */
async function handleWebSocketUpgrade(
  clientSocket: Socket<SocketData>,
  headerSection: string,
  headers: Headers,
  target: string,
  emitEvent: (event: ProxyEvent) => void
) {
  // Parse the upstream host/port from the target URL
  let upstreamHost: string;
  let upstreamPort: number;
  let path: string;

  try {
    if (target.startsWith("http://") || target.startsWith("https://")) {
      const url = new URL(target);
      upstreamHost = url.hostname;
      upstreamPort = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
      path = url.pathname + url.search;
    } else {
      const host = headers.get("host") ?? "localhost";
      const [h, p] = host.split(":");
      upstreamHost = h;
      upstreamPort = p ? parseInt(p, 10) : 80;
      path = target;
    }
  } catch {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.end();
    return;
  }

  const id = crypto.randomUUID();
  const fullUrl = `ws://${upstreamHost}${upstreamPort !== 80 ? `:${upstreamPort}` : ""}${path}`;
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

  console.log(`[ws] upgrading ${fullUrl}`);

  // Build the raw HTTP upgrade request to send to upstream
  const outgoingHeaders = new Headers(headers);
  stripHopByHopForWebSocket(outgoingHeaders);

  let upgradeRequest = `GET ${path} HTTP/1.1\r\n`;
  upgradeRequest += `Host: ${upstreamHost}${upstreamPort !== 80 ? `:${upstreamPort}` : ""}\r\n`;
  upgradeRequest += `Connection: Upgrade\r\n`;
  upgradeRequest += `Upgrade: websocket\r\n`;
  outgoingHeaders.forEach((value, key) => {
    // Skip headers we're already writing explicitly
    if (key === "host" || key === "connection" || key === "upgrade") return;
    upgradeRequest += `${key}: ${value}\r\n`;
  });
  upgradeRequest += "\r\n";

  try {
    // Track whether we've received the 101 response
    let handshakeComplete = false;
    let handshakeBuffer = Buffer.alloc(0);

    await Bun.connect<{ peer: Socket<any> }>({
      hostname: upstreamHost,
      port: upstreamPort,
      socket: {
        open(upstreamSocket) {
          upstreamSocket.data = { peer: clientSocket };
          // Send the upgrade request to upstream
          upstreamSocket.write(upgradeRequest);
        },
        data(upstreamSocket, data) {
          if (handshakeComplete) {
            // After handshake: parse frames (server->client = "receive") and pipe to client
            clientSocket.data.wsServerParser?.(data);
            clientSocket.write(data);
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

            // Transition the client socket to tunnel mode
            clientSocket.data.state = "tunnel";
            clientSocket.data.peer = upstreamSocket;

            // Set up frame parsers for WebSocket message capture
            clientSocket.data.wsClientParser = createFrameParser((msg) => {
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
            clientSocket.data.wsServerParser = createFrameParser((msg) => {
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

            // Forward the complete 101 response to the client
            clientSocket.write(handshakeBuffer.subarray(0, headerEnd + 4));

            // Forward any remaining data after the 101 headers
            if (remaining.length > 0) {
              clientSocket.write(remaining);
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
            // Non-101 response — forward it as-is and close
            clientSocket.write(handshakeBuffer);
            clientSocket.end();

            emitEvent({
              type: "response",
              id,
              status: statusCode,
              headers: {},
              durationMs: Date.now() - startedAt,
              timestamp: Date.now(),
            });
          }
        },
        close(_upstreamSocket) {
          // Emit ws_close event if handshake completed
          if (handshakeComplete) {
            emitEvent({
              type: "ws_close",
              id,
              timestamp: Date.now(),
            });
          }
          clientSocket.end();
        },
        error(upstreamSocket, error) {
          console.error(`[ws] upstream error for ${fullUrl}:`, error?.message ?? error);
          upstreamSocket.data.peer?.end();
        },
        connectError(_socket, error) {
          console.error(`[ws] connect failed for ${fullUrl}:`, error?.message ?? error);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
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
    console.error(`[ws] failed to set up WebSocket tunnel for ${fullUrl}:`, err?.message ?? err);
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();
  }
}
