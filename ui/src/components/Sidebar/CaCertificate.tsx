import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function CaCertificate() {
  const caTrusted = useAppStore((s) => s.caTrusted);
  const setCaTrusted = useAppStore((s) => s.setCaTrusted);
  const [trustLabel, setTrustLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleTrust = async () => {
    if (caTrusted) return;
    setBusy(true);
    setTrustLabel("Trusting...");
    try {
      const data = await api.trustCaOnHost();
      if (data.trusted) {
        setCaTrusted(true);
        setTrustLabel(null);
        return;
      }
      // Refresh status
      const status = await api.getCaTrustStatus();
      if (status.trusted) {
        setCaTrusted(true);
        setTrustLabel(null);
      } else {
        setTrustLabel("Failed");
        setTimeout(() => setTrustLabel(null), 2000);
      }
    } catch {
      const status = await api.getCaTrustStatus().catch(() => ({ trusted: false }));
      if (status.trusted) {
        setCaTrusted(true);
        setTrustLabel(null);
      } else {
        setTrustLabel("Failed");
        setTimeout(() => setTrustLabel(null), 2000);
      }
    }
    setBusy(false);
  };

  const handleDownload = () => {
    window.open("/ca/cert", "_blank");
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">CA Certificate</div>
      <div className="ca-status-row">
        <span className="label">Host Trust</span>
        <span className={`state ${caTrusted ? "trusted" : "untrusted"}`}>
          {caTrusted ? "Trusted" : "Not Trusted"}
        </span>
      </div>
      <div className="ca-actions">
        <button
          className={caTrusted ? "" : "primary"}
          onClick={handleTrust}
          disabled={caTrusted || busy}
        >
          {trustLabel ?? (caTrusted ? "Trusted" : "Trust on Mac")}
        </button>
        <button onClick={handleDownload}>Download</button>
      </div>
      {!caTrusted && (
        <div className="ca-note">Will prompt for admin password</div>
      )}
    </div>
  );
}
