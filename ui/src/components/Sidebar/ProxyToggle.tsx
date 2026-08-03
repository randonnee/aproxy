import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ProxyToggle() {
  const proxyEnabled = useAppStore((s) => s.proxyEnabled);
  const setProxyEnabled = useAppStore((s) => s.setProxyEnabled);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<api.ProxyTarget | null>(null);

  useEffect(() => {
    api.getProxyTarget().then(setTarget).catch(() => {});
  }, []);

  const handleToggle = async () => {
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

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">System Proxy</div>
      {target && (
        <div className="proxy-address">{target.host}:{target.proxyPort}</div>
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
