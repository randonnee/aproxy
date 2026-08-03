import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".aproxy");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export type ProxyBackend = "builtin" | "mitmproxy";

export type AproxyConfig = {
  defaultViewId: string | null;
  theme: "light" | "dark";
  maxRequests: number;
  /** Which proxy engine to run: the built-in TCP proxy or a mitmdump subprocess. */
  proxyBackend: ProxyBackend;
};

const defaults: AproxyConfig = {
  defaultViewId: null,
  theme: "dark",
  maxRequests: 1000,
  proxyBackend: "builtin",
};

/**
 * Resolve the proxy backend. `APROXY_BACKEND` wins over the persisted config so
 * the two engines can be A/B tested without editing config.json.
 */
export function resolveProxyBackend(config: AproxyConfig): ProxyBackend {
  const override = process.env.APROXY_BACKEND?.trim().toLowerCase();
  if (override === "mitmproxy" || override === "mitm") return "mitmproxy";
  if (override === "builtin") return "builtin";
  return config.proxyBackend === "mitmproxy" ? "mitmproxy" : "builtin";
}

export function loadConfig(): AproxyConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...defaults };
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const next = { ...defaults, ...parsed } as AproxyConfig;
    if (!Number.isFinite(next.maxRequests) || next.maxRequests <= 0) {
      next.maxRequests = defaults.maxRequests;
    }
    if (next.proxyBackend !== "builtin" && next.proxyBackend !== "mitmproxy") {
      next.proxyBackend = defaults.proxyBackend;
    }
    return next;
  } catch {
    return { ...defaults };
  }
}

export function saveConfig(config: AproxyConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
