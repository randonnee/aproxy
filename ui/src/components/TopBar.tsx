import { useState, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";

export function TopBar() {
  const orderedIds = useAppStore((s) => s.orderedIds);
  const clearRequests = useAppStore((s) => s.clearRequests);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const proxyEnabled = useAppStore((s) => s.proxyEnabled);
  const setProxyEnabled = useAppStore((s) => s.setProxyEnabled);

  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const port = window.location.port || "8080";

  const count = orderedIds.length;

  useEffect(() => {
    api.getPreferredHost().then(setHost).catch(() => { });
  }, []);

  const handleToggleProxy = async () => {
    setBusy(true);
    try {
      if (proxyEnabled) {
        const data = await api.disableProxy();
        setProxyEnabled(data.enabled);
      } else {
        const h = host || (await api.getPreferredHost());
        const data = await api.enableProxy(h, Number(port));
        setProxyEnabled(data.enabled);
      }
    } catch {
      // ignore
    }
    setBusy(false);
  };

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    api.setTheme(next).catch(() => { });
  };

  return (
    <div className="topbar">
      <div className="topbar-drag electrobun-webkit-app-region-drag" />
      <div className="topbar-left" />
      <div className="topbar-center">
        <button
          className={`proxy-btn ${proxyEnabled ? "active" : ""}`}
          onClick={handleToggleProxy}
          disabled={busy}
        >
          <span className={`proxy-dot ${proxyEnabled ? "on" : ""}`} />
          {proxyEnabled ? "Listening" : "Ready"}
          {host && (
            <sub className="proxy-address">on {host}:{port}</sub>
          )}
        </button>
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
