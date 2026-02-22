import { BrowserWindow, ApplicationMenu, Utils } from "electrobun/bun";
import { resolve } from "node:path";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8080);

// Resolve resource paths relative to the Electrobun app bundle.
// The launcher always sets cwd to .app/Contents/MacOS/, so resolve("../Resources/")
// works reliably in both dev and production builds (including ASAR extraction).
const resourcesDir = resolve("../Resources/app");
process.env.APROXY_UI_DIR = resolve(resourcesDir, "views", "mainview");
process.env.APROXY_EXAMPLES_DIR = resolve(resourcesDir, "examples");

// Dynamic import so env vars are set before server.ts resolves paths
const { startProxy, disableProxySync } = await import("../index");

// Start the proxy server (TCP listener on :8080)
await startProxy();

// Create native window pointing to the control server
const mainWindow = new BrowserWindow({
  title: "Aproxy",
  url: `http://127.0.0.1:${PROXY_PORT}`,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
});

// Standard Edit menu for copy/paste keyboard shortcuts
ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

mainWindow.on("close", () => {
  disableProxySync();
  Utils.quit();
});

console.log(`Aproxy desktop app started (proxy on :${PROXY_PORT})`);
