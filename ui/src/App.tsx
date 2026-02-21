import { useEffect } from "react";
import "./styles/global.css";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { RequestTable } from "./components/RequestTable/RequestTable";
import { DetailPanel } from "./components/DetailPanel/DetailPanel";
import { useSSE } from "./hooks/useSSE";
import { useInitialData } from "./hooks/useInitialData";
import { useAppStore } from "./stores/appStore";

export function App() {
  useSSE();
  useInitialData();

  const theme = useAppStore((s) => s.theme);

  // Keep data-theme attribute in sync
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
