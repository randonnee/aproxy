import { Effect } from "effect";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CommandError } from "./errors";

/**
 * CA certificate management for MITM SSL interception.
 *
 * - Generates a root CA key + self-signed certificate on first run
 * - Stores in ~/.aproxy/ca-key.pem and ~/.aproxy/ca.pem
 * - Generates per-host leaf certificates signed by the CA (cached in memory)
 * - Uses openssl CLI for certificate operations (available on macOS by default)
 */

const CA_DIR = join(homedir(), ".aproxy");
const CA_KEY_PATH = join(CA_DIR, "ca-key.pem");
const CA_CERT_PATH = join(CA_DIR, "ca.pem");
const CA_SERIAL_PATH = join(CA_DIR, "ca.srl");
const CA_DAYS = 3650; // 10 years for the root CA
const LEAF_DAYS = 825; // ~2 years for leaf certs (Apple max)

export type CaCert = {
  keyPem: string;
  certPem: string;
  keyPath: string;
  certPath: string;
};

export type HostCert = {
  keyPem: string;
  certPem: string;
};

// In-memory cache of per-host leaf certs
const hostCertCache = new Map<string, HostCert>();

// In-flight generation promises — prevents concurrent openssl runs for the same host
const hostCertInflight = new Map<string, Promise<HostCert>>();

function runOpenssl(args: string[]): Effect.Effect<string, CommandError> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["openssl", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw { stderr: stderr.trim() || stdout.trim(), exitCode };
      }
      return stdout;
    },
    catch: (err: any) =>
      new CommandError({
        command: "openssl",
        args,
        stderr: err?.stderr ?? String(err),
        exitCode: err?.exitCode ?? 1,
      }),
  });
}

/**
 * Promise-based openssl runner for the MITM hot path (getHostCert/generateHostCert).
 * Throws CommandError on failure so errors are properly typed.
 */
async function runOpensslAsync(args: string[]): Promise<string> {
  const proc = Bun.spawn(["openssl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new CommandError({
      command: "openssl",
      args,
      stderr: stderr.trim() || stdout.trim(),
      exitCode,
    });
  }
  return stdout;
}

/**
 * Ensure the CA directory exists and a root CA key + cert are present.
 * If they don't exist, generate them.
 */
export function ensureCa(): Effect.Effect<CaCert, CommandError> {
  return Effect.gen(function* (_) {
    mkdirSync(CA_DIR, { recursive: true });

    if (!existsSync(CA_KEY_PATH) || !existsSync(CA_CERT_PATH)) {
      console.log("[ca] Generating new root CA certificate...");
      yield* _(generateCa());
      console.log(`[ca] Root CA saved to ${CA_CERT_PATH}`);
      console.log(`[ca] Trust it: security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db ${CA_CERT_PATH}`);
    }

    const [keyPem, certPem] = yield* _(
      Effect.all([
        Effect.tryPromise({
          try: () => Bun.file(CA_KEY_PATH).text(),
          catch: (err) => new CommandError({ command: "read", args: [CA_KEY_PATH], stderr: String(err), exitCode: 1 }),
        }),
        Effect.tryPromise({
          try: () => Bun.file(CA_CERT_PATH).text(),
          catch: (err) => new CommandError({ command: "read", args: [CA_CERT_PATH], stderr: String(err), exitCode: 1 }),
        }),
      ], { concurrency: "unbounded" })
    );

    return { keyPem, certPem, keyPath: CA_KEY_PATH, certPath: CA_CERT_PATH };
  });
}

