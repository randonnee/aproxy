import { useAppStore, type DetailTab } from "../../stores/appStore";
import { OverviewTab } from "./OverviewTab";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./BodyTab";
import { ResizeHandle } from "./ResizeHandle";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "req-headers", label: "Request Headers" },
  { id: "res-headers", label: "Response Headers" },
  { id: "res-body", label: "Response Body" },
];

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const detailHeight = useAppStore((s) => s.detailHeight);

  if (!selectedId) return null;

  return (
    <>
      <ResizeHandle />
      <div className="detail-panel" style={{ height: detailHeight }}>
        <div className="detail-tabs">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              className={`detail-tab${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
        <div className="detail-content">
          <TabContent tab={activeTab} />
        </div>
      </div>
    </>
  );
}

function TabContent({ tab }: { tab: DetailTab }) {
  const entry = useAppStore((s) => s.getSelectedEntry());

  if (!entry?.request) {
    return (
      <div className="detail-empty">Select a request to view details</div>
    );
  }

  switch (tab) {
    case "overview":
      return (
        <OverviewTab
          request={entry.request}
          response={entry.response}
          error={entry.error}
        />
      );
    case "req-headers":
      return <HeadersTab headers={entry.request.headers} label="Request" />;
    case "res-headers":
      return (
        <HeadersTab headers={entry.response?.headers} label="Response" />
      );
    case "res-body":
      return <BodyTab response={entry.response} />;
    default:
      return null;
  }
}
