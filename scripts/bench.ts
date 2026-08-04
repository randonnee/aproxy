/**
 * Benchmark script for aproxy throughput.
 *
 * Measures requests/second through the proxy with one SSE listener connected,
 * which is the typical real-world setup (the web UI always has an SSE stream).
 *
 * Architecture:
 *   1. Starts a tiny local upstream HTTP server (port 9999) so network latency
 *      is eliminated and we measure pure proxy overhead.
 *   2. Starts aproxy: control API on PROXY_PORT (8080), mitmproxy on
 *      APROXY_MITM_PORT (9090).
 *   3. Connects an SSE listener to /events (simulates the web UI).
 *   4. Fires N requests at concurrency C through the proxy and reports stats.
 *
 * Usage:
 *   bun run bench [-- OPTIONS]
 *
 * Options:
 *   --requests N      Total requests to send (default 2000)
 *   --concurrency N   Parallel workers (default 50)
 *   --warmup N        Warmup requests, not measured (default 100)
 *   --req-size N      Request body size in bytes, uses POST (default 0 = GET)
 *   --res-size N      Response body size in bytes (default 17 = tiny JSON)
 *   --body-size N     Shorthand: sets both req-size and res-size to N
 *   --https           Use HTTPS via CONNECT tunnel + MITM interception
 *   --keepalive N     Reuse each CONNECT+TLS connection for N requests (default 1)
 *
 * Examples:
 *   bun run bench                                    # HTTP: tiny GET, tiny response
 *   bun run bench -- --res-size 102400               # HTTP: GET, 100KB response
 *   bun run bench -- --https                         # HTTPS: tiny GET through MITM
 *   bun run bench -- --https --res-size 102400       # HTTPS: GET, 100KB response
 *   bun run bench -- --https --keepalive 10          # HTTPS: reuse TLS conn for 10 reqs
 *   bun run bench -- --body-size 1048576             # 1MB POST, 1MB response
 */

import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name: string, fallback: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return Number(args[idx + 1]);
}

function boolFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const TOTAL_REQUESTS = flag("requests", 2000);
const CONCURRENCY = flag("concurrency", 50);
const WARMUP = flag("warmup", 100);
const BODY_SIZE = flag("body-size", -1); // -1 = not set
const REQ_SIZE = BODY_SIZE >= 0 ? BODY_SIZE : flag("req-size", 0);
const RES_SIZE = BODY_SIZE >= 0 ? BODY_SIZE : flag("res-size", 0);
const USE_HTTPS = boolFlag("https");
const KEEPALIVE = flag("keepalive", 1); // requests per CONNECT+TLS connection
const UPSTREAM_PORT = 9999;
/** Control API + SSE stream. Never carries proxied traffic. */
const CONTROL_PORT = Number(process.env.PROXY_PORT ?? 8080);
/** Port mitmdump listens on — this is what the load generator talks to. */
const PROXY_PORT = Number(process.env.APROXY_MITM_PORT ?? 9090);
const PROXY_HOST = process.env.HOST ?? "127.0.0.1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// 1. Generate payloads
// ---------------------------------------------------------------------------
const DEFAULT_RESPONSE = JSON.stringify({ ok: true, ts: 0 });

// Response body the upstream will return
const responsePayload = RES_SIZE > 0 ? "X".repeat(RES_SIZE) : DEFAULT_RESPONSE;
const expectedResponseBodySize = Buffer.byteLength(responsePayload);

// Request body (only used when REQ_SIZE > 0, switches to POST)
const requestPayload = REQ_SIZE > 0 ? "Y".repeat(REQ_SIZE) : "";

// ---------------------------------------------------------------------------
// 2. Generate TLS certs for HTTPS upstream (if needed)
// ---------------------------------------------------------------------------
let upstreamTlsKey: string | undefined;
let upstreamTlsCert: string | undefined;
let tempCertDir: string | undefined;
let caCertPem: Buffer | undefined;

if (USE_HTTPS) {
  console.log(`[bench] Generating self-signed TLS cert for upstream...`);
  tempCertDir = mkdtempSync(join(tmpdir(), "bench-cert-"));
  const keyPath = join(tempCertDir, "key.pem");
  const certPath = join(tempCertDir, "cert.pem");

  const proc = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=lvh.me",
    "-addext", "subjectAltName=DNS:lvh.me",
  ], { stderr: "pipe" });

  if (proc.exitCode !== 0) {
    throw new Error(`Failed to generate upstream cert: ${proc.stderr.toString()}`);
  }

  upstreamTlsKey = readFileSync(keyPath, "utf-8");
  upstreamTlsCert = readFileSync(certPath, "utf-8");

  // Load the aproxy CA cert so the benchmark client trusts MITM-generated certs
  const caCertPath = join(homedir(), ".aproxy", "ca.pem");
  caCertPem = readFileSync(caCertPath);
  console.log(`[bench] Loaded CA cert from ${caCertPath}`);
}

