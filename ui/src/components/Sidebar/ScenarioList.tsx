import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ScenarioList() {
  const scenarios = useAppStore((s) => s.scenarios);
  const activeScenarioId = useAppStore((s) => s.activeScenarioId);
  const setScenarios = useAppStore((s) => s.setScenarios);

  const handleSetActive = async (id: string | null) => {
    try {
      const data = await api.setActiveScenario(id);
      setScenarios(data.scenarios, data.activeScenarioId);
    } catch {
      // ignore
    }
  };

  const handleReload = async () => {
    try {
      await api.reloadRules();
      const data = await api.getScenarios();
      setScenarios(data.scenarios, data.activeScenarioId);
    } catch {
      // ignore
    }
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">Scenarios</div>
      <div>
        {scenarios.length === 0 ? (
          <div className="sidebar-empty">No scenarios loaded</div>
        ) : (
          <>
            {/* None option */}
            <div
              className={`scenario-item${activeScenarioId === null ? " active" : ""}`}
              onClick={() => handleSetActive(null)}
            >
              <div className="dot" />
              <span>None (passthrough)</span>
            </div>

            {scenarios.map((s) => (
              <div key={s.id}>
                <div
                  className={`scenario-item${s.id === activeScenarioId ? " active" : ""}`}
                  onClick={() => handleSetActive(s.id)}
                >
                  <div className="dot" />
                  <span>{s.name || s.id}</span>
                </div>
                {s.description && (
                  <div className="scenario-desc">{s.description}</div>
                )}
                {s.id === activeScenarioId && s.rules.length > 0 && (
                  <div className="rule-list">
                    {s.rules.map((r) => (
                      <div key={r.id} className="rule-item">
                        <div className="rule-name">{r.name || r.id}</div>
                        {r.description && (
                          <div className="rule-desc">{r.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      <button className="sidebar-btn" onClick={handleReload}>
        Reload Rules
      </button>
    </div>
  );
}
