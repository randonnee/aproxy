import { CaTrust } from "./CaCertificate";
import { ScenarioList } from "./ScenarioList";
import { ViewList } from "./ViewList";

export function Sidebar() {
  return (
    <div className="sidebar">
      <ScenarioList />
      <ViewList />
      <CaTrust />
    </div>
  );
}
