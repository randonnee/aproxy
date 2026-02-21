export type RequestEvent = {
  type: "request";
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  timestamp: number;
};

export type ResponseEvent = {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  durationMs: number;
  timestamp: number;
};

export type ErrorEvent = {
  type: "error";
  id: string;
  message: string;
  timestamp: number;
};

export type ProxyEvent = RequestEvent | ResponseEvent | ErrorEvent;

export type RulesListEvent = {
  type: "rules_list";
  rules: Array<{ id: string; name?: string; description?: string }>;
  activeRuleIds: string[];
};
