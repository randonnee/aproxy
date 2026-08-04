import { Effect } from "effect";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CommandError } from "./errors";

/**
 * Root CA management for MITM SSL interception.
 *
 * - Generates a root CA key + self-signed certificate on first run
 * - Stores in ~/.aproxy/ca-key.pem and ~/.aproxy/ca.pem
 * - Uses openssl CLI for certificate operations (available on macOS by default)
 *
 * Per-host leaf certificates are issued by mitmproxy, which derives them from
 * this CA (see `seedMitmConfdir` in `mitmBackend.ts`).
 */

const CA_DIR = join(homedir(), ".aproxy");
const CA_KEY_PATH = join(CA_DIR, "ca-key.pem");
const CA_CERT_PATH = join(CA_DIR, "ca.pem");
const CA_DAYS = 3650; // 10 years for the root CA

export type CaCert = {
  keyPem: string;
  certPem: string;
  keyPath: string;
  certPath: string;
};

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

/** Return the CA cert path (for trust installation). */
export function getCaCertPath(): string {
  return CA_CERT_PATH;
}

/** Check if the CA has already been generated. */
export function caExists(): boolean {
  return existsSync(CA_KEY_PATH) && existsSync(CA_CERT_PATH);
}
