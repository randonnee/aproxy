import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function SimulatorList() {
  const simulators = useAppStore((s) => s.simulators);
  const setSimulators = useAppStore((s) => s.setSimulators);
  const updateSimulator = useAppStore((s) => s.updateSimulator);

  const activeSimulators = simulators.filter((sim) => sim.isBooted);

  const handleRefresh = async () => {
    try {
      const data = await api.getSimulators();
      setSimulators(data.simulators);
    } catch {
      // ignore
    }
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">Simulators</div>
      <div>
        {activeSimulators.length === 0 ? (
          <div className="sidebar-empty">No active simulators</div>
        ) : (
          activeSimulators.map((sim) => (
            <SimulatorEntry
              key={sim.udid}
              sim={sim}
              onTrusted={(udid) =>
                updateSimulator(udid, { caTrusted: true })
              }
            />
          ))
        )}
      </div>
      <button className="sidebar-btn" onClick={handleRefresh}>
        Refresh
      </button>
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
        <span className="sim-badge booted">{sim.state}</span>
      </div>
      <button
        className={`sim-trust-btn${sim.caTrusted ? " trusted" : " primary"}`}
        onClick={handleTrust}
        disabled={sim.caTrusted || busy}
      >
        {label ?? (sim.caTrusted ? "Trusted" : "Trust CA")}
      </button>
    </div>
  );
}
