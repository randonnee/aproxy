import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function CaTrust() {
  const caTrusted = useAppStore((s) => s.caTrusted);
  const setCaTrusted = useAppStore((s) => s.setCaTrusted);
  const simulators = useAppStore((s) => s.simulators);
  const setSimulators = useAppStore((s) => s.setSimulators);
  const updateSimulator = useAppStore((s) => s.updateSimulator);

  const activeSimulators = simulators.filter((sim) => sim.isBooted);

  const handleRefreshSimulators = async () => {
    try {
      const data = await api.getSimulators();
      setSimulators(data.simulators);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    window.open("/ca/cert", "_blank");
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <span>CA Trust</span>
        <div className="sidebar-title-actions">
          <button
            className="sidebar-icon-btn"
            onClick={handleRefreshSimulators}
            title="Refresh simulators"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
            </svg>
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={handleDownload}
            title="Download CA certificate"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v9" />
              <path d="M4.5 7.5 8 11l3.5-3.5" />
              <path d="M2 13h12" />
            </svg>
          </button>
        </div>
      </div>
      <div>
        <HostEntry
          trusted={caTrusted}
          onTrusted={() => setCaTrusted(true)}
        />
        {activeSimulators.map((sim) => (
          <SimulatorEntry
            key={sim.udid}
            sim={sim}
            onTrusted={(udid) => updateSimulator(udid, { caTrusted: true })}
          />
        ))}
      </div>
    </div>
  );
}

function HostEntry({
  trusted,
  onTrusted,
}: {
  trusted: boolean;
  onTrusted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  const handleTrust = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (trusted) return;
    setBusy(true);
    setLabel("...");
    try {
      const data = await api.trustCaOnHost();
      if (data.trusted) {
        onTrusted();
        setLabel(null);
        setBusy(false);
        return;
      }
      const status = await api.getCaTrustStatus();
      if (status.trusted) {
        onTrusted();
        setLabel(null);
      } else {
        setLabel("Failed");
        setTimeout(() => setLabel(null), 2000);
      }
    } catch {
      const status = await api.getCaTrustStatus().catch(() => ({ trusted: false }));
      if (status.trusted) {
        onTrusted();
        setLabel(null);
      } else {
        setLabel("Failed");
        setTimeout(() => setLabel(null), 2000);
      }
    }
    setBusy(false);
  };

  return (
    <div className="sim-entry-row">
      <div className="sim-entry">
        <span className="sim-name">This Mac</span>
      </div>
      {trusted ? (
        <span className="sim-badge trusted">Trusted</span>
      ) : (
        <button
          className="sim-trust-btn primary"
          onClick={handleTrust}
          disabled={busy}
        >
          {label ?? "Trust"}
        </button>
      )}
    </div>
  );
}

function SimulatorEntry({
  sim,
  onTrusted,
}: {
  sim: { udid: string; name: string; state: string; caTrusted?: boolean };
  onTrusted: (udid: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  const handleTrust = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sim.caTrusted) return;
    setBusy(true);
    setLabel("...");
    try {
      const res = await api.trustCaOnSimulator(sim.udid);
      if (res.simulator) {
        onTrusted(sim.udid);
        setLabel(null);
      } else {
        setLabel("Failed");
        setTimeout(() => setLabel(null), 2000);
      }
    } catch {
      setLabel("Failed");
      setTimeout(() => setLabel(null), 2000);
    }
    setBusy(false);
  };

  return (
    <div className="sim-entry-row">
      <div className="sim-entry">
        <span className="sim-name">{sim.name}</span>
      </div>
      {sim.caTrusted ? (
        <span className="sim-badge trusted">Trusted</span>
      ) : (
        <button
          className="sim-trust-btn primary"
          onClick={handleTrust}
          disabled={busy}
        >
          {label ?? "Trust"}
        </button>
      )}
    </div>
  );
}
