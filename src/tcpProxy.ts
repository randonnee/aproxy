import type { Socket } from "bun";
import type { ProxyEvent } from "./models";
import type { CaCert } from "./ca";
import { Effect } from "effect";
import { handleConnect } from "./tunnel";
import { handleMitm } from "./mitm";

/**
 * State machine for each client connection.
 *
 * "parsing"  – accumulating the initial HTTP request line + headers
 * "tunnel"   – CONNECT established, bidirectional pipe active
 * "http"     – dispatched to the fetch handler
 */
type ConnectionState = "parsing" | "tunnel" | "http";

type SocketData = {
  state: ConnectionState;
  /** Raw bytes accumulated while parsing the first request */
  buffer: Buffer;
  /** For tunnel mode: the paired upstream socket */
  peer: Socket<any> | null;
  /** Data buffered before upstream connects */
  pendingData: Buffer[];
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
            peer.write(data);
          } else {
            // Upstream not connected yet, buffer
            socket.data.pendingData.push(Buffer.from(data));
          }
          return;
        }

        if (socket.data.state === "http") {
          // Already dispatched, ignore (no HTTP keep-alive support via raw TCP)
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
            handleConnect(socket, host, targetPort, pending, emitEvent);
          }
        } else {
          socket.data.state = "http";
          handleHttpRequest(socket, headerSection, bodyStart, method, target, fetchHandler);
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

      drain(_socket) {}
    }
  });
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
  fetchHandler: FetchHandler
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
    const hasBody = method !== "GET" && method !== "HEAD" && contentLength && parseInt(contentLength, 10) > 0;

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
