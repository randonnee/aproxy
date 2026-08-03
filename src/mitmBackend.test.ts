/**
 * Tests for the mitmproxy backend: binary discovery, CA export into mitmproxy's
 * confdir, backend selection, and the `/_mitm/*` bridge endpoints that carry
 * flows from the addon back into the event bus and rule sandbox.
 *
 * These do not require mitmproxy to be installed.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import {
  DEFAULT_MITM_PORT,
  LEGACY_MITM_PORTS,
  resolveAddonPath,
  resolveMitmdumpPath,
  resolveMitmPort,
  seedMitmConfdir,
} from "./mitmBackend";
import { resolveProxyBackend } from "./config";
import { createRoutes, type MitmBridge } from "./server";
import type { AproxyConfig } from "./config";
import type { ProxyEvent } from "./models";
import type { SerializedRuleResponse } from "./ruleSandboxTypes";

const TOKEN = "test-token";

const baseConfig: AproxyConfig = {
  defaultViewId: null,
  theme: "dark",
  maxRequests: 1000,
  proxyBackend: "builtin",
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aproxy-mitm-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.APROXY_BACKEND;
  delete process.env.APROXY_MITMDUMP;
  delete process.env.APROXY_MITM_ADDON;
  delete process.env.APROXY_MITM_PORT;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/**
 * Build a route handler wired to a stub bridge, plus the recorders used to
 * assert on what the bridge did.
 */
function makeRoutes(options: {
  mock?: SerializedRuleResponse | null;
  ruleError?: boolean;
  bridgeEnabled?: boolean;
} = {}) {
  const { mock = null, ruleError = false, bridgeEnabled = true } = options;
  const events: ProxyEvent[] = [];
  const ruleContexts: unknown[] = [];

  const bridge: MitmBridge = {
    token: TOKEN,
    emitEvent: (event) => { events.push(event); },
    applyRuleMock: (context) => {
      ruleContexts.push(context);
      return ruleError ? Effect.fail(new Error("sandbox exploded")) : Effect.succeed(mock);
    },
  };

  const routes = createRoutes({
    listRulesEvent: () => ({ type: "rules_list", rules: [], activeRuleIds: [] }),
    listViewsEvent: () => ({ type: "views_list", views: [], defaultViewId: null }),
    loadRules: () => Effect.void,
    scenariosDir: "/tmp/aproxy-test-scenarios",
    viewsDir: "/tmp/aproxy-test-views",
    handleProxy: () => Effect.succeed(new Response("proxied")),
    createSse: () => new ReadableStream<string>(),
    getScenarios: () => [],
    getActiveScenarioIds: () => [],
    setActiveScenarioIds: () => {},
    getViews: () => [],
    getConfig: () => baseConfig,
    updateConfig: () => {},
    getProxyPort: () => 8081,
    getBackend: () => "mitmproxy",
    bridge: bridgeEnabled ? bridge : undefined,
    enableProxy: () =>
      Effect.succeed({ networkService: "Wi-Fi", proxyHost: "127.0.0.1", proxyPort: 8081, enabled: true }),
    disableProxy: () => Effect.succeed({ networkService: "Wi-Fi", enabled: false }),
    proxyStatus: () =>
      Effect.succeed({ settings: {}, raw: "", networkService: "Wi-Fi", enabled: false }),
    listSimulators: () => Effect.succeed([]),
    installSimulatorCert: () => Effect.die("not used"),
    getCaCertPem: () => null,
    getCaCertPath: () => null,
    trustCaOnHost: () => Effect.succeed({ trusted: true, certPath: "" }),
    isCaTrusted: () => Effect.succeed(true),
    installCaOnSimulator: () => Effect.die("not used"),
  });

  return { routes, events, ruleContexts };
}

