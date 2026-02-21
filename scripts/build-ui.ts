import { $ } from "bun";

console.log("Building UI...");
await $`bun run --cwd ui build`;
console.log("UI build complete");
