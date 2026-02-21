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

// ── Views (custom filters) ──

/** Context available to a view filter — covers both request and response data. */
export type ViewContext = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  status?: number;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
  mocked?: boolean;
};

/** A view filter predicate. Return true to include the request. */
export type ViewFilter = (context: ViewContext) => boolean;

export type ViewInstance = {
  id: string;
  name: string;
  description?: string;
  filter: ViewFilter;
};

export type ViewFactory = () => ViewInstance;

export type LoadedView = ViewInstance & { filePath: string };