function bridgeRequest(path: string, body: unknown, token: string = TOKEN) {
  return new Request(`http://127.0.0.1:8080${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Aproxy-Token": token, host: "127.0.0.1:8080" },
    body: JSON.stringify(body),
  });
}

describe("backend selection", () => {
  test("defaults to the built-in engine", () => {
    expect(resolveProxyBackend(baseConfig)).toBe("builtin");
  });

  test("persisted config selects mitmproxy", () => {
    expect(resolveProxyBackend({ ...baseConfig, proxyBackend: "mitmproxy" })).toBe("mitmproxy");
  });

  test("APROXY_BACKEND overrides the persisted config in both directions", () => {
    process.env.APROXY_BACKEND = "mitmproxy";
    expect(resolveProxyBackend(baseConfig)).toBe("mitmproxy");

    process.env.APROXY_BACKEND = "builtin";
    expect(resolveProxyBackend({ ...baseConfig, proxyBackend: "mitmproxy" })).toBe("builtin");
  });

  test("an unrecognised APROXY_BACKEND value falls back to the config", () => {
    process.env.APROXY_BACKEND = "nonsense";
    expect(resolveProxyBackend({ ...baseConfig, proxyBackend: "mitmproxy" })).toBe("mitmproxy");
  });
});

describe("mitmdump discovery", () => {
  test("APROXY_MITMDUMP is used when it points at a real file", () => {
    const dir = makeTempDir();
    const fake = join(dir, "mitmdump");
    writeFileSync(fake, "#!/bin/sh\n");
    process.env.APROXY_MITMDUMP = fake;
    expect(resolveMitmdumpPath()).toBe(fake);
  });

  test("a bogus APROXY_MITMDUMP resolves to null instead of silently falling back", () => {
    process.env.APROXY_MITMDUMP = "/definitely/not/here/mitmdump";
    expect(resolveMitmdumpPath()).toBeNull();
  });
});

describe("bridge addon discovery", () => {  test("the default addon path exists in a source checkout", () => {
    expect(existsSync(resolveAddonPath())).toBe(true);
  });

  test("APROXY_MITM_ADDON overrides the default, so the app bundle can relocate it", () => {
    process.env.APROXY_MITM_ADDON = "/somewhere/else/aproxy_addon.py";
    expect(resolveAddonPath()).toBe("/somewhere/else/aproxy_addon.py");
  });
});

describe("proxy port selection", () => {
  test("never defaults to 8081 — that is React Native Metro's port", () => {
    // Binding Metro's port breaks `react-native start` and makes every RN app
    // on the machine poll /inspector/device at the proxy once a second.
    expect(DEFAULT_MITM_PORT).not.toBe(8081);
    expect(resolveMitmPort()).not.toBe(8081);
  });

  test("defaults to DEFAULT_MITM_PORT when unset", () => {
    expect(resolveMitmPort()).toBe(DEFAULT_MITM_PORT);
  });

  test("APROXY_MITM_PORT overrides the default", () => {
    process.env.APROXY_MITM_PORT = "7777";
    expect(resolveMitmPort()).toBe(7777);
  });

  test("a nonsense APROXY_MITM_PORT falls back instead of binding port NaN", () => {
    process.env.APROXY_MITM_PORT = "not-a-port";
    expect(resolveMitmPort()).toBe(DEFAULT_MITM_PORT);
  });

  test("8081 stays in the stale-proxy cleanup list so upgrades are not stranded", () => {
    expect(LEGACY_MITM_PORTS).toContain(8081);
  });
});

describe("mitmproxy confdir", () => {
  const ca = {
    keyPem: "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n",
    certPem: "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n",
    keyPath: "/tmp/key.pem",
    certPath: "/tmp/cert.pem",
  };

  test("writes the aproxy CA as a combined key+cert PEM", () => {
    const dir = join(makeTempDir(), "confdir");
    seedMitmConfdir(ca, dir);

    const written = readFileSync(join(dir, "mitmproxy-ca.pem"), "utf-8");
    expect(written).toContain("BEGIN PRIVATE KEY");
    expect(written).toContain("BEGIN CERTIFICATE");
    expect(written.indexOf("PRIVATE KEY")).toBeLessThan(written.indexOf("CERTIFICATE"));
  });

  test("is idempotent and leaves mitmproxy's derived files alone", () => {
    const dir = join(makeTempDir(), "confdir");
    seedMitmConfdir(ca, dir);

    const derived = join(dir, "mitmproxy-ca-cert.pem");
    writeFileSync(derived, "derived");
    seedMitmConfdir(ca, dir);

    expect(existsSync(derived)).toBe(true);
    expect(readFileSync(derived, "utf-8")).toBe("derived");
  });
});

describe("/_mitm bridge endpoints", () => {
  test("emits the request event and returns no mock when no rule matches", async () => {
    const { routes, events, ruleContexts } = makeRoutes();
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/request", {
        type: "request",
        id: "flow-1",
        method: "GET",
        url: "https://example.com/a",
        headers: { accept: "*/*" },
      }))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mock: null });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "request", id: "flow-1", url: "https://example.com/a" });
    expect(ruleContexts[0]).toMatchObject({ id: "flow-1", method: "GET", headers: { accept: "*/*" } });
  });

  test("returns the serialized rule response when a rule matches", async () => {
    const mock: SerializedRuleResponse = {
      status: 418,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from('{"mocked":true}').toString("base64"),
    };
    const { routes } = makeRoutes({ mock });
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/request", {
        type: "request", id: "flow-2", method: "POST", url: "https://example.com/b", headers: {},
      }))
    );

    expect(await response.json()).toEqual({ mock });
  });

  test("forwards response events to the event bus", async () => {
    const { routes, events } = makeRoutes();
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/response", {
        type: "response", id: "flow-3", status: 200, headers: {}, durationMs: 12, timestamp: 1,
      }))
    );

    expect(response.status).toBe(204);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "response", id: "flow-3", status: 200 });
  });

  test("rejects calls with a wrong token without emitting anything", async () => {
    const { routes, events } = makeRoutes();
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/request", { type: "request", id: "x" }, "wrong-token"))
    );

    expect(response.status).toBe(403);
    expect(events).toHaveLength(0);
  });

  test("returns 404 when the built-in backend is active (no bridge wired)", async () => {
    const { routes, events } = makeRoutes({ bridgeEnabled: false });
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/request", { type: "request", id: "x" }))
    );

    expect(response.status).toBe(404);
    expect(events).toHaveLength(0);
  });

  test("passes traffic through when rule evaluation fails", async () => {
    const { routes, events } = makeRoutes({ ruleError: true });
    const response = await Effect.runPromise(
      routes(bridgeRequest("/_mitm/request", {
        type: "request", id: "flow-4", method: "GET", url: "https://example.com/c", headers: {},
      }))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mock: null });
    // The request still reaches the UI even though the rule blew up.
    expect(events).toHaveLength(1);
  });
});
