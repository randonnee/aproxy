import "./styles/global.css";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { RequestTable } from "./components/RequestTable/RequestTable";
import { DetailPanel } from "./components/DetailPanel/DetailPanel";
import { useSSE } from "./hooks/useSSE";
import { useInitialData } from "./hooks/useInitialData";

export function App() {
  useSSE();
  useInitialData();

  return (
    <>
      <TopBar />
      <div className="main">
        <Sidebar />
        <div className="content">
          <Toolbar />
          <RequestTable />
          <DetailPanel />
        </div>
      </div>
    </>
  );
}
