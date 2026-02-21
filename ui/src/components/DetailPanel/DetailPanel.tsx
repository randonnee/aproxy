import { useAppStore, type DetailTab } from "../../stores/appStore";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./BodyTab";
import { ResizeHandle } from "./ResizeHandle";
import { parseUrl, formatTime } from "../../lib/helpers";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
];

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const detailHeight = useAppStore((s) => s.detailHeight);

  if (!selectedId) return null;

  return (
    <>
      <ResizeHandle />
      <div className="detail-panel" style={{ height: detailHeight }}>
        <div className="detail-split">
          <RequestPane />
          <div className="detail-divider" />
          <ResponsePane />
        </div>
      </div>
    </>
  );
}

function RequestPane() {
  const entry = useAppStore((s) => s.getSelectedEntry());
  const reqTab = useAppStore((s) => s.reqTab);
  const setReqTab = useAppStore((s) => s.setReqTab);

  const req = entry?.request;
  if (!req) return <div className="detail-pane"><div className="detail-empty">No request data</div></div>;

  const { host, path } = parseUrl(req.url);

  return (
    <div className="detail-pane">
      <div className="pane-header">
        <div className="pane-summary">
          <span className={`method method-${req.method}`}>{req.method}</span>
          <span className="pane-url" title={req.url}>{host}{path}</span>
          <span className="pane-time">{formatTime(req.timestamp)}</span>
        </div>
        <div className="detail-tabs">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              className={`detail-tab${reqTab === tab.id ? " active" : ""}`}
              onClick={() => setReqTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>
      <div className="detail-content">
        {reqTab === "headers" && <HeadersTab headers={req.headers} label="Request" />}
        {reqTab === "body" && <div className="detail-empty">No request body captured</div>}
      </div>
    </div>
  );
}

function ResponsePane() {
  const entry = useAppStore((s) => s.getSelectedEntry());
  const resTab = useAppStore((s) => s.resTab);
  const setResTab = useAppStore((s) => s.setResTab);

  const res = entry?.response;
  const err = entry?.error;

  return (
    <div className="detail-pane">
      <div className="pane-header">
        <div className="pane-summary">
          {res ? (
            <>
              <span className={`status-badge status-${Math.floor(res.status / 100)}xx`}>
                {res.status}
              </span>
              <span className="pane-duration">{res.durationMs}ms</span>
              {res.mocked && <span className="pane-mocked">mocked</span>}
            </>
          ) : err ? (
            <span className="pane-error">{err.message}</span>
          ) : (
            <span className="pane-pending">Pending...</span>
          )}
        </div>
        <div className="detail-tabs">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              className={`detail-tab${resTab === tab.id ? " active" : ""}`}
              onClick={() => setResTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>
      <div className="detail-content">
        {resTab === "headers" && (
          <HeadersTab headers={res?.headers} label="Response" />
        )}
        {resTab === "body" && <BodyTab response={res} />}
      </div>
    </div>
  );
}
