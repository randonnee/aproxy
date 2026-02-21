import type { Socket } from "bun";
import type { ProxyEvent } from "./models";

/**
 * Handles HTTP CONNECT tunneling.
 *
 * When a client sends `CONNECT host:port HTTP/1.1`, we:
 * 1. Open a TCP connection to the target
 * 2. Reply `200 Connection Established` to the client
 * 3. Blindly pipe bytes in both directions (no MITM, no inspection)
 *
 * This lets HTTPS traffic flow through the proxy without decryption.
 */

/**
 * Handle a CONNECT request from the raw TCP layer.
 *
 * The client socket can be any Socket type — we only need write/end/data access.
 *
 * @param clientSocket - The raw client socket that sent the CONNECT request
 * @param host - Target hostname
 * @param port - Target port
 * @param pendingData - Any data received from the client after the CONNECT headers but before the tunnel is established
 * @param emitEvent - Callback to emit proxy events for the UI
 */
export async function handleConnect(
  clientSocket: Socket<any>,
  host: string,
  port: number,
  pendingData: Buffer[],
  emitEvent: (event: ProxyEvent) => void
): Promise<void> {
  const tunnelId = crypto.randomUUID();
  const startedAt = Date.now();

  // Emit a request event so the tunnel shows up in the UI
  emitEvent({
    type: "request",
    id: tunnelId,
    method: "CONNECT",
    url: `${host}:${port}`,
    headers: {},
    timestamp: startedAt
  });

  try {
    // Connect to the upstream target
    await Bun.connect<{ peer: Socket<any> }>({
      hostname: host,
      port,
      socket: {
        open(socket) {
          socket.data = { peer: clientSocket };

          // Update client socket's peer reference
          clientSocket.data.peer = socket;

          // Send 200 to the client to indicate tunnel is established
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

          // Flush any data the client sent while we were connecting
          for (const buf of pendingData) {
            socket.write(buf);
          }
          pendingData.length = 0;
        },
        data(socket, data) {
          // Upstream -> client
          socket.data.peer?.write(data);
        },
        close(socket) {
          socket.data.peer?.end();
        },
        error(socket, error) {
          console.error(`[tunnel] upstream error for ${host}:${port}:`, error?.message ?? error);
          socket.data.peer?.end();
        },
        connectError(_socket, error) {
          console.error(`[tunnel] connect failed for ${host}:${port}:`, error?.message ?? error);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();

          emitEvent({
            type: "error",
            id: tunnelId,
            message: `CONNECT failed: ${error?.message ?? "unknown error"}`,
            timestamp: Date.now()
          });
        }
      }
    });

    // Emit a response event
    emitEvent({
      type: "response",
      id: tunnelId,
      status: 200,
      headers: {},
      durationMs: Date.now() - startedAt,
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error(`[tunnel] failed to open connection to ${host}:${port}:`, err?.message ?? err);
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();

    emitEvent({
      type: "error",
      id: tunnelId,
      message: `CONNECT failed: ${err?.message ?? "unknown error"}`,
      timestamp: Date.now()
    });
  }
}
