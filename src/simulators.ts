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

export async function configureSimulatorProxy(input: {
  udid: string;
  proxyHost: string;
  proxyPort: number;
}) {
  const simulator = await ensureBootedSimulator(input.udid);

  const host = input.proxyHost;
  const port = String(input.proxyPort);

  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPEnable",
    "-bool",
    "true"
  ]);
  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPProxy",
    host
  ]);
  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPPort",
    "-int",
    port
  ]);
  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPSEnable",
    "-bool",
    "true"
  ]);
  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPSProxy",
    host
  ]);
  await runCommand("xcrun", [
    "simctl",
    "spawn",
    input.udid,
    "defaults",
    "write",
    "com.apple.CFNetwork",
    "HTTPSPort",
    "-int",
    port
  ]);

  return simulator;
}

export async function installSimulatorCertificate(input: { udid: string; certPath: string }) {
  const simulator = await ensureBootedSimulator(input.udid);
  await runCommand("xcrun", ["simctl", "keychain", "add-root-cert", input.udid, input.certPath]);
  return simulator;
}
