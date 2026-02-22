import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ProxyToggle() {
  const proxyEnabled = useAppStore((s) => s.proxyEnabled);
  const setProxyEnabled = useAppStore((s) => s.setProxyEnabled);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<string | null>(null);

  const port = window.location.port || "8080";

  useEffect(() => {
    api.getPreferredHost().then(setHost).catch(() => {});
  }, []);

  const handleToggle = async () => {
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

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">System Proxy</div>
      {host && (
        <div className="proxy-address">{host}:{port}</div>
      )}
      <div className="proxy-toggle">
        <button
          className={proxyEnabled ? "danger" : "primary"}
          onClick={handleToggle}
          disabled={busy}
        >
          {proxyEnabled ? "Disable Proxy" : "Enable Proxy"}
        </button>
      </div>
    </div>
  );
}
