import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

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

export function ViewList() {
  const views = useAppStore((s) => s.views);
  const activeViewId = useAppStore((s) => s.activeViewId);
  const defaultViewId = useAppStore((s) => s.defaultViewId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setViews = useAppStore((s) => s.setViews);
  const setCurrentScreen = useAppStore((s) => s.setCurrentScreen);

  const handleSetDefault = async (
    id: string | null,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      const data = await api.setDefaultView(id);
      setViews(data.views, data.defaultViewId);
    } catch {
      // ignore
    }
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <span>Views</span>
        <div className="sidebar-title-actions">
          <button
            className="sidebar-icon-btn"
            onClick={() => setCurrentScreen("view-manager")}
            title="Manage views"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
            </svg>
          </button>
        </div>
      </div>
      <div>
        {views.length === 0 ? (
          <div className="sidebar-empty">No views loaded</div>
        ) : (
          <>
            <div
              className={`scenario-item${activeViewId === null ? " active" : ""}`}
              onClick={() => setActiveView(null)}
            >
              <div className="dot" />
              <span>All requests</span>
              {defaultViewId === null && (
                <span className="view-default-badge">default</span>
              )}
              {activeViewId === null && defaultViewId !== null && (
                <span
                  className="view-set-default"
                  onClick={(e) => handleSetDefault(null, e)}
                >
                  set default
                </span>
              )}
            </div>

            {views.map((v) => {
              const isActive = v.id === activeViewId;
              const isDefault = v.id === defaultViewId;
              return (
                <div key={v.id}>
                  <div
                    className={`scenario-item${isActive ? " active" : ""}`}
                    onClick={() => setActiveView(v.id)}
                  >
                    <div className="dot" />
                    <span>{v.name || v.id}</span>
                    {isDefault && (
                      <span className="view-default-badge">default</span>
                    )}
                    {isActive && !isDefault && (
                      <span
                        className="view-set-default"
                        onClick={(e) => handleSetDefault(v.id, e)}
                      >
                        set default
                      </span>
                    )}
                    {v.description && <InfoTip text={v.description} />}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
