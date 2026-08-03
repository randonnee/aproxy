import { $ } from "bun";
import { rm, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

// When building for the Electrobun desktop app, the UI is loaded via views://
// protocol instead of from the backend server. API calls need an absolute URL
// to reach the backend.
const PROXY_PORT = process.env.PROXY_PORT ?? "8080";
process.env.VITE_API_BASE = `http://127.0.0.1:${PROXY_PORT}`;

console.log(`Building UI (API_BASE=${process.env.VITE_API_BASE})...`);
await $`bun run --cwd ui build`;
console.log("UI build complete");

// Electrobun's copy config only runs on the initial build. On subsequent
// `electrobun dev` restarts, the bundle keeps stale content-hashed assets and
// never picks up newly-added copy entries. Sync everything the bun entry point
// resolves at runtime directly into the bundle so restarts stay correct.
const bundleAppDir = join(
  "build",
  "dev-macos-arm64",
  "Aproxy-dev.app",
  "Contents",
  "Resources",
  "app"
);
const bundleViewDir = join(bundleAppDir, "views", "mainview");

try {
  await rm(bundleViewDir, { recursive: true, force: true });
  await mkdir(bundleViewDir, { recursive: true });
  await cp("ui/dist/index.html", join(bundleViewDir, "index.html"));
  await cp("ui/dist/assets", join(bundleViewDir, "assets"), { recursive: true });
  await mkdir(join(bundleAppDir, "bun"), { recursive: true });
  await cp("src/ruleSandboxWorker.ts", join(bundleAppDir, "bun", "ruleSandboxWorker.ts"));
  await mkdir(join(bundleAppDir, "python"), { recursive: true });
  await cp("python/aproxy_addon.py", join(bundleAppDir, "python", "aproxy_addon.py"));
  console.log("Synced UI, rule worker and mitmproxy addon into Electrobun bundle");
} catch {
  // Bundle dir may not exist on first build — Electrobun's copy handles it
}
