import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".aproxy");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export type AproxyConfig = {
  defaultViewId: string | null;
  theme: "light" | "dark";
};

const defaults: AproxyConfig = {
  defaultViewId: null,
  theme: "dark",
};

export function loadConfig(): AproxyConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...defaults };
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveConfig(config: AproxyConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
