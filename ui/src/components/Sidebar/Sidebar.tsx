import { ProxyToggle } from "./ProxyToggle";
import { CaCertificate } from "./CaCertificate";
import { ScenarioList } from "./ScenarioList";
import { ViewList } from "./ViewList";
import { SimulatorList } from "./SimulatorList";

export function Sidebar() {
  return (
    <div className="sidebar">
      <ProxyToggle />
      <CaCertificate />
      <ScenarioList />
      <ViewList />
      <SimulatorList />
    </div>
  );
}
