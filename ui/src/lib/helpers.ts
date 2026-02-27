export function parseUrl(urlStr: string): { host: string; path: string } {
  try {
    const u = new URL(urlStr);
    return { host: u.host, path: u.pathname + u.search };
  } catch {
    return { host: "", path: urlStr };
  }
}

export function formatTime(ts: number | string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function statusClass(status: number | undefined | null): string {
  if (!status) return "status-pending";
  if (status === 101) return "status-1xx";
  if (status < 300) return "status-2xx";
  if (status < 400) return "status-3xx";
  if (status < 500) return "status-4xx";
  return "status-5xx";
}

function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function formatBody(
  body: string | undefined,
  headers: Record<string, string> | undefined
): string {
  if (!body) return "";
  const ct = headers?.["content-type"] ?? headers?.["Content-Type"] ?? "";
  if (ct.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export function formatEntryAsText(entry: {
  request?: { method: string; url: string; headers: Record<string, string>; body?: string };
  response?: { status: number; headers: Record<string, string>; body?: string; durationMs: number; mocked?: boolean };
  error?: { message: string };
}): string {
  const parts: string[] = [];

  const req = entry.request;
  if (req) {
    parts.push(`${req.method} ${req.url}`);
    const h = formatHeaders(req.headers);
    if (h) parts.push(h);
    const b = formatBody(req.body, req.headers);
    if (b) {
      parts.push("");
      parts.push(b);
    }
  }

  const res = entry.response;
  if (res) {
    parts.push("");
    parts.push(`HTTP ${res.status} (${res.durationMs}ms)${res.mocked ? " [mocked]" : ""}`);
    const h = formatHeaders(res.headers);
    if (h) parts.push(h);
    const b = formatBody(res.body, res.headers);
    if (b) {
      parts.push("");
      parts.push(b);
    }
  }

  if (entry.error) {
    parts.push("");
    parts.push(`Error: ${entry.error.message}`);
  }

  return parts.join("\n");
}
