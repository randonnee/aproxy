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
