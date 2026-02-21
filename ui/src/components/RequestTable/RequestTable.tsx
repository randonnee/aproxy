import { useAppStore } from "../../stores/appStore";
import { parseUrl, formatTime, statusClass } from "../../lib/helpers";

export function RequestTable() {
  const requests = useAppStore((s) => s.requests);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectRequest = useAppStore((s) => s.selectRequest);

  // Subscribe to filter-affecting state so Zustand re-renders the table
  // when the active view, search query, or method filter changes.
  const activeViewFn = useAppStore((s) => s.activeViewFn);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const methodFilters = useAppStore((s) => s.methodFilters);
  const orderedIds = useAppStore((s) => s.orderedIds);

  // Compute filtered IDs inline using the subscribed state
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
    <div className="request-list-wrap">
      <table className="request-table">
        <thead>
          <tr>
            <th className="col-method">Method</th>
            <th className="col-status">Status</th>
            <th className="col-host">Host</th>
            <th className="col-path">Path</th>
            <th className="col-duration">Time</th>
            <th className="col-time">Clock</th>
          </tr>
        </thead>
        <tbody>
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
            const duration = res
              ? `${res.durationMs}ms`
              : err
                ? "err"
                : "";
            const time = formatTime(req.timestamp);
            const mocked = res?.mocked;

            const classes = [
              id === selectedId ? "selected" : "",
              mocked ? "mocked" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <tr
                key={id}
                className={classes}
                onClick={() => selectRequest(id)}
              >
                <td className="col-method">
                  <span className={`method method-${req.method}`}>
                    {req.method}
                  </span>
                </td>
                <td className="col-status">
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
                </td>
                <td className="col-host">{host}</td>
                <td className="col-path">{path}</td>
                <td className="col-duration" style={{ textAlign: "right" }}>
                  {duration}
                </td>
                <td className="col-time" style={{ textAlign: "right" }}>
                  {time}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
