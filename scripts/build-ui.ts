import { $ } from "bun";

// When building for the Electrobun desktop app, the UI is loaded via views://
// protocol instead of from the backend server. API calls need an absolute URL
// to reach the backend.
const PROXY_PORT = process.env.PROXY_PORT ?? "8080";
process.env.VITE_API_BASE = `http://127.0.0.1:${PROXY_PORT}`;

console.log(`Building UI (API_BASE=${process.env.VITE_API_BASE})...`);
await $`bun run --cwd ui build`;
console.log("UI build complete");
