import { useAppStore } from "../stores/appStore";

export function TopBar() {
  const connected = useAppStore((s) => s.connected);
  const proxyEnabled = useAppStore((s) => s.proxyEnabled);
  const orderedIds = useAppStore((s) => s.orderedIds);
  const clearRequests = useAppStore((s) => s.clearRequests);

  const dotClass = !connected
    ? "conn-dot disconnected"
    : proxyEnabled
      ? "conn-dot active"
      : "conn-dot";

  const count = orderedIds.length;

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className={dotClass} />
        <h1>Aproxy</h1>
      </div>
      <div className="topbar-right">
        <span className="count">
          {count} request{count !== 1 ? "s" : ""}
        </span>
        <button onClick={clearRequests}>Clear</button>
      </div>
    </div>
  );
}
