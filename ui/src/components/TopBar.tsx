import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";

export function TopBar() {
  const orderedIds = useAppStore((s) => s.orderedIds);
  const clearRequests = useAppStore((s) => s.clearRequests);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const count = orderedIds.length;

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    api.setTheme(next).catch(() => {});
  };

  return (
    <div className="topbar">
      {/* Drag region overlay for Electrobun window dragging (sits behind content) */}
      <div className="topbar-drag electrobun-webkit-app-region-drag" />
      <div className="topbar-left">
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
