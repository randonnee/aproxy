import { create } from "zustand";
import type {
  RequestEntry,
  RequestEvent,
  ResponseEvent,
  ErrorEvent,
  WebSocketOpenEvent,
  WebSocketCloseEvent,
  WebSocketMessageEvent,
  Scenario,
  ViewDef,
  SimulatorInfo,
} from "../lib/types";

type ViewFilter = (context: {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  status?: number;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
  mocked?: boolean;
}) => boolean;

export type NetworkEvent =
  | RequestEvent
  | ResponseEvent
  | ErrorEvent
  | WebSocketOpenEvent
  | WebSocketCloseEvent
  | WebSocketMessageEvent;

export type DetailTab = "headers" | "body" | "messages";
export type Screen = "main" | "view-manager" | "scenario-manager";

interface AppState {
  // Screen navigation
  currentScreen: Screen;
  setCurrentScreen: (screen: Screen) => void;

  // Connection
  connected: boolean;
  setConnected: (val: boolean) => void;

  // Requests
  requests: Map<string, RequestEntry>;
  orderedIds: string[];
  selectedId: string | null;
  reqTab: DetailTab;
  resTab: DetailTab;
  maxRequests: number;

  addRequest: (evt: RequestEvent) => void;
  updateResponse: (evt: ResponseEvent) => void;
  updateError: (evt: ErrorEvent) => void;
  updateWsOpen: (evt: WebSocketOpenEvent) => void;
  updateWsClose: (evt: WebSocketCloseEvent) => void;
  addWsMessage: (evt: WebSocketMessageEvent) => void;
  applyNetworkEvents: (events: NetworkEvent[]) => void;
  selectRequest: (id: string | null) => void;
  setReqTab: (tab: DetailTab) => void;
  setResTab: (tab: DetailTab) => void;
  clearRequests: () => void;
  setMaxRequests: (max: number) => void;

  // Filters
  searchQuery: string;
  methodFilters: Set<string>;
  setSearchQuery: (q: string) => void;
  toggleMethodFilter: (method: string) => void;

  // Proxy
  proxyEnabled: boolean;
  setProxyEnabled: (val: boolean) => void;

  // Scenarios
  scenarios: Scenario[];
  activeScenarioIds: string[];
  setScenarios: (scenarios: Scenario[], activeIds: string[]) => void;

  // Views
  views: ViewDef[];
  activeViewId: string | null;
  activeViewFn: ViewFilter | null;
  defaultViewId: string | null;
  setViews: (views: ViewDef[], defaultViewId: string | null) => void;
  setActiveView: (id: string | null) => void;

  // CA
  caTrusted: boolean;
  setCaTrusted: (val: boolean) => void;

  // Simulators
  simulators: SimulatorInfo[];
  setSimulators: (sims: SimulatorInfo[]) => void;
  updateSimulator: (udid: string, patch: Partial<SimulatorInfo>) => void;

  // Copy flash
  copiedId: string | null;
  setCopiedId: (id: string | null) => void;

  // Detail panel resize
  detailHeight: number;
  setDetailHeight: (h: number) => void;

  // Theme
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  // Computed
  getFilteredIds: () => string[];
  getSelectedEntry: () => RequestEntry | undefined;
}

