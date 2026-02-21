import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";

export function TopBar() {
  const connected = useAppStore((s) => s.connected);
  const proxyEnabled = useAppStore((s) => s.proxyEnabled);
  const orderedIds = useAppStore((s) => s.orderedIds);
  const clearRequests = useAppStore((s) => s.clearRequests);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const dotClass = !connected
    ? "conn-dot disconnected"
    : proxyEnabled
      ? "conn-dot active"
      : "conn-dot";

  const count = orderedIds.length;

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    api.setTheme(next).catch(() => {});
  };

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
        <button
          className="theme-toggle"
          onClick={handleToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "\u263C" : "\u263E"}
        </button>
      </div>
    </div>
  );
}
