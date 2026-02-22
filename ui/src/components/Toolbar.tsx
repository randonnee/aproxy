import { useAppStore } from "../stores/appStore";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

export function Toolbar() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const methodFilters = useAppStore((s) => s.methodFilters);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const toggleMethodFilter = useAppStore((s) => s.toggleMethodFilter);

  return (
    <div className="toolbar">
      <input
        type="text"
        placeholder="Filter by URL, method, status..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className="method-filters">
        {METHODS.map((m) => (
          <label key={m} className={`method-chip ${methodFilters.has(m) ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={methodFilters.has(m)}
              onChange={() => toggleMethodFilter(m)}
            />
            <span className={`method-label method-${m}`}>{m}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
