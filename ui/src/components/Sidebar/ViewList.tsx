import { useRef } from "react";
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
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
