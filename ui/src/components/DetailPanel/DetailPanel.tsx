import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppStore, type DetailTab } from "../../stores/appStore";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./BodyTab";
import { MessagesTab } from "./MessagesTab";
import { ResizeHandle } from "./ResizeHandle";
import { CopyBtn } from "./CopyBtn";
import { parseUrl } from "../../lib/helpers";
import type { RequestEvent } from "../../lib/types";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
];

const WS_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "messages", label: "Messages" },
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

function ClickableUrl({ url }: { url: string }) {
  const { host, path } = parseUrl(url);
  const [copied, setCopied] = useState(false);
  const [toastPos, setToastPos] = useState<{ top: number; left: number } | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    navigator.clipboard.writeText(url).then(() => {
      setToastPos({ top: e.clientY - 30, left: e.clientX });
      setCopied(true);
      setTimeout(() => setCopied(false), 600);
    });
  }, [url]);

  return (
    <>
      <span
        className={`pane-url clickable${copied ? " copied" : ""}`}
        title={url}
        onClick={handleClick}
      >
        {host}{path}
      </span>
      {copied && toastPos && createPortal(
        <div className="copy-toast" style={{ top: toastPos.top, left: toastPos.left }}>
          Copied
        </div>,
        document.body
      )}
    </>
  );
}

function RequestPane() {
  const entry = useAppStore((s) => s.getSelectedEntry());
  const reqTab = useAppStore((s) => s.reqTab);
  const setReqTab = useAppStore((s) => s.setReqTab);

  const req = entry?.request;
  if (!req) return <div className="detail-pane"><div className="detail-empty">No request data</div></div>;

  return (
    <div className="detail-pane">
      <div className="pane-header">
        <div className="pane-summary">
          <span className={`method method-${req.method}`}>{req.method}</span>
          <ClickableUrl url={req.url} />
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
        {reqTab === "body" && <RequestBodyTab request={req} />}
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
  const isWs = entry?.request?.method === "WS";
  const tabs = isWs ? WS_TABS : TABS;

  return (
    <div className="detail-pane">
      <div className="pane-header">
        <div className="pane-summary">
          {res ? (
            <>
              <span className={`status-badge status-${Math.floor(res.status / 100)}xx`}>
                {res.status}
              </span>
              {isWs ? (
                <span className={`pane-ws-status ${entry?.wsClosed ? "closed" : "open"}`}>
                  {entry?.wsClosed ? "Closed" : "Open"}
                  {entry?.wsMessages ? ` \u00b7 ${entry.wsMessages.length} msg${entry.wsMessages.length !== 1 ? "s" : ""}` : ""}
                </span>
              ) : (
                <span className="pane-duration">{res.durationMs}ms</span>
              )}
              {res.mocked && <span className="pane-mocked">mocked</span>}
            </>
          ) : err ? (
            <span className="pane-error">{err.message}</span>
          ) : (
            <span className="pane-pending">Pending...</span>
          )}
        </div>
        <div className="detail-tabs">
          {tabs.map((tab) => (
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
        {resTab === "messages" && <MessagesTab messages={entry?.wsMessages} />}
      </div>
    </div>
  );
}

function RequestBodyTab({ request }: { request: RequestEvent }) {
  if (!request.body) {
    return <div className="detail-empty">No request body</div>;
  }

  const contentType =
    request.headers?.["content-type"] ??
    request.headers?.["Content-Type"] ??
    "";

  let formatted = request.body;
  if (contentType.includes("json")) {
    try {
      formatted = JSON.stringify(JSON.parse(request.body), null, 2);
    } catch {
      // use raw body
    }
  }

  return (
    <div className="body-wrap">
      <CopyBtn text={formatted} title="Copy body" className="body-copy-btn" />
      <pre className="body-viewer">{formatted}</pre>
    </div>
  );
}
