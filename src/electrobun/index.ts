import { BrowserWindow, ApplicationMenu, Updater, Utils } from "electrobun/bun";
import { resolve } from "node:path";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8080);
const DEV_SERVER_PORT = 3000;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Resolve resource paths relative to the Electrobun app bundle.
// The launcher always sets cwd to .app/Contents/MacOS/, so resolve("../Resources/")
// works reliably in both dev and production builds (including ASAR extraction).
const appBundleDir = resolve("../Resources/app");
process.env.APROXY_EXAMPLES_DIR = resolve(appBundleDir, "examples");

process.env.APROXY_RULES_WORKER_PATH = resolve(appBundleDir, "bun", "ruleSandboxWorker.ts");
process.env.APROXY_MITM_ADDON = resolve(appBundleDir, "python", "aproxy_addon.py");

// Mark as production unless already set — must happen before importing server
// code so the CORS allowlist is built without dev-only origins.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

// Dynamic import so env vars are set before server.ts resolves paths
const { startProxy, disableProxySync } = await import("../index");

// Start the proxy server (TCP listener on :8080)
await startProxy();

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run --cwd ui dev' for HMR support."
      );
    }
  }
  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

// Create native window loading the bundled view (or HMR dev server in dev).
const appWindow = new BrowserWindow({
  title: "Aproxy",
  url,
  titleBarStyle: "hiddenInset",
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
});

ApplicationMenu.setApplicationMenu([
  {
    label: "Aproxy",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "quit", accelerator: "q" }
    ],
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
    ],
  },
]);

appWindow.on("close", () => {
  disableProxySync();
  Utils.quit();
});

console.log(`[${(new Date()).toLocaleString()}]Aproxy desktop app started (control API on :${PROXY_PORT})`);
