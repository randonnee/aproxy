import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ViewList() {
  const views = useAppStore((s) => s.views);
  const activeViewId = useAppStore((s) => s.activeViewId);
  const defaultViewId = useAppStore((s) => s.defaultViewId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setViews = useAppStore((s) => s.setViews);

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
      <div className="sidebar-title">Views</div>
      <div>
        {views.length === 0 ? (
          <div className="sidebar-empty">No views loaded</div>
        ) : (
          <>
            {/* All requests option */}
            <div
              className={`scenario-item${activeViewId === null ? " active" : ""}`}
              onClick={() => setActiveView(null)}
            >
              <div className="dot" />
              <span>All requests</span>
              {defaultViewId === null && activeViewId === null && (
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
                  </div>
                  {v.description && (
                    <div className="scenario-desc">{v.description}</div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