function compileViewFilter(view: ViewDef | undefined): ViewFilter | null {
  if (!view?.filter) return null;
  try {
    return new Function("return (" + view.filter + ")")() as ViewFilter;
  } catch (e) {
    console.error("Failed to compile view filter:", e);
    return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  // Screen navigation
  currentScreen: "main",
  setCurrentScreen: (screen) => set({ currentScreen: screen }),

  // Connection
  connected: false,
  setConnected: (val) => set({ connected: val }),

  // Requests
  requests: new Map(),
  orderedIds: [],
  selectedId: null,
  reqTab: "headers",
  resTab: "headers",
  maxRequests: 1000,

  addRequest: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id) || {};
      entry.request = evt;
      requests.set(evt.id, entry);

      let orderedIds = state.orderedIds;
      if (!orderedIds.includes(evt.id)) {
        orderedIds = [evt.id, ...orderedIds];
      }

      const maxRequests = state.maxRequests;
      // Trim
      if (orderedIds.length > maxRequests) {
        const removed = orderedIds.slice(maxRequests);
        removed.forEach((id) => requests.delete(id));
        orderedIds = orderedIds.slice(0, maxRequests);
      }

      return { requests, orderedIds };
    }),

  updateResponse: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id);
      if (entry) {
        entry.response = evt;
        requests.set(evt.id, { ...entry });
      }
      return { requests };
    }),

  updateError: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id);
      if (entry) {
        entry.error = evt;
        requests.set(evt.id, { ...entry });
      }
      return { requests };
    }),

  updateWsOpen: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id);
      if (entry) {
        entry.wsOpen = true;
        requests.set(evt.id, { ...entry });
      }
      return { requests };
    }),

  updateWsClose: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id);
      if (entry) {
        entry.wsClosed = true;
        requests.set(evt.id, { ...entry });
      }
      return { requests };
    }),

  addWsMessage: (evt) =>
    set((state) => {
      const requests = new Map(state.requests);
      const entry = requests.get(evt.id);
      if (entry) {
        const wsMessages = [...(entry.wsMessages || []), evt];
        requests.set(evt.id, { ...entry, wsMessages });
      }
      return { requests };
    }),

  applyNetworkEvents: (events) =>
    set((state) => {
      if (events.length === 0) return state;

      const requests = new Map(state.requests);
      let orderedIds = state.orderedIds;
      const orderedSet = new Set(orderedIds);
      const addedIds: string[] = [];

      for (const evt of events) {
        switch (evt.type) {
          case "request": {
            const entry = requests.get(evt.id) || {};
            requests.set(evt.id, { ...entry, request: evt });
            if (!orderedSet.has(evt.id)) {
              orderedSet.add(evt.id);
              addedIds.push(evt.id);
            }
            break;
          }
          case "response": {
            const entry = requests.get(evt.id);
            if (entry) {
              requests.set(evt.id, { ...entry, response: evt });
            }
            break;
          }
          case "error": {
            const entry = requests.get(evt.id);
            if (entry) {
              requests.set(evt.id, { ...entry, error: evt });
            }
            break;
          }
          case "ws_open": {
            const entry = requests.get(evt.id);
            if (entry) {
              requests.set(evt.id, { ...entry, wsOpen: true });
            }
            break;
          }
          case "ws_close": {
            const entry = requests.get(evt.id);
            if (entry) {
              requests.set(evt.id, { ...entry, wsClosed: true });
            }
            break;
          }
          case "ws_message": {
            const entry = requests.get(evt.id);
            if (entry) {
              const wsMessages = [...(entry.wsMessages || []), evt];
              requests.set(evt.id, { ...entry, wsMessages });
            }
            break;
          }
        }
      }

      if (addedIds.length > 0) {
        orderedIds = [...addedIds.reverse(), ...orderedIds];
      }

      const maxRequests = state.maxRequests;
      if (orderedIds.length > maxRequests) {
        const removed = orderedIds.slice(maxRequests);
        removed.forEach((id) => requests.delete(id));
        orderedIds = orderedIds.slice(0, maxRequests);
      }

      return { requests, orderedIds };
    }),

  selectRequest: (id) => set({ selectedId: id }),
  setReqTab: (tab) => set({ reqTab: tab }),
  setResTab: (tab) => set({ resTab: tab }),

  clearRequests: () =>
    set({
      requests: new Map(),
      orderedIds: [],
      selectedId: null,
    }),

  setMaxRequests: (max) =>
    set((state) => {
      const next = Math.max(1, Math.floor(max));
      if (next === state.maxRequests) return state;
      let orderedIds = state.orderedIds;
      const requests = new Map(state.requests);
      if (orderedIds.length > next) {
        const removed = orderedIds.slice(next);
        removed.forEach((id) => requests.delete(id));
        orderedIds = orderedIds.slice(0, next);
      }
      return { maxRequests: next, orderedIds, requests };
    }),

  // Filters
  searchQuery: "",
  methodFilters: new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "WS"]),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleMethodFilter: (method) =>
    set((state) => {
      const next = new Set(state.methodFilters);
      if (next.has(method)) {
        next.delete(method);
      } else {
        next.add(method);
      }
      return { methodFilters: next };
    }),

  // Proxy
  proxyEnabled: false,
  setProxyEnabled: (val) => set({ proxyEnabled: val }),

  // Scenarios
  scenarios: [],
  activeScenarioIds: [],
  setScenarios: (scenarios, activeIds) =>
    set({ scenarios, activeScenarioIds: activeIds }),

  // Views
  views: [],
  activeViewId: null,
  activeViewFn: null,
  defaultViewId: null,
  setViews: (views, defaultViewId) =>
    set((state) => {
      let activeViewId = state.activeViewId;
      // Apply default view on initial load
      if (activeViewId === null && defaultViewId !== null) {
        const exists = views.some((v) => v.id === defaultViewId);
        if (exists) activeViewId = defaultViewId;
      }
      const activeView = views.find((v) => v.id === activeViewId);
      const activeViewFn = compileViewFilter(activeView);
      return { views, defaultViewId, activeViewId, activeViewFn };
    }),
  setActiveView: (id) =>
    set((state) => {
      const activeView = state.views.find((v) => v.id === id);
      const activeViewFn = compileViewFilter(activeView);
      return { activeViewId: id, activeViewFn };
    }),

  // CA
  caTrusted: false,
  setCaTrusted: (val) => set({ caTrusted: val }),

  // Simulators
  simulators: [],
  setSimulators: (sims) => set({ simulators: sims }),
  updateSimulator: (udid, patch) =>
    set((state) => ({
      simulators: state.simulators.map((s) =>
        s.udid === udid ? { ...s, ...patch } : s
      ),
    })),

  // Copy flash
  copiedId: null,
  setCopiedId: (id) => set({ copiedId: id }),

  // Detail panel resize
  detailHeight: 320,
  setDetailHeight: (h) => set({ detailHeight: h }),

  // Theme
  theme: "dark",
  setTheme: (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
  },

  // Computed
  getFilteredIds: () => {
    const state = get();
    const search = state.searchQuery.trim().toLowerCase();
    const methods = state.methodFilters;
    const viewFn = state.activeViewFn;

    return state.orderedIds.filter((id) => {
      const entry = state.requests.get(id);
      if (!entry?.request) return false;

      if (methods.size > 0 && !methods.has(entry.request.method)) return false;

      if (search) {
        const haystack =
          `${entry.request.method} ${entry.request.url} ${entry.response?.status || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (viewFn) {
        try {
          const ctx = {
            id: entry.request.id,
            url: entry.request.url,
            method: entry.request.method,
            headers: entry.request.headers || {},
            status: entry.response?.status,
            responseHeaders: entry.response?.headers,
            durationMs: entry.response?.durationMs,
            mocked: entry.response?.mocked,
          };
          if (!viewFn(ctx)) return false;
        } catch {
          // If filter throws, include the request
        }
      }

      return true;
    });
  },

  getSelectedEntry: () => {
    const state = get();
    if (!state.selectedId) return undefined;
    return state.requests.get(state.selectedId);
  },
}));
