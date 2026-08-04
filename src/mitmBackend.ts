import { Effect } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CaCert } from "./ca";
import { MitmBackendError } from "./errors";

/**
 * Supervises a `mitmdump` subprocess as an alternative proxy engine.
 *
 * mitmproxy handles the transport (HTTP, CONNECT, TLS interception, HTTP/2,
 * WebSocket) and the bundled Python addon (`python/aproxy_addon.py`) bridges
 * every flow back to this process's control server, so the SSE event contract,
 * the React UI and the TypeScript rule sandbox are unchanged.
 */

/** Locations checked (in order) when `mitmdump` is not on PATH. */
const FALLBACK_BINARY_PATHS = [
  "/opt/homebrew/bin/mitmdump",
  "/usr/local/bin/mitmdump",
  join(homedir(), ".local", "bin", "mitmdump"),
  join(homedir(), "Library", "Python", "3.13", "bin", "mitmdump"),
  "/Applications/Mitmproxy.app/Contents/MacOS/mitmdump",
];

export const MITMPROXY_INSTALL_HINT =
  "Install it with `brew install mitmproxy` (or `pipx install mitmproxy`), " +
  "or set APROXY_MITMDUMP to the full path of the binary.";

/** mitmproxy's own config directory, seeded with the aproxy CA. */
const MITM_CONFDIR = join(homedir(), ".aproxy", "mitmproxy");

/**
 * Default port `mitmdump` accepts proxied traffic on.
 *
 * Deliberately not `PROXY_PORT + 1` (8081): that is the React Native Metro
 * bundler's default port. Binding it steals the port from Metro and makes every
 * RN app on the machine — including inside the iOS simulators aproxy targets —
 * poll `localhost:8081/inspector/device` at us once a second.
 */
export const DEFAULT_MITM_PORT = 9090;

/**
 * Ports previous versions defaulted to. Still recognised when clearing stale
 * system proxy settings so an upgrade never strands the system proxy on a port
 * nothing listens on any more.
 */
export const LEGACY_MITM_PORTS = [8081];

/**
 * How long to wait for mitmdump to report ready. Generous because the first
 * run pays for Python startup plus mitmproxy's certificate setup.
 */
const READY_TIMEOUT_MS = 30_000;

/** Port `mitmdump` should listen on, honouring `APROXY_MITM_PORT`. */
export function resolveMitmPort(): number {
  const raw = process.env.APROXY_MITM_PORT;
  if (!raw) return DEFAULT_MITM_PORT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_MITM_PORT;
}

export type MitmBackendOptions = {
  /** Address mitmproxy binds its proxy listener to. */
  host: string;
  /** Port mitmproxy accepts proxied traffic on. */
  port: number;
  /** Base URL of this process's control server, e.g. `http://127.0.0.1:8080`. */
  controlUrl: string;
  /** Shared secret the addon presents on every bridge call. */
  bridgeToken: string;
  /** Root CA reused so previously-trusted certificates keep working. */
  ca: CaCert;
};

/** Resolve the `mitmdump` executable, or return null when it isn't installed. */
export function resolveMitmdumpPath(): string | null {
  const override = process.env.APROXY_MITMDUMP;
  if (override) return existsSync(override) ? override : null;

  const onPath = Bun.which("mitmdump");
  if (onPath) return onPath;

  return FALLBACK_BINARY_PATHS.find((candidate) => existsSync(candidate)) ?? null;
}

/** Absolute path to the Python bridge addon shipped with aproxy. */
export function resolveAddonPath(): string {
  return process.env.APROXY_MITM_ADDON ?? join(import.meta.dir, "..", "python", "aproxy_addon.py");
}

/**
 * Write the aproxy root CA into mitmproxy's confdir.
 *
 * mitmproxy expects a combined key+cert PEM named `mitmproxy-ca.pem` and derives
 * everything else from it. Reusing our CA means a user who already trusted
 * "aproxy CA" on the host or a simulator does not have to trust anything new.
 */
export function seedMitmConfdir(ca: CaCert, confdir = MITM_CONFDIR): string {
  mkdirSync(confdir, { recursive: true, mode: 0o700 });
  const combined = `${ca.keyPem.trimEnd()}\n${ca.certPem.trimEnd()}\n`;
  const caPath = join(confdir, "mitmproxy-ca.pem");
  // Only rewrite when the contents changed so mitmproxy's derived files stay put.
  let current: string | null = null;
  if (existsSync(caPath)) {
    try {
      current = readFileSync(caPath, "utf-8");
    } catch {
      current = null;
    }
  }
  if (current !== combined) writeFileSync(caPath, combined, { mode: 0o600 });
  return confdir;
}

export class MitmProxyBackend {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private stopping = false;
  private lastExitCode: number | null = null;
  private ready: Promise<void> = Promise.resolve();
  private markReady: () => void = () => {};
  private readySignalled = false;

