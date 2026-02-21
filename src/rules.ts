export type RuleContext = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
};

export type RuleHandler = (context: RuleContext) => Response | null | Promise<Response | null>;

export type RuleInstance = {
  id: string;
  name?: string;
  description?: string;
  handle: RuleHandler;
};

export type RuleFactory = () => RuleInstance;

export type ProxyScenario = {
  id: string;
  name: string;
  description?: string;
  rules: RuleInstance[];
};

export type ScenarioFactory = () => ProxyScenario;

export type LoadedScenario = ProxyScenario & { filePath: string };
