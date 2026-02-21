import { ProxyError } from "./errors";

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

async function runCommand(command: string, args: string[]) {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `${command} failed`;
    throw new ProxyError({ cause: new Error(message) });
  }

  return stdout.trim();
}

async function runCommandOptional(command: string, args: string[]) {
  try {
    await runCommand(command, args);
  } catch {
    // ignore optional command failures
  }
}

async function runCommandOptionalText(command: string, args: string[]) {
  try {
    return await runCommand(command, args);
  } catch {
    return "";
  }
}

async function getActiveNetworkService() {
  // Find the primary network service by checking which one has a default route
  const routeOutput = await runCommand("route", ["-n", "get", "default"]);
  const ifaceMatch = routeOutput.match(/interface:\s*(\S+)/);
  if (!ifaceMatch) throw new ProxyError({ cause: new Error("No default network interface found") });

  const iface = ifaceMatch[1];

  // Map the BSD interface name to a networksetup service name
  const servicesOutput = await runCommand("networksetup", ["-listallhardwareports"]);
  const blocks = servicesOutput.split(/\n\n/);
  for (const block of blocks) {
    const deviceMatch = block.match(/Device:\s*(\S+)/);
    const nameMatch = block.match(/Hardware Port:\s*(.+)/);
    if (deviceMatch && nameMatch && deviceMatch[1] === iface) {
      return nameMatch[1].trim();
    }
  }

  throw new ProxyError({ cause: new Error(`No network service found for interface ${iface}`) });
}

function isAvailableDevice(device: SimctlDevice) {
  if (typeof device.isAvailable === "boolean") return device.isAvailable;
  if (typeof device.availability === "string") return device.availability.includes("available");
  return true;
}

export async function listSimulators() {
  const output = await runCommand("xcrun", ["simctl", "list", "devices", "-j"]);
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
        isBooted: device.state === "Booted"
      });
    }
  }

  return devices.filter((device) => device.available);
}

export async function ensureBootedSimulator(udid: string) {
  const simulators = await listSimulators();
  const simulator = simulators.find((device) => device.udid === udid);
  if (!simulator) throw new ProxyError({ cause: new Error(`Simulator ${udid} not found`) });
  if (!simulator.isBooted) throw new ProxyError({ cause: new Error(`Simulator ${udid} is not booted`) });
  return simulator;
}

export async function configureHostProxy(input: {
  proxyHost: string;
  proxyPort: number;
}) {
  const host = input.proxyHost;
  const port = String(input.proxyPort);

  // iOS simulators share the host's network stack, so proxy settings must be
  // applied to the host's active network service via networksetup.
  const service = await getActiveNetworkService();

  await runCommand("networksetup", ["-setwebproxy", service, host, port]);
  await runCommand("networksetup", ["-setsecurewebproxy", service, host, port]);
  await runCommand("networksetup", ["-setwebproxystate", service, "on"]);
  await runCommand("networksetup", ["-setsecurewebproxystate", service, "on"]);

  return { networkService: service, proxyHost: host, proxyPort: input.proxyPort, enabled: true };
}

export async function readHostProxySettings() {
  const service = await getActiveNetworkService();
  const httpOutput = await runCommandOptionalText("networksetup", ["-getwebproxy", service]);
  const httpsOutput = await runCommandOptionalText("networksetup", ["-getsecurewebproxy", service]);

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
}

export async function disableHostProxy() {
  const service = await getActiveNetworkService();

  await runCommand("networksetup", ["-setwebproxystate", service, "off"]);
  await runCommand("networksetup", ["-setsecurewebproxystate", service, "off"]);

  return { networkService: service, enabled: false };
}

export async function installSimulatorCertificate(input: { udid: string; certPath: string }) {
  const simulator = await ensureBootedSimulator(input.udid);
  await runCommand("xcrun", ["simctl", "keychain", "add-root-cert", input.udid, input.certPath]);
  return simulator;
}
