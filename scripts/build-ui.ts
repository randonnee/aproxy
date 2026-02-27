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
// `electrobun dev` restarts, the bundle keeps stale content-hashed assets.
// Sync the fresh ui/dist into the bundle directly so restarts always pick up
// the latest build.
const bundleViewDir = join(
  "build",
  "dev-macos-arm64",
  "Aproxy-dev.app",
  "Contents",
  "Resources",
  "app",
  "views",
  "mainview"
);

try {
  await rm(bundleViewDir, { recursive: true, force: true });
  await mkdir(bundleViewDir, { recursive: true });
  await cp("ui/dist/index.html", join(bundleViewDir, "index.html"));
  await cp("ui/dist/assets", join(bundleViewDir, "assets"), { recursive: true });
  console.log("Synced UI into Electrobun bundle");
} catch {
  // Bundle dir may not exist on first build — Electrobun's copy handles it
}
