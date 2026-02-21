import { useAppStore } from "../stores/appStore";

export function Toolbar() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const methodFilter = useAppStore((s) => s.methodFilter);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setMethodFilter = useAppStore((s) => s.setMethodFilter);

  return (
    <div className="toolbar">
      <input
        type="text"
        placeholder="Filter by URL, method, status..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <select
        value={methodFilter}
        onChange={(e) => setMethodFilter(e.target.value)}
      >
        <option value="all">All Methods</option>
        <option value="GET">GET</option>
        <option value="POST">POST</option>
        <option value="PUT">PUT</option>
        <option value="DELETE">DELETE</option>
        <option value="PATCH">PATCH</option>
        <option value="CONNECT">CONNECT</option>
      </select>
    </div>
  );
}
