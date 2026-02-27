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
import { formatEntryAsText } from "./lib/helpers";

export function App() {
  useSSE();
  useInitialData();

  const theme = useAppStore((s) => s.theme);

  // Keep data-theme attribute in sync
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Cmd+C copies selected request+response when no text is selected
  useEffect(() => {
    function handleCopy(e: ClipboardEvent) {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      const state = useAppStore.getState();
      const entry = state.getSelectedEntry();
      if (!entry) return;

      e.preventDefault();
      const text = formatEntryAsText(entry);
      e.clipboardData?.setData("text/plain", text);

      // Flash the copied row
      state.setCopiedId(state.selectedId);
      setTimeout(() => useAppStore.getState().setCopiedId(null), 600);
    }

    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, []);

  // Detect Electrobun desktop app for traffic-light button spacing
  useEffect(() => {
    if ((window as any).__electrobunWebviewId != null) {
      document.documentElement.classList.add("desktop-app");
    }
  }, []);

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
