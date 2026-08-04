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
  const connected = useAppStore((s) => s.connected);

  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<api.ProxyTarget | null>(null);

  const count = orderedIds.length;
  // mitmproxy is a required dependency; if it isn't running we can't capture
  // anything, and enabling the system proxy would point macOS at a dead port.
  const engineDown = target !== null && !target.engineAvailable;

  useEffect(() => {
    api.getProxyTarget().then(setTarget).catch(() => { });
  }, []);

  const handleToggleProxy = async () => {
    setBusy(true);
    try {
      if (proxyEnabled) {
        const data = await api.disableProxy();
        setProxyEnabled(data.enabled);
      } else {
        const resolved = target ?? (await api.getProxyTarget());
        const data = await api.enableProxy(resolved.host);
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
          className={`proxy-btn ${proxyEnabled && connected ? "active" : ""}`}
          onClick={handleToggleProxy}
          disabled={busy || !connected || engineDown}
          title={engineDown ? target!.engineError ?? undefined : undefined}
        >
          <span
            className={`proxy-dot ${proxyEnabled && connected && !engineDown ? "on" : ""} ${!connected || engineDown ? "disconnected" : ""}`}
          />
          {!connected
            ? "Disconnected"
            : engineDown
              ? "mitmproxy unavailable"
              : proxyEnabled
                ? "Listening"
                : "Ready"}
          {connected && target && (
            <sub className="proxy-address">
              {engineDown ? target.engineError : `on ${target.host}:${target.proxyPort}`}
            </sub>
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
