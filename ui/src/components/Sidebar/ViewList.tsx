import { useRef } from "react";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";

export function ViewList() {
  const views = useAppStore((s) => s.views);
  const activeViewId = useAppStore((s) => s.activeViewId);
  const defaultViewId = useAppStore((s) => s.defaultViewId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setViews = useAppStore((s) => s.setViews);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      await api.importViewFile(file.name, content);
      const data = await api.getViews();
      setViews(data.views, data.defaultViewId);
    } catch {
      // ignore
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <span>Views</span>
        <div className="sidebar-title-actions">
          <button
            className="sidebar-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Import view"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ts,.js"
        onChange={handleFileUpload}
        style={{ display: "none" }}
      />
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
                    data-tooltip={v.description || undefined}
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
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
