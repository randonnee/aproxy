import type {
  Scenario,
  ViewDef,
  SimulatorInfo,
} from "../lib/types";

const API_BASE = "";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  return res.json() as Promise<T>;
}

export async function getProxyStatus(): Promise<{ enabled: boolean }> {
  return fetchJson("/proxy/status");
}

export async function enableProxy(
  proxyHost: string,
  proxyPort: number
): Promise<{ enabled: boolean }> {
  return fetchJson("/proxy/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxyHost, proxyPort }),
  });
}

export async function disableProxy(): Promise<{ enabled: boolean }> {
  return fetchJson("/proxy/disable", { method: "POST" });
}

export async function getPreferredHost(): Promise<string> {
  try {
    const data = await fetchJson<{ host: string }>("/host");
    return data.host || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

export async function getScenarios(): Promise<{
  scenarios: Scenario[];
  activeScenarioId: string | null;
}> {
  return fetchJson("/scenarios");
}

export async function setActiveScenario(
  scenarioId: string | null
): Promise<{
  scenarios: Scenario[];
  activeScenarioId: string | null;
}> {
  return fetchJson("/scenarios/active", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
}

export async function reloadRules(): Promise<void> {
  await fetch(`${API_BASE}/rules/reload`, { method: "POST" });
}

// --- Import: upload a file to scenarios or views ---

export async function importScenarioFile(
  filename: string,
  content: string
): Promise<{ imported: string }> {
  return fetchJson("/scenarios/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
}

export async function importViewFile(
  filename: string,
  content: string
): Promise<{ imported: string }> {
  return fetchJson("/views/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
}

// --- Examples: list and import bundled examples ---

export async function getExampleScenarios(): Promise<{ files: string[] }> {
  return fetchJson("/examples/scenarios");
}

export async function getExampleViews(): Promise<{ files: string[] }> {
  return fetchJson("/examples/views");
}

export async function importExampleScenario(
  filename: string
): Promise<{ imported: string }> {
  return fetchJson("/examples/scenarios/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
}

export async function importExampleView(
  filename: string
): Promise<{ imported: string }> {
  return fetchJson("/examples/views/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
}

export async function getViews(): Promise<{
  views: ViewDef[];
  defaultViewId: string | null;
}> {
  return fetchJson("/views");
}

export async function setDefaultView(
  viewId: string | null
): Promise<{
  views: ViewDef[];
  defaultViewId: string | null;
}> {
  return fetchJson("/views/default", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewId }),
  });
}

export async function getSimulators(): Promise<{
  simulators: SimulatorInfo[];
}> {
  return fetchJson("/simulators");
}

export async function trustCaOnSimulator(
  udid: string
): Promise<{ simulator: SimulatorInfo }> {
  return fetchJson("/simulators/trust-ca", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ udid }),
  });
}

export async function getCaTrustStatus(): Promise<{ trusted: boolean }> {
  return fetchJson("/ca/trust/status");
}

export async function trustCaOnHost(): Promise<{ trusted: boolean }> {
  return fetchJson("/ca/trust", { method: "POST" });
}

export async function getTheme(): Promise<{ theme: "light" | "dark" }> {
  return fetchJson("/config/theme");
}

export async function setTheme(
  theme: "light" | "dark"
): Promise<{ theme: "light" | "dark" }> {
  return fetchJson("/config/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
}
