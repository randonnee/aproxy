import vm from "node:vm";
import { dirname } from "node:path";
import type { RuleContext, ScenarioFactory } from "../shared/rules";
import type { SerializedRuleResponse, LoadedScenarioMeta } from "./ruleSandboxTypes";

type ScenarioModule = { scenarios?: ScenarioFactory[] };
type LoadedRule = { id: string; handle: (context: RuleContext) => Response | null | Promise<Response | null> };
type LoadedScenario = { id: string; name: string; description?: string; rules: LoadedRule[]; filePath: string };

type LoadMessage = { type: "load"; requestId: string; filePath: string; code: string };
type RunMessage = { type: "run"; requestId: string; scenarioId: string; ruleId: string; context: RuleContext };
type ResetMessage = { type: "reset" };
type IncomingMessage = LoadMessage | RunMessage | ResetMessage;

type OutgoingMessage =
  | { type: "loaded"; requestId: string; filePath: string; scenarios: LoadedScenarioMeta[] }
  | { type: "result"; requestId: string; scenarioId: string; ruleId: string; response: SerializedRuleResponse | null }
  | { type: "error"; requestId?: string; message: string; scenarioId?: string; ruleId?: string };

const scenarios = new Map<string, LoadedScenario>();
const scenarioSources = new Map<string, string[]>();

const createSandboxContext = () =>
  vm.createContext({
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });

const createSandboxRequire = () => {
  return (id: string) => {
    throw new Error(`Sandboxed rules cannot require module: ${id}`);
  };
};

const serializeResponse = async (response: Response): Promise<SerializedRuleResponse> => {
  const bodyBytes = await response.arrayBuffer();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const bodyBase64 = bodyBytes.byteLength
    ? Buffer.from(bodyBytes).toString("base64")
    : undefined;
  return {
    status: response.status,
    headers,
    bodyBase64,
  };
};

const loadScenarioModule = (filePath: string, code: string): LoadedScenarioMeta[] => {
  const existing = scenarioSources.get(filePath) ?? [];
  existing.forEach((id) => scenarios.delete(id));
  const script = new vm.Script(code, { filename: filePath });
  const context = createSandboxContext();
  const wrapper = script.runInContext(context);
  if (typeof wrapper !== "function") {
    throw new Error("Sandboxed module did not return a wrapper function");
  }
  const module = { exports: {} as ScenarioModule };
  const sandboxRequire = createSandboxRequire();
  wrapper(module.exports, sandboxRequire, module, filePath, dirname(filePath));
  const exportedScenarios = module.exports.scenarios ?? [];
  const loaded: LoadedScenarioMeta[] = [];
  const ids: string[] = [];
  for (const factory of exportedScenarios) {
    const scenario = factory();
    ids.push(scenario.id);
    scenarios.set(scenario.id, {
      ...scenario,
      filePath,
    });
    loaded.push({
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      rules: scenario.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
      })),
      filePath,
    });
  }
  scenarioSources.set(filePath, ids);
  return loaded;
};

const runRule = async (scenarioId: string, ruleId: string, context: RuleContext) => {
  const scenario = scenarios.get(scenarioId);
  if (!scenario) return null;
  const rule = scenario.rules.find((r) => r.id === ruleId);
  if (!rule) return null;
  const response = await rule.handle(context);
  if (!response) return null;
  return serializeResponse(response);
};

const writeMessage = (message: OutgoingMessage) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handleMessage = async (message: IncomingMessage) => {
  try {
    if (message.type === "reset") {
      scenarios.clear();
      scenarioSources.clear();
      return;
    }

    if (message.type === "load") {
      const loaded = loadScenarioModule(message.filePath, message.code);
      writeMessage({ type: "loaded", requestId: message.requestId, filePath: message.filePath, scenarios: loaded });
      return;
    }

    if (message.type === "run") {
      const response = await runRule(message.scenarioId, message.ruleId, message.context);
      writeMessage({ type: "result", requestId: message.requestId, scenarioId: message.scenarioId, ruleId: message.ruleId, response });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (message.type === "run") {
      writeMessage({ type: "error", requestId: message.requestId, message: messageText, scenarioId: message.scenarioId, ruleId: message.ruleId });
    } else {
      writeMessage({ type: "error", requestId: message.type === "load" ? message.requestId : undefined, message: messageText });
    }
  }
};

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) {
      try {
        const message = JSON.parse(line) as IncomingMessage;
        void handleMessage(message);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        writeMessage({ type: "error", message: messageText });
      }
    }
    index = buffer.indexOf("\n");
  }
});
