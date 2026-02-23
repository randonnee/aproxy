import { useEffect, useRef } from "react";
import type { WebSocketMessageEvent } from "../../lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const base = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base}.${ms}`;
}

function tryFormatJson(data: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(data);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: data, isJson: false };
  }
}

export function MessagesTab({ messages }: { messages?: WebSocketMessageEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages?.length]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Consider "at bottom" if within 30px of the bottom
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  if (!messages || messages.length === 0) {
    return <div className="detail-empty">No WebSocket messages captured</div>;
  }

  return (
    <div className="ws-messages" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg, i) => {
        const isSend = msg.direction === "send";
        const { formatted, isJson } = msg.binary
          ? { formatted: msg.data, isJson: false }
          : tryFormatJson(msg.data);

        return (
          <div key={i} className={`ws-msg ${isSend ? "ws-msg-send" : "ws-msg-receive"}`}>
            <div className="ws-msg-header">
              <span className={`ws-msg-dir ${isSend ? "send" : "receive"}`}>
                {isSend ? "\u2191" : "\u2193"}
              </span>
              <span className="ws-msg-time">{formatTimestamp(msg.timestamp)}</span>
              <span className="ws-msg-size">{formatSize(msg.size)}</span>
              {msg.binary && <span className="ws-msg-binary">bin</span>}
            </div>
            <pre className={`ws-msg-data${isJson ? " ws-msg-json" : ""}`}>{formatted}</pre>
          </div>
        );
      })}
    </div>
  );
}
