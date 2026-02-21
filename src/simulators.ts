import { Effect } from "effect";
import { CommandError } from "./errors";

export type SimulatorInfo = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  available: boolean;
  isBooted: boolean;
};

type SimctlDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  availability?: string;
};

type SimctlList = {
  devices: Record<string, SimctlDevice[]>;
};

function runCommand(command: string, args: string[]): Effect.Effect<string, CommandError> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([command, ...args], {
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
      return stdout.trim();
    },
    catch: (err: any) =>
      new CommandError({
        command,
        args,
        stderr: err?.stderr ?? String(err),
        exitCode: err?.exitCode ?? 1,
      }),
  });
}

function runCommandOptionalText(command: string, args: string[]): Effect.Effect<string, never> {
  return runCommand(command, args).pipe(Effect.catchAll(() => Effect.succeed("")));
}

function getActiveNetworkService(): Effect.Effect<string, CommandError> {
  return Effect.gen(function* (_) {
    // Find the primary network service by checking which one has a default route
    const routeOutput = yield* _(runCommand("route", ["-n", "get", "default"]));
    const ifaceMatch = routeOutput.match(/interface:\s*(\S+)/);
    if (!ifaceMatch) {
      return yield* _(
        Effect.fail(new CommandError({ command: "route", args: ["-n", "get", "default"], stderr: "No default network interface found", exitCode: 1 }))
      );
    }

    const iface = ifaceMatch[1];

    // Map the BSD interface name to a networksetup service name
    const servicesOutput = yield* _(runCommand("networksetup", ["-listallhardwareports"]));
    const blocks = servicesOutput.split(/\n\n/);
    for (const block of blocks) {
      const deviceMatch = block.match(/Device:\s*(\S+)/);
      const nameMatch = block.match(/Hardware Port:\s*(.+)/);
      if (deviceMatch && nameMatch && deviceMatch[1] === iface) {
        return nameMatch[1].trim();
      }
    }

    return yield* _(
      Effect.fail(new CommandError({ command: "networksetup", args: ["-listallhardwareports"], stderr: `No network service found for interface ${iface}`, exitCode: 1 }))
    );
  });
}

function isAvailableDevice(device: SimctlDevice) {
  if (typeof device.isAvailable === "boolean") return device.isAvailable;
  if (typeof device.availability === "string") return device.availability.includes("available");
  return true;
}

export function listSimulators(): Effect.Effect<SimulatorInfo[], CommandError> {
  return Effect.gen(function* (_) {
    const output = yield* _(runCommand("xcrun", ["simctl", "list", "devices", "-j"]));
    const parsed = JSON.parse(output) as SimctlList;
    const devices: SimulatorInfo[] = [];

    for (const [runtime, runtimeDevices] of Object.entries(parsed.devices ?? {})) {
      for (const device of runtimeDevices ?? []) {
        const available = isAvailableDevice(device);
        devices.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          runtime,
          available,
          isBooted: device.state === "Booted",
        });
      }
    }

    return devices.filter((device) => device.available);
  });
}

export function ensureBootedSimulator(udid: string): Effect.Effect<SimulatorInfo, CommandError> {
  return Effect.gen(function* (_) {
    const simulators = yield* _(listSimulators());
    const simulator = simulators.find((device) => device.udid === udid);
    if (!simulator) {
      return yield* _(
        Effect.fail(new CommandError({ command: "simctl", args: ["list"], stderr: `Simulator ${udid} not found`, exitCode: 1 }))
      );
    }
    if (!simulator.isBooted) {
      return yield* _(
        Effect.fail(new CommandError({ command: "simctl", args: ["list"], stderr: `Simulator ${udid} is not booted`, exitCode: 1 }))
      );
    }
    return simulator;
  });
}

export function configureHostProxy(input: {
  proxyHost: string;
  proxyPort: number;
}): Effect.Effect<{ networkService: string; proxyHost: string; proxyPort: number; enabled: boolean }, CommandError> {
  return Effect.gen(function* (_) {
    const host = input.proxyHost;
    const port = String(input.proxyPort);

    // iOS simulators share the host's network stack, so proxy settings must be
    // applied to the host's active network service via networksetup.
    const service = yield* _(getActiveNetworkService());

    yield* _(runCommand("networksetup", ["-setwebproxy", service, host, port]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxy", service, host, port]));
    yield* _(runCommand("networksetup", ["-setwebproxystate", service, "on"]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxystate", service, "on"]));

    return { networkService: service, proxyHost: host, proxyPort: input.proxyPort, enabled: true };
  });
}

export function readHostProxySettings(): Effect.Effect<{
  settings: Record<string, string>;
  raw: string;
  networkService: string;
  enabled: boolean;
}, CommandError> {
  return Effect.gen(function* (_) {
    const service = yield* _(getActiveNetworkService());
    const httpOutput = yield* _(runCommandOptionalText("networksetup", ["-getwebproxy", service]));
    const httpsOutput = yield* _(runCommandOptionalText("networksetup", ["-getsecurewebproxy", service]));

    const settings: Record<string, string> = {};
    const parseNetworkSetup = (output: string, prefix: string) => {
      for (const line of output.split("\n")) {
        const match = line.match(/^(\w[\w\s]*):\s*(.+)$/);
        if (match) {
          const key = prefix + match[1].trim().replace(/\s+/g, "");
          settings[key] = match[2].trim();
        }
      }
    };
    parseNetworkSetup(httpOutput, "HTTP");
    parseNetworkSetup(httpsOutput, "HTTPS");

    const raw = `--- HTTP Proxy (${service}) ---\n${httpOutput}\n--- HTTPS Proxy (${service}) ---\n${httpsOutput}`;
    const enabled = settings["HTTPEnabled"] === "Yes";

    return { settings, raw, networkService: service, enabled };
  });
}

export function disableHostProxy(): Effect.Effect<{ networkService: string; enabled: boolean }, CommandError> {
  return Effect.gen(function* (_) {
    const service = yield* _(getActiveNetworkService());

    yield* _(runCommand("networksetup", ["-setwebproxystate", service, "off"]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxystate", service, "off"]));

    return { networkService: service, enabled: false };
  });
}

export function installSimulatorCertificate(input: { udid: string; certPath: string }): Effect.Effect<SimulatorInfo, CommandError> {
  return Effect.gen(function* (_) {
    const simulator = yield* _(ensureBootedSimulator(input.udid));
    yield* _(runCommand("xcrun", ["simctl", "keychain", input.udid, "add-root-cert", input.certPath]));
    return simulator;
  });
}

/**
 * Trust a CA certificate on the host macOS system keychain.
 * Uses osascript to prompt for admin privileges via a native macOS dialog,
 * since sudo requires a TTY which isn't available from a background server process.
 */
export function trustCaCertOnHost(certPath: string): Effect.Effect<{ trusted: boolean; certPath: string }, CommandError> {
  return Effect.gen(function* (_) {
    const script = `do shell script "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${certPath}" with administrator privileges`;
    yield* _(runCommand("osascript", ["-e", script]));
    return { trusted: true, certPath };
  });
}

/**
 * Check whether a CA certificate is already trusted in the system keychain.
 */
export function isCaTrustedOnHost(cn: string): Effect.Effect<boolean, never> {
  return runCommand("security", ["find-certificate", "-c", cn, "/Library/Keychains/System.keychain"]).pipe(
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
}