// ---------------------------------------------------------------------------
// 3. Local upstream server
// ---------------------------------------------------------------------------
const upstreamScheme = USE_HTTPS ? "HTTPS" : "HTTP";
console.log(`[bench] Starting local ${upstreamScheme} upstream on :${UPSTREAM_PORT}...`);
const upstreamOptions: any = {
  port: UPSTREAM_PORT,
  fetch(req: Request) {
    // Consume request body to avoid backpressure stalling the client
    if (req.body) req.body.cancel().catch(() => {});
    return new Response(responsePayload, {
      headers: {
        "Content-Type": RES_SIZE > 0 ? "text/plain" : "application/json",
        "Content-Length": String(expectedResponseBodySize),
      },
    });
  },
};

if (USE_HTTPS) {
  upstreamOptions.tls = {
    key: upstreamTlsKey,
    cert: upstreamTlsCert,
  };
}

const upstream = Bun.serve(upstreamOptions);

// ---------------------------------------------------------------------------
// 4. Start aproxy
// ---------------------------------------------------------------------------
console.log(`[bench] Starting aproxy (control :${CONTROL_PORT}, proxy :${PROXY_PORT})...`);
const proxyEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  PROXY_PORT: String(CONTROL_PORT),
  APROXY_MITM_PORT: String(PROXY_PORT),
  HOST: PROXY_HOST,
};
if (USE_HTTPS) {
  // mitmproxy needs to fetch from our self-signed upstream; skip verification.
  proxyEnv.APROXY_SSL_INSECURE = "1";
}
const proxyProc = Bun.spawn(["bun", "src/index.ts"], {
  cwd: import.meta.dir + "/..",
  env: proxyEnv,
  stdout: "pipe",
  stderr: "pipe",
});

async function waitForProxy(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "control server did not respond";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${PROXY_HOST}:${CONTROL_PORT}/host`);
      if (res.ok) {
        // The control server comes up before mitmdump finishes binding, so wait
        // for the engine itself rather than just the API.
        const body = await res.json() as { engineAvailable?: boolean; engineError?: string | null };
        if (body.engineAvailable === true) return;
        lastError = body.engineError ?? "mitmproxy engine is not available";
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Proxy did not start within timeout: ${lastError}`);
}

await waitForProxy();
console.log(`[bench] Proxy is ready.`);

// ---------------------------------------------------------------------------
// 5. Connect SSE listener (simulates the web UI)
// ---------------------------------------------------------------------------
let sseEventsReceived = 0;
let sseBytesReceived = 0;
const sseAbort = new AbortController();

const ssePromise = new Promise<void>((resolve) => {
  const sseSocket = netConnect(CONTROL_PORT, PROXY_HOST, () => {
    sseSocket.write(
      `GET /events HTTP/1.1\r\nHost: ${PROXY_HOST}:${CONTROL_PORT}\r\nAccept: text/event-stream\r\nConnection: keep-alive\r\n\r\n`
    );
  });
  let buf = "";
  sseSocket.on("data", (chunk: Buffer) => {
    sseBytesReceived += chunk.length;
    buf += chunk.toString();
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const msg = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (msg.startsWith("data:") || msg.includes("\ndata:")) {
        const dataLines = msg.split("\n").filter((l) => l.startsWith("data:"));
        sseEventsReceived += dataLines.length;
      }
    }
  });
  sseSocket.on("error", () => resolve());
  sseSocket.on("close", () => resolve());
  sseAbort.signal.addEventListener("abort", () => {
    sseSocket.destroy();
    resolve();
  });
});

await Bun.sleep(300);
const initialSseEvents = sseEventsReceived;
console.log(`[bench] SSE listener connected (received ${initialSseEvents} initial events).`);

// ---------------------------------------------------------------------------
// 6. Build the raw HTTP request to send through the proxy
// ---------------------------------------------------------------------------

/**
 * We use lvh.me (which resolves to 127.0.0.1) instead of 127.0.0.1 directly
 * because the proxy treats requests addressed to 127.0.0.1/localhost as
 * control requests (its own API). lvh.me resolves to the same address but
 * won't match the proxy's control-host set, so the request goes through the
 * full proxy pipeline (rule evaluation, upstream fetch, SSE events).
 */
