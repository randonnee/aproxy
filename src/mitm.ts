import type { Socket } from "bun";
import type { ProxyEvent } from "./models";
import type { CaCert } from "./ca";
import { getHostCert } from "./ca";
import { Effect } from "effect";

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
};

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
  const tunnelId = crypto.randomUUID();
  const startedAt = Date.now();

  emitEvent({
    type: "request",
    id: tunnelId,
    method: "CONNECT",
    url: `${host}:${port}`,
    headers: {},
    timestamp: startedAt,
  });

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
    };

    // Start a local TLS listener on an ephemeral port
    const tlsListener = Bun.listen<{}>({
      hostname: "127.0.0.1",
      port: 0, // ephemeral
      tls: {
        key: hostCert.keyPem,
        cert: hostCert.certPem + "\n" + ca.certPem, // chain: leaf + CA
      },
      socket: {
        open(_socket) {
          // Context is captured via closure, no socket.data needed
        },
        data(socket, data) {
          // Accumulate decrypted HTTP data and process
          handleDecryptedData(socket, data, ctx);
        },
        close(_socket) {
          // TLS client disconnected
        },
        error(_socket, error) {
          console.error(`[mitm] TLS socket error for ${host}:${port}:`, error?.message ?? error);
        },
      },
    });

    const localPort = (tlsListener as any).port as number;

    // Now bridge: connect to our local TLS listener and pipe data from the client
    await Bun.connect<{ peer: Socket<any> }>({
      hostname: "127.0.0.1",
      port: localPort,
      socket: {
        open(bridgeSocket) {
          bridgeSocket.data = { peer: clientSocket };

          // Link the client to the bridge
          clientSocket.data.peer = bridgeSocket;

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
          bridgeSocket.data.peer?.write(data);
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

          emitEvent({
            type: "error",
            id: tunnelId,
            message: `MITM bridge failed: ${error?.message ?? "unknown error"}`,
            timestamp: Date.now(),
          });
        },
      },
    });

    emitEvent({
      type: "response",
      id: tunnelId,
      status: 200,
      headers: {},
      durationMs: Date.now() - startedAt,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error(`[mitm] failed to set up MITM for ${host}:${port}:`, err?.message ?? err);
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();

    emitEvent({
      type: "error",
      id: tunnelId,
      message: `MITM setup failed: ${err?.message ?? "unknown error"}`,
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle decrypted data from the TLS socket.
 * Parse HTTP requests and forward through the proxy pipeline.
 */
async function handleDecryptedData(
  socket: Socket<{}>,
  data: Buffer | Uint8Array,
  ctx: MitmContext
) {
  const { hostname, port, fetchHandler } = ctx;

  // Accumulate bytes
  ctx.buffer = Buffer.concat([ctx.buffer, Buffer.from(data)]);

  // If we're already processing a request, just accumulate and return
  if (ctx.processing) return;

  // Look for end-of-headers
  const headerEnd = ctx.buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    if (ctx.buffer.length > 65536) {
      socket.write("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
      socket.end();
    }
    return;
  }

  ctx.processing = true;

  const headerSection = ctx.buffer.subarray(0, headerEnd).toString("utf-8");
  const bodyStart = ctx.buffer.subarray(headerEnd + 4);

  // Reset buffer
  ctx.buffer = Buffer.alloc(0);

  const lines = headerSection.split("\r\n");
  const firstLine = lines[0];
  const parts = firstLine.split(" ");
  const method = parts[0];
  const path = parts[1] ?? "/";

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

  // Build the full URL (the client sends relative paths inside the TLS tunnel)
  const url = `https://${hostname}${port !== 443 ? `:${port}` : ""}${path}`;

  // Build request body
  const contentLength = headers.get("content-length");
  const hasBody = method !== "GET" && method !== "HEAD" && contentLength && parseInt(contentLength, 10) > 0;

  let requestBody: Buffer | undefined;
  if (hasBody) {
    const expectedLength = parseInt(contentLength!, 10);
    if (bodyStart.length >= expectedLength) {
      requestBody = Buffer.from(bodyStart.subarray(0, expectedLength));
      // Put remaining bytes back in buffer for next request
      if (bodyStart.length > expectedLength) {
        ctx.buffer = Buffer.from(bodyStart.subarray(expectedLength));
      }
    } else {
      // Body not fully received yet - for now handle what we have
      requestBody = Buffer.from(bodyStart);
    }
  }

  const request = new Request(url, {
    method,
    headers,
    body: requestBody ? new Uint8Array(requestBody) as BodyInit : undefined,
  });

  try {
    const response = await Effect.runPromise(fetchHandler(request));

    // Serialize response as raw HTTP back through the TLS socket
    const statusText = response.statusText || "OK";
    let headerStr = `HTTP/1.1 ${response.status} ${statusText}\r\n`;
    response.headers.forEach((value, key) => {
      headerStr += `${key}: ${value}\r\n`;
    });

    // Stream body
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

      // Calculate content length from the actual body
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      // Only set content-length if not already present
      if (!response.headers.has("content-length")) {
        headerStr += `content-length: ${totalLength}\r\n`;
      }
      headerStr += "\r\n";

      socket.write(headerStr);
      for (const chunk of chunks) {
        socket.write(chunk);
      }
    } else {
      if (!response.headers.has("content-length")) {
        headerStr += "content-length: 0\r\n";
      }
      headerStr += "\r\n";
      socket.write(headerStr);
    }
  } catch (err: any) {
    console.error(`[mitm] proxy error for ${method} ${url}:`, err?.message ?? err);
    socket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
  }

  ctx.processing = false;

  // Check if there's another request buffered (HTTP/1.1 keep-alive / pipelining)
  if (ctx.buffer.length > 0) {
    handleDecryptedData(socket, Buffer.alloc(0), ctx);
  }
}
