import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { parseUrl, formatTime, statusClass } from "../../lib/helpers";

interface Column {
  key: string;
  label: string;
  initWidth: number;
  minWidth: number;
  align?: "right" | "center";
}

const COLUMNS: Column[] = [
  { key: "method",   label: "Method",  initWidth: 82,  minWidth: 50, align: "center" },
  { key: "status",   label: "Status",  initWidth: 62,  minWidth: 44, align: "center" },
  { key: "host",     label: "Host",    initWidth: 200, minWidth: 80 },
  { key: "path",     label: "Path",    initWidth: -1,  minWidth: 80 },  // -1 = fill remaining
  { key: "duration", label: "Time",    initWidth: 100, minWidth: 50, align: "right" },
  { key: "time",     label: "Clock",   initWidth: 100, minWidth: 50, align: "right" },
];

export function RequestTable() {
  const requests = useAppStore((s) => s.requests);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectRequest = useAppStore((s) => s.selectRequest);

  const activeViewFn = useAppStore((s) => s.activeViewFn);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const methodFilters = useAppStore((s) => s.methodFilters);
  const orderedIds = useAppStore((s) => s.orderedIds);

  const wrapRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef<number[]>([]);
  const [colWidths, setColWidths] = useState<number[]>([]);

  const flexIndex = COLUMNS.findIndex((c) => c.initWidth === -1);

  // Initialise widths once the container is measured
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || widthsRef.current.length > 0) return;

    const initial = COLUMNS.map((c) =>
      c.initWidth > 0 ? c.initWidth : 0
    );
    widthsRef.current = initial;
    setColWidths(initial);
  });

  // Handle resize via refs — no stale closures
  const onResizeStart = (e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow resizing the flex column directly
    if (colIndex === flexIndex) return;

    const startX = e.clientX;
    const startWidths = [...widthsRef.current];
    const containerWidth = wrapRef.current?.clientWidth ?? 0;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = [...startWidths];
      next[colIndex] = Math.max(COLUMNS[colIndex].minWidth, startWidths[colIndex] + delta);

      // Ensure the sum of all fixed columns doesn't squeeze the flex column below its minimum
      const fixedSum = next.reduce((sum, w, i) => i !== flexIndex ? sum + w : sum, 0);
      const flexMin = COLUMNS[flexIndex].minWidth;
      if (fixedSum > containerWidth - flexMin) {
        // Clamp this column so flex column keeps its minimum width
        next[colIndex] = Math.max(
          COLUMNS[colIndex].minWidth,
          next[colIndex] - (fixedSum - (containerWidth - flexMin))
        );
      }

      widthsRef.current = next;
      setColWidths(next);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Build grid template: fixed columns get px values, flex column gets 1fr
  const gridTemplate =
    colWidths.length > 0
      ? colWidths.map((w, i) => i === flexIndex ? `minmax(${COLUMNS[i].minWidth}px, 1fr)` : `${w}px`).join(" ")
      : COLUMNS.map((c) => (c.initWidth > 0 ? `${c.initWidth}px` : "1fr")).join(" ");

  const ids = orderedIds.filter((id) => {
    const entry = requests.get(id);
    if (!entry?.request) return false;

    if (methodFilters.size > 0 && !methodFilters.has(entry.request.method)) return false;

    if (searchQuery) {
      const search = searchQuery.trim().toLowerCase();
      if (search) {
        const haystack =
          `${entry.request.method} ${entry.request.url} ${entry.response?.status || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
    }

    if (activeViewFn) {
      try {
        const ctx = {
          id: entry.request.id,
          url: entry.request.url,
          method: entry.request.method,
          headers: entry.request.headers || {},
          status: entry.response?.status,
          responseHeaders: entry.response?.headers,
          durationMs: entry.response?.durationMs,
          mocked: entry.response?.mocked,
        };
        if (!activeViewFn(ctx)) return false;
      } catch {
        // If filter throws, include the request
      }
    }

    return true;
  });

  return (
    <div className="request-list-wrap" ref={wrapRef}>
      {/* Header */}
      <div className="rtable-header" style={{ gridTemplateColumns: gridTemplate }}>
        {COLUMNS.map((col, i) => (
          <div
            key={col.key}
            className="rtable-th"
            style={col.align ? { textAlign: col.align } : undefined}
          >
            {col.label}
            <div
              className="col-resize-handle"
              onMouseDown={(e) => onResizeStart(e, i)}
            />
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="rtable-body">
        {ids.map((id) => {
          const entry = requests.get(id);
          if (!entry?.request) return null;

          const req = entry.request;
          const res = entry.response;
          const err = entry.error;
          const { host, path } = parseUrl(req.url);
          const status = res
            ? res.status
            : err
              ? "ERR"
              : "...";
          const isWs = req.method === "WS";
          const duration = res
            ? isWs
              ? (entry.wsClosed ? "closed" : "open")
              : `${res.durationMs}ms`
            : err
              ? "err"
              : "";
          const time = formatTime(req.timestamp);
          const mocked = res?.mocked;

          const rowClass = [
            "rtable-row",
            id === selectedId ? "selected" : "",
            mocked ? "mocked" : "",
            isWs ? "websocket" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const cells: Record<string, React.ReactNode> = {
            method: <span className={`method method-${req.method}`}>{req.method}</span>,
            status: (
              <span
                className={
                  typeof status === "number"
                    ? statusClass(status)
                    : err
                      ? "status-5xx"
                      : "status-pending"
                }
              >
                {status}
              </span>
            ),
            host: host,
            path: path,
            duration: duration,
            time: time,
          };

          return (
            <div
              key={id}
              className={rowClass}
              style={{ gridTemplateColumns: gridTemplate }}
              onClick={() => selectRequest(id)}
            >
              {COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className="rtable-td"
                  style={col.align ? { textAlign: col.align } : undefined}
                >
                  {cells[col.key]}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {ids.length === 0 && (
        <div className="empty-state">
          <div className="icon">~</div>
          <div>No requests captured yet</div>
          <div style={{ fontSize: "11px" }}>
            Configure your system proxy and start browsing
          </div>
        </div>
      )}
    </div>
  );
}