const TARGET_HOST = "lvh.me";

// For HTTP mode: absolute URL in the request line (standard HTTP proxy format)
const targetUrl = `http://${TARGET_HOST}:${UPSTREAM_PORT}/`;

// The inner HTTP request sent over the proxy (HTTP) or TLS tunnel (HTTPS)
// For HTTPS, the request line uses a relative path since we're inside the tunnel
const innerPath = "/";
const innerHost = `${TARGET_HOST}:${UPSTREAM_PORT}`;

const rawHttpRequest = REQ_SIZE > 0
  ? `POST ${targetUrl} HTTP/1.1\r\n` +
    `Host: ${innerHost}\r\n` +
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${Buffer.byteLength(requestPayload)}\r\n` +
    `Accept: */*\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    requestPayload
  : `GET ${targetUrl} HTTP/1.1\r\n` +
    `Host: ${innerHost}\r\n` +
    `Accept: */*\r\n` +
    `Connection: close\r\n` +
    `\r\n`;

// For HTTPS: request inside the TLS tunnel uses relative path
function buildTlsRequest(keepalive: boolean): string {
  const conn = keepalive ? "keep-alive" : "close";
  if (REQ_SIZE > 0) {
    return `POST ${innerPath} HTTP/1.1\r\n` +
      `Host: ${innerHost}\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(requestPayload)}\r\n` +
      `Accept: */*\r\n` +
      `Connection: ${conn}\r\n` +
      `\r\n` +
      requestPayload;
  }
  return `GET ${innerPath} HTTP/1.1\r\n` +
    `Host: ${innerHost}\r\n` +
    `Accept: */*\r\n` +
    `Connection: ${conn}\r\n` +
    `\r\n`;
}

const CONNECT_REQUEST =
  `CONNECT ${TARGET_HOST}:${UPSTREAM_PORT} HTTP/1.1\r\n` +
  `Host: ${TARGET_HOST}:${UPSTREAM_PORT}\r\n` +
  `\r\n`;

type RequestResult = {
  latencyMs: number;
  bytesReceived: number;
  statusCode: number;
  bodySize: number;
  truncated: boolean;
};

/**
 * Parse an HTTP response from a data stream.
 * Returns once the full response is received (headers parsed + body read).
 */
function parseHttpResponse(
  socket: NetSocket | TLSSocket,
  start: number,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    let bytesReceived = 0;
    let headersParsed = false;
    let statusCode = 0;
    let contentLength = -1;
    let headerBuf = "";
    let bodySize = 0;

    function onData(chunk: Buffer) {
      bytesReceived += chunk.length;

      if (!headersParsed) {
        headerBuf += chunk.toString("latin1");
        const headerEnd = headerBuf.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          headersParsed = true;

          // Parse status line
          const statusLine = headerBuf.slice(0, headerBuf.indexOf("\r\n"));
          const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
          if (statusMatch) statusCode = Number(statusMatch[1]);

          // Parse Content-Length
          const clMatch = headerBuf.match(/content-length:\s*(\d+)/i);
          if (clMatch) contentLength = Number(clMatch[1]);

          // Count body bytes already in this chunk (after headers)
          const headerBytes = Buffer.byteLength(headerBuf.slice(0, headerEnd + 4), "latin1");
          bodySize = bytesReceived - headerBytes;

          // For keep-alive: resolve when we have the full body
          if (contentLength >= 0 && bodySize >= contentLength) {
            cleanup();
            const latencyMs = performance.now() - start;
            const truncated = bodySize < contentLength;
            resolve({ latencyMs, bytesReceived, statusCode, bodySize, truncated });
          }
        }
      } else {
        bodySize += chunk.length;
        // For keep-alive: resolve when we have the full body
        if (contentLength >= 0 && bodySize >= contentLength) {
          cleanup();
          const latencyMs = performance.now() - start;
          const truncated = bodySize < contentLength;
          resolve({ latencyMs, bytesReceived, statusCode, bodySize, truncated });
        }
      }
    }

    function onEnd() {
      cleanup();
      const latencyMs = performance.now() - start;
      const truncated = contentLength >= 0 && bodySize < contentLength;
      resolve({ latencyMs, bytesReceived, statusCode, bodySize, truncated });
    }

    function onError(err: Error) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
    }

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

/**
 * Send a plain HTTP request through the proxy.
 */
function sendHttpRequest(): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const socket = netConnect(PROXY_PORT, PROXY_HOST, () => {
      socket.write(rawHttpRequest);
    });

    socket.setTimeout(30_000, () => {
      socket.destroy();
      reject(new Error("request timeout"));
    });

    parseHttpResponse(socket, start).then(resolve, reject);
  });
}

/**
 * Establish a CONNECT tunnel + TLS connection to the proxy.
 * Returns the TLS socket ready for sending HTTP/1.1 requests.
 */
function openHttpsTunnel(): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const rawSocket = netConnect(PROXY_PORT, PROXY_HOST, () => {
      rawSocket.write(CONNECT_REQUEST);
    });

    let connectBuf = "";
    function onConnectData(chunk: Buffer) {
      connectBuf += chunk.toString("latin1");
      const headerEnd = connectBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return; // headers not complete yet

      rawSocket.removeListener("data", onConnectData);

      // Check for 200 Connection Established
      const statusMatch = connectBuf.match(/HTTP\/\d\.\d\s+(\d+)/);
      if (!statusMatch || Number(statusMatch[1]) !== 200) {
        rawSocket.destroy();
        reject(new Error(`CONNECT failed: ${connectBuf.slice(0, headerEnd)}`));
        return;
      }

      // Upgrade to TLS over the raw socket
      const tlsSocket = tlsConnect({
        socket: rawSocket,
        servername: TARGET_HOST,
        ca: caCertPem, // trust the aproxy CA for MITM certs
        ALPNProtocols: ["http/1.1"],
      }, () => {
        resolve(tlsSocket);
      });

      tlsSocket.on("error", (err) => {
        reject(err);
      });
    }

    rawSocket.on("data", onConnectData);
    rawSocket.on("error", (err) => reject(err));

    rawSocket.setTimeout(30_000, () => {
      rawSocket.destroy();
      reject(new Error("CONNECT timeout"));
    });
  });
}

/**
 * Send an HTTPS request through the proxy via CONNECT tunnel.
 * If KEEPALIVE > 1, sends multiple requests over the same TLS connection
 * and returns results for each.
 */
async function sendHttpsRequests(count: number): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  const tlsSocket = await openHttpsTunnel();

  try {
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const reqStr = buildTlsRequest(!isLast); // keep-alive for all but last
      const start = performance.now();
      tlsSocket.write(reqStr);
      const result = await parseHttpResponse(tlsSocket, start);
      results.push(result);
    }
  } finally {
    tlsSocket.destroy();
  }

  return results;
}

// The main sendRequest function dispatches based on mode
const sendRequest = USE_HTTPS
  ? async (): Promise<RequestResult> => {
      // For HTTPS with keepalive=1, just send one request per tunnel
      const results = await sendHttpsRequests(1);
      return results[0];
    }
  : sendHttpRequest;

// ---------------------------------------------------------------------------
// 7. Warmup
// ---------------------------------------------------------------------------
console.log(`[bench] Warming up with ${WARMUP} requests...`);
if (USE_HTTPS && KEEPALIVE > 1) {
  // Warm up in batches matching keepalive size
  let warmedUp = 0;
  while (warmedUp < WARMUP) {
    const batch = Math.min(KEEPALIVE, WARMUP - warmedUp);
    await sendHttpsRequests(batch);
    warmedUp += batch;
  }
} else {
  for (let i = 0; i < WARMUP; i++) {
    await sendRequest();
  }
}

sseEventsReceived = 0;
sseBytesReceived = 0;

const reqLabel = REQ_SIZE > 0 ? `${formatBytes(REQ_SIZE)} POST` : "GET";
const resLabel = RES_SIZE > 0 ? formatBytes(RES_SIZE) : `~${expectedResponseBodySize} B JSON`;
const protoLabel = USE_HTTPS ? "HTTPS (MITM)" : "HTTP";
const keepaliveLabel = USE_HTTPS && KEEPALIVE > 1 ? `, keepalive=${KEEPALIVE}` : "";

console.log(
  `[bench] Running ${TOTAL_REQUESTS} ${protoLabel} requests @ concurrency ${CONCURRENCY} (req: ${reqLabel}, res: ${resLabel}${keepaliveLabel})...`
);

// ---------------------------------------------------------------------------
// 8. Run benchmark
// ---------------------------------------------------------------------------
const latencies: number[] = [];
let errors = 0;
let truncated = 0;
let statusErrors = 0;
let totalBytesReceived = 0;

const benchStart = performance.now();

async function runAll() {
  let nextIdx = 0;

  async function worker() {
    while (true) {
      if (USE_HTTPS && KEEPALIVE > 1) {
        // Batch mode: grab KEEPALIVE request slots at once
        const startIdx = nextIdx;
        const batch = Math.min(KEEPALIVE, TOTAL_REQUESTS - startIdx);
        if (batch <= 0) return;
        nextIdx = startIdx + batch;

        try {
          const results = await sendHttpsRequests(batch);
          for (const result of results) {
            latencies.push(result.latencyMs);
            totalBytesReceived += result.bytesReceived;
            if (result.truncated) truncated++;
            if (result.statusCode >= 400 || result.statusCode === 0) statusErrors++;
          }
        } catch {
          // Count the entire batch as errors
          errors += batch;
        }
      } else {
        // Single request mode
        const idx = nextIdx++;
        if (idx >= TOTAL_REQUESTS) return;
        try {
          const result = await sendRequest();
          latencies.push(result.latencyMs);
          totalBytesReceived += result.bytesReceived;
          if (result.truncated) truncated++;
          if (result.statusCode >= 400 || result.statusCode === 0) statusErrors++;
        } catch {
          errors++;
        }
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
}

await runAll();
const benchEnd = performance.now();
const totalTimeSec = (benchEnd - benchStart) / 1000;

// ---------------------------------------------------------------------------
// 9. Report results
// ---------------------------------------------------------------------------

// Wait for SSE events to flush
{
  let prev = -1;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (sseEventsReceived === prev && sseEventsReceived > 0) break;
    prev = sseEventsReceived;
    await Bun.sleep(300);
  }
}

latencies.sort((a, b) => a - b);
const successful = latencies.length;
const rps = successful / totalTimeSec;
const avgLatency = latencies.reduce((s, v) => s + v, 0) / latencies.length;
const throughputMBs = (totalBytesReceived / 1024 / 1024) / totalTimeSec;

console.log("\n" + "=".repeat(60));
console.log("  APROXY BENCHMARK RESULTS");
console.log("=".repeat(60));
console.log(`  Protocol:          ${protoLabel}`);
console.log(`  Total requests:    ${TOTAL_REQUESTS}`);
console.log(`  Concurrency:       ${CONCURRENCY}`);
if (USE_HTTPS && KEEPALIVE > 1) {
  console.log(`  Keep-alive:        ${KEEPALIVE} req/conn`);
}
console.log(`  Request body:      ${REQ_SIZE > 0 ? formatBytes(REQ_SIZE) + " POST" : "none (GET)"}`);
console.log(`  Response body:     ${RES_SIZE > 0 ? formatBytes(RES_SIZE) : `~${expectedResponseBodySize} B JSON`}`);
console.log("");
console.log(`  Successful:        ${successful}`);
console.log(`  Connection errors: ${errors}`);
console.log(`  HTTP errors (4xx+):${statusErrors > 0 ? " " + statusErrors : " 0"}`);
console.log(`  Truncated:         ${truncated}`);
console.log(`  Total time:        ${totalTimeSec.toFixed(2)}s`);
console.log("");
console.log(`  Requests/sec:      ${rps.toFixed(1)}`);
console.log(`  Throughput:        ${throughputMBs.toFixed(1)} MB/s (wire, both directions)`);
console.log("");
console.log("  Latency:");
console.log(`    Average:         ${formatMs(avgLatency)}`);
console.log(`    Min:             ${formatMs(latencies[0])}`);
console.log(`    p50:             ${formatMs(percentile(latencies, 50))}`);
console.log(`    p90:             ${formatMs(percentile(latencies, 90))}`);
console.log(`    p95:             ${formatMs(percentile(latencies, 95))}`);
console.log(`    p99:             ${formatMs(percentile(latencies, 99))}`);
console.log(`    Max:             ${formatMs(latencies[latencies.length - 1])}`);
console.log("");
console.log("  SSE listener:");
console.log(
  `    Events received: ${sseEventsReceived} (expected ~${TOTAL_REQUESTS * 2} request+response)`
);
console.log(`    SSE data:        ${formatBytes(sseBytesReceived)}`);
console.log("=".repeat(60) + "\n");

// ---------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------
sseAbort.abort();
await ssePromise.catch(() => {});
proxyProc.kill();
upstream.stop();
if (tempCertDir) {
  try { rmSync(tempCertDir, { recursive: true }); } catch {}
}
process.exit(0);
