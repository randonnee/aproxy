/**
 * WebSocket frame parser (RFC 6455).
 *
 * Parses WebSocket frames from a raw byte stream, handling:
 * - Text frames (opcode 0x1), binary frames (opcode 0x2)
 * - Continuation frames (opcode 0x0)
 * - Control frames: close (0x8), ping (0x9), pong (0xA)
 * - Masking (client->server frames are masked per spec)
 * - Variable-length payload encoding (7-bit, 16-bit, 64-bit)
 * - Fragmented messages (multiple frames per message)
 * - Buffering partial frames across multiple data events
 *
 * This is a passthrough parser — it reads frames without modifying the
 * byte stream, so the original data can be forwarded unchanged.
 */

export type WsOpcode = 0x0 | 0x1 | 0x2 | 0x8 | 0x9 | 0xA;

export interface WsMessage {
  /** "text" or "binary" */
  opcode: "text" | "binary";
  /** Decoded payload (text as string, binary as hex) */
  data: string;
  /** Raw payload size in bytes */
  size: number;
}

export type OnMessage = (msg: WsMessage) => void;

/**
 * Create a stateful frame parser for one direction of a WebSocket connection.
 *
 * Returns a function that accepts raw bytes (from a socket data event).
 * When complete messages are parsed, the `onMessage` callback is invoked.
 *
 * The parser accumulates partial frames across multiple calls and handles
 * fragmented messages (continuation frames).
 */
export function createFrameParser(onMessage: OnMessage): (data: Buffer | Uint8Array) => void {
  let buffer = Buffer.alloc(0);

  // Fragmentation state: accumulate payload from continuation frames
  let fragmentOpcode: "text" | "binary" | null = null;
  let fragmentChunks: Buffer[] = [];
  let fragmentSize = 0;

  return function feed(data: Buffer | Uint8Array) {
    buffer = buffer.length === 0
      ? Buffer.from(data)
      : Buffer.concat([buffer, Buffer.from(data)]);

    // Try to parse as many complete frames as possible from the buffer
    while (buffer.length >= 2) {
      const result = tryParseFrame(buffer);
      if (!result) break; // not enough bytes yet

      const { frame, bytesConsumed } = result;
      buffer = buffer.subarray(bytesConsumed);

      // Control frames (close/ping/pong) are not emitted as messages —
      // they can appear in the middle of fragmented messages
      if (frame.opcode >= 0x8) {
        continue;
      }

      if (frame.opcode === 0x0) {
        // Continuation frame
        if (fragmentOpcode !== null) {
          fragmentChunks.push(frame.payload);
          fragmentSize += frame.payload.length;
          if (frame.fin) {
            // Final fragment — reassemble and emit
            const fullPayload = Buffer.concat(fragmentChunks);
            onMessage({
              opcode: fragmentOpcode,
              data: fragmentOpcode === "text"
                ? fullPayload.toString("utf-8")
                : fullPayload.toString("hex"),
              size: fragmentSize,
            });
            fragmentOpcode = null;
            fragmentChunks = [];
            fragmentSize = 0;
          }
        }
        // If no fragment in progress, ignore (malformed)
      } else {
        // Data frame (text=0x1, binary=0x2)
        const opcode: "text" | "binary" = frame.opcode === 0x1 ? "text" : "binary";
        if (frame.fin) {
          // Single-frame message (most common case)
          onMessage({
            opcode,
            data: opcode === "text"
              ? frame.payload.toString("utf-8")
              : frame.payload.toString("hex"),
            size: frame.payload.length,
          });
        } else {
          // First frame of a fragmented message
          fragmentOpcode = opcode;
          fragmentChunks = [frame.payload];
          fragmentSize = frame.payload.length;
        }
      }
    }
  };
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/**
 * Try to parse a single WebSocket frame from the buffer.
 * Returns null if there aren't enough bytes yet.
 */
function tryParseFrame(buf: Buffer): { frame: ParsedFrame; bytesConsumed: number } | null {
  if (buf.length < 2) return null;

  const byte0 = buf[0];
  const byte1 = buf[1];

  const fin = (byte0 & 0x80) !== 0;
  const opcode = byte0 & 0x0F;
  const masked = (byte1 & 0x80) !== 0;
  let payloadLen = byte1 & 0x7F;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    // Read as 64-bit. JavaScript Number is safe up to 2^53, which is plenty for WS frames.
    const high = buf.readUInt32BE(2);
    const low = buf.readUInt32BE(6);
    payloadLen = high * 0x100000000 + low;
    offset = 10;

    // Safety: don't try to allocate absurdly large frames
    if (payloadLen > 100 * 1024 * 1024) {
      // Skip this frame — too large to buffer in memory
      return null;
    }
  }

  const maskSize = masked ? 4 : 0;
  const totalFrameSize = offset + maskSize + payloadLen;

  if (buf.length < totalFrameSize) return null;

  let payload: Buffer;
  if (masked) {
    const maskKey = buf.subarray(offset, offset + 4);
    const maskedPayload = buf.subarray(offset + 4, offset + 4 + payloadLen);
    // Unmask in-place on a copy
    payload = Buffer.allocUnsafe(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = maskedPayload[i] ^ maskKey[i & 3];
    }
  } else {
    payload = Buffer.from(buf.subarray(offset, offset + payloadLen));
  }

  return {
    frame: { fin, opcode, payload },
    bytesConsumed: totalFrameSize,
  };
}