  constructor(private readonly options: MitmBackendOptions) {}

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Whether the proxy port is actually accepting traffic. `running` alone is
   * not enough: mitmdump spends seconds booting Python before it binds, so a
   * live process does not imply a live listener. Callers that would send the
   * user's traffic at the port (notably `/proxy/enable`) must use this.
   */
  get available(): boolean {
    return this.running && this.readySignalled;
  }

  get port(): number {
    return this.options.port;
  }

  /** Start `mitmdump` and wait until its proxy port accepts connections. */
  start(): Effect.Effect<void, MitmBackendError> {
    return Effect.gen(this, function* (_) {
      if (this.running) return;

      const binary = resolveMitmdumpPath();
      if (!binary) {
        return yield* _(
          Effect.fail(
            new MitmBackendError({
              reason: "mitmdump was not found on this system.",
              hint: MITMPROXY_INSTALL_HINT,
            })
          )
        );
      }

      const addon = resolveAddonPath();
      if (!existsSync(addon)) {
        return yield* _(
          Effect.fail(
            new MitmBackendError({ reason: `mitmproxy bridge addon missing at ${addon}` })
          )
        );
      }

      const confdir = yield* _(
        Effect.try({
          try: () => seedMitmConfdir(this.options.ca),
          catch: (cause) =>
            new MitmBackendError({ reason: `Failed to prepare mitmproxy confdir: ${String(cause)}` }),
        })
      );

      const args = [
        "--listen-host", this.options.host,
        "--listen-port", String(this.options.port),
        "--set", `confdir=${confdir}`,
        // Our addon does the reporting; mitmdump's own flow log is noise.
        // Note: flow_detail=0 also silences mitmproxy's runtime logging, which
        // is why the addon writes diagnostics straight to stderr.
        "--set", "flow_detail=0",
        "--scripts", addon,
      ];

      // Opt-in escape hatch for upstreams with self-signed certificates (the
      // benchmark harness, local dev servers). Off by default so real traffic
      // is always verified.
      if (process.env.APROXY_SSL_INSECURE === "1") {
        args.push("--ssl-insecure");
      }

      yield* _(
        Effect.try({
          try: () => {
            this.stopping = false;
            this.lastExitCode = null;
            this.readySignalled = false;
            this.ready = new Promise<void>((resolve) => { this.markReady = resolve; });
            this.proc = Bun.spawn([binary, ...args], {
              stdout: "pipe",
              stderr: "pipe",
              env: {
                ...process.env,
                APROXY_CONTROL_URL: this.options.controlUrl,
                APROXY_BRIDGE_TOKEN: this.options.bridgeToken,
                // Lets the addon recognise (and reject) requests aimed at the
                // proxy's own listener instead of through it.
                APROXY_LISTEN_HOST: this.options.host,
                APROXY_LISTEN_PORT: String(this.options.port),
              },
              onExit: (_proc, exitCode) => {
                this.lastExitCode = exitCode ?? null;
                this.proc = null;
                if (!this.stopping) {
                  console.error(`[mitmproxy] exited unexpectedly with code ${exitCode}`);
                }
              },
            });
            void this.pipeLogs(this.proc.stdout, "log");
            void this.pipeLogs(this.proc.stderr, "error");
          },
          catch: (cause) =>
            new MitmBackendError({ reason: `Failed to start mitmdump: ${String(cause)}` }),
        })
      );

      yield* _(this.waitUntilReady());
      console.log(`[mitmproxy] ${binary} listening on ${this.options.host}:${this.options.port}`);
    });
  }

  /** Called by the `/_mitm/ready` bridge endpoint when the addon reports in. */
  signalReady(): void {
    this.readySignalled = true;
    this.markReady();
  }

  /** Terminate the subprocess. Safe to call when it is not running. */
  stop(): void {
    if (!this.proc) return;
    this.stopping = true;
    this.readySignalled = false;
    try {
      this.proc.kill();
    } catch {
      // Best effort — the process may already be gone.
    }
    this.proc = null;
  }

  /**
   * Wait for the addon's `running` hook to report in. mitmdump exits before
   * that hook fires when it cannot bind, so this distinguishes "our proxy is
   * up" from "some other process already owns the port" — a TCP probe cannot.
   */
  private waitUntilReady(): Effect.Effect<void, MitmBackendError> {
    return Effect.tryPromise({
      try: async () => {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (this.proc === null) {
            throw new Error(
              `mitmdump exited during startup (code ${this.lastExitCode ?? "unknown"})`
            );
          }
          const outcome = await Promise.race([
            this.ready.then(() => "ready" as const),
            Bun.sleep(200).then(() => "waiting" as const),
          ]);
          if (outcome === "ready") return;
        }
        throw new Error(
          `mitmdump did not report ready within ${READY_TIMEOUT_MS / 1000}s`
        );
      },
      catch: (cause) =>
        new MitmBackendError({
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  }

  private async pipeLogs(stream: unknown, level: "log" | "error") {
    if (!stream || typeof stream === "number") return;
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trimEnd();
        if (!text) continue;
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          console[level](`[mitmproxy] ${line}`);
        }
      }
    } catch {
      // Stream closed with the process — nothing to report.
    }
  }
}
