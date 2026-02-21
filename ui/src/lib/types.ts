export interface RequestEvent {
  type: "request";
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  timestamp: number;
}

export interface ResponseEvent {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  durationMs: number;
  mocked?: boolean;
}

export interface ErrorEvent {
  type: "error";
  id: string;
  message: string;
}

export interface RequestEntry {
  request?: RequestEvent;
  response?: ResponseEvent;
  error?: ErrorEvent;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  rules: Array<{
    id: string;
    name?: string;
    description?: string;
  }>;
}

export interface ViewDef {
  id: string;
  name: string;
  description?: string;
  filter: string;
}

export interface SimulatorInfo {
  udid: string;
  name: string;
  state: string;
  isBooted: boolean;
  caTrusted?: boolean;
}

export type SSEEvent =
  | RequestEvent
  | ResponseEvent
  | ErrorEvent
  | { type: "rules_list" }
  | { type: "views_list" }
  | { type: "simulators_list"; simulators: SimulatorInfo[] };
