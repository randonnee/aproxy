import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ScenarioList() {
  const scenarios = useAppStore((s) => s.scenarios);
  const activeScenarioIds = useAppStore((s) => s.activeScenarioIds);
  const setScenarios = useAppStore((s) => s.setScenarios);
  const setCurrentScreen = useAppStore((s) => s.setCurrentScreen);

  const handleToggle = async (id: string | null) => {
    try {
      const data = await api.toggleScenario(id);
      setScenarios(data.scenarios, data.activeScenarioIds);
    } catch {
      // ignore
    }
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <span>Proxy Scenarios</span>
        <div className="sidebar-title-actions">
          <button
            className="sidebar-icon-btn"
            onClick={() => setCurrentScreen("scenario-manager")}
            title="Manage scenarios"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
            </svg>
          </button>
        </div>
      </div>
      <div>
        {scenarios.length === 0 ? (
          <div className="sidebar-empty">No scenarios loaded</div>
        ) : (
          <>
            <div
              className={`scenario-item${activeScenarioIds.length === 0 ? " active" : ""}`}
              onClick={() => handleToggle(null)}
            >
              <span>None (passthrough)</span>
            </div>

            {scenarios.map((s) => (
              <div key={s.id}>
                <div
                  className={`scenario-item${activeScenarioIds.includes(s.id) ? " active" : ""}`}
                  onClick={() => handleToggle(s.id)}
                >
                  <Checkbox checked={activeScenarioIds.includes(s.id)} />
                  <span>{s.name || s.id}</span>
                  {s.description && <InfoTip text={s.description} />}
                </div>
                {activeScenarioIds.includes(s.id) && s.rules.length > 1 && (
                  <div className="rule-list">
                    {s.rules.map((r) => (
                      <div key={r.id} className="rule-item">
                        <div className="rule-name">{r.name || r.id}</div>
                        {r.description && <InfoTip text={r.description} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <svg className="scenario-checkbox" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1" fill={checked ? "var(--accent)" : "none"} />
      {checked && (
        <path d="M3.5 7.5L5.5 9.5L10.5 4.5" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip">
      <span className="info-btn">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm1.5 8h-3v-1h1V7.5h-1v-1h2V11h1v1Z" />
        </svg>
      </span>
      <span className="info-tip-text">{text}</span>
    </span>
  );
}
