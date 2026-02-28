export type RequestEvent = {
  type: "request";
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  timestamp: number;
  body?: string;
};

export type ResponseEvent = {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  durationMs: number;
  timestamp: number;
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: "base64";
  mocked?: boolean;
};

export type ErrorEvent = {
  type: "error";
  id: string;
  message: string;
  timestamp: number;
};

export type WebSocketOpenEvent = {
  type: "ws_open";
  id: string;
  url: string;
  headers: Record<string, string>;
  responseHeaders: Record<string, string>;
  timestamp: number;
};

export type WebSocketCloseEvent = {
  type: "ws_close";
  id: string;
  timestamp: number;
};

export type WebSocketMessageEvent = {
  type: "ws_message";
  id: string;
  direction: "send" | "receive";
  data: string;
  binary: boolean;
  size: number;
  timestamp: number;
};

export type ProxyEvent = RequestEvent | ResponseEvent | ErrorEvent | WebSocketOpenEvent | WebSocketCloseEvent | WebSocketMessageEvent;

export type RulesListEvent = {
  type: "rules_list";
  rules: Array<{ id: string; name?: string; description?: string }>;
  activeRuleIds: string[];
};

export type ViewsListEvent = {
  type: "views_list";
  views: Array<{ id: string; name: string; description?: string; filter: string }>;
  defaultViewId: string | null;
};

export type SimulatorInfo = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  available: boolean;
  isBooted: boolean;
  caTrusted?: boolean;
};

export type SimulatorsListEvent = {
  type: "simulators_list";
  simulators: SimulatorInfo[];
};

export type SimulatorConfigEvent = {
  type: "simulator_configured";
  simulator: SimulatorInfo;
  proxyHost: string;
  proxyPort: number;
  certPath?: string;
};

export type SimulatorErrorEvent = {
  type: "simulator_error";
  message: string;
  timestamp: number;
};

export type SimulatorProxyStatusEvent = {
  type: "simulator_proxy_status";
  simulator: SimulatorInfo;
  settings: Record<string, string>;
  raw: string;
  networkService?: string;
};

export type SimulatorEvent =
  | SimulatorsListEvent
  | SimulatorConfigEvent
  | SimulatorProxyStatusEvent
  | SimulatorErrorEvent;