function generateCa(): Effect.Effect<void, CommandError> {
  return Effect.gen(function* (_) {
    // Generate RSA private key (2048-bit)
    yield* _(runOpenssl([
      "genrsa",
      "-out", CA_KEY_PATH,
      "2048",
    ]));

    // Generate self-signed root CA certificate with proper extensions.
    // Chrome requires basicConstraints=CA:TRUE and keyUsage=keyCertSign to
    // accept a certificate as a valid CA for issuing leaf certs.
    yield* _(runOpenssl([
      "req",
      "-new", "-x509",
      "-key", CA_KEY_PATH,
      "-out", CA_CERT_PATH,
      "-days", String(CA_DAYS),
      "-subj", "/CN=aproxy CA/O=aproxy/C=US",
      "-sha256",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-addext", "subjectKeyIdentifier=hash",
    ]));
  });
}

/**
 * Generate a leaf certificate for a specific hostname, signed by the CA.
 * Results are cached in memory. Concurrent requests for the same hostname
 * share a single generation to avoid file collisions.
 *
 * Kept as Promise-based for the MITM hot path (called from Bun.listen callbacks).
 */
export async function getHostCert(hostname: string, ca: CaCert): Promise<HostCert> {
  const cached = hostCertCache.get(hostname);
  if (cached) return cached;

  // If another call is already generating for this host, wait for it
  const inflight = hostCertInflight.get(hostname);
  if (inflight) return inflight;

  const promise = generateHostCert(hostname, ca).then((cert) => {
    hostCertCache.set(hostname, cert);
    hostCertInflight.delete(hostname);
    return cert;
  }).catch((err) => {
    hostCertInflight.delete(hostname);
    throw err;
  });

  hostCertInflight.set(hostname, promise);
  return promise;
}

async function generateHostCert(hostname: string, ca: CaCert): Promise<HostCert> {
  // Use temp files for the CSR and leaf cert (openssl needs file paths).
  // Include a random suffix to prevent collisions if deduplication ever fails.
  const tmpDir = join(CA_DIR, "tmp");
  mkdirSync(tmpDir, { recursive: true });

  const id = crypto.randomUUID().slice(0, 8);
  const base = `${sanitizeFilename(hostname)}-${id}`;
  const leafKeyPath = join(tmpDir, `${base}-key.pem`);
  const leafCsrPath = join(tmpDir, `${base}.csr`);
  const leafCertPath = join(tmpDir, `${base}.pem`);
  const extPath = join(tmpDir, `${base}.ext`);

  try {
    // Generate leaf key
    await runOpensslAsync([
      "genrsa",
      "-out", leafKeyPath,
      "2048",
    ]);

    // Generate CSR
    await runOpensslAsync([
      "req",
      "-new",
      "-key", leafKeyPath,
      "-out", leafCsrPath,
      "-subj", `/CN=${hostname}`,
    ]);

    // Write extension file for SAN (Subject Alternative Names)
    // Include both DNS and IP (in case hostname is an IP address)
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
    const sanLine = isIp
      ? `IP:${hostname}`
      : `DNS:${hostname}`;

    await Bun.write(extPath, [
      "authorityKeyIdentifier=keyid,issuer",
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${sanLine}`,
    ].join("\n"));

    // Sign the CSR with the CA
    await runOpensslAsync([
      "x509",
      "-req",
      "-in", leafCsrPath,
      "-CA", ca.certPath,
      "-CAkey", ca.keyPath,
      "-CAcreateserial",
      "-out", leafCertPath,
      "-days", String(LEAF_DAYS),
      "-sha256",
      "-extfile", extPath,
    ]);

    const keyPem = await Bun.file(leafKeyPath).text();
    const certPem = await Bun.file(leafCertPath).text();

    return { keyPem, certPem };
  } finally {
    // Clean up temp files (best-effort)
    for (const f of [leafKeyPath, leafCsrPath, leafCertPath, extPath]) {
      try { unlinkSync(f); } catch {}
    }
  }
}

function sanitizeFilename(hostname: string): string {
  return hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
}

/** Return the CA cert path (for trust installation). */
export function getCaCertPath(): string {
  return CA_CERT_PATH;
}

/** Check if the CA has already been generated. */
export function caExists(): boolean {
  return existsSync(CA_KEY_PATH) && existsSync(CA_CERT_PATH);
}
