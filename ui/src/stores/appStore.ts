import { create } from "zustand";
import type {
  RequestEntry,
  RequestEvent,
  ResponseEvent,
  ErrorEvent,
  Scenario,
  ViewDef,
  SimulatorInfo,
} from "../lib/types";

const MAX_REQUESTS = 500;

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

export type DetailTab = "overview" | "req-headers" | "res-headers" | "res-body";

interface AppState {
  // Connection
  connected: boolean;
  setConnected: (val: boolean) => void;

  // Requests
  requests: Map<string, RequestEntry>;
  orderedIds: string[];
  selectedId: string | null;
  activeTab: DetailTab;

  addRequest: (evt: RequestEvent) => void;
  updateResponse: (evt: ResponseEvent) => void;
  updateError: (evt: ErrorEvent) => void;
  selectRequest: (id: string | null) => void;
  setActiveTab: (tab: DetailTab) => void;
  clearRequests: () => void;

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
  activeScenarioId: string | null;
  setScenarios: (scenarios: Scenario[], activeId: string | null) => void;

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
  // Connection
  connected: false,
  setConnected: (val) => set({ connected: val }),

  // Requests
  requests: new Map(),
  orderedIds: [],
  selectedId: null,
  activeTab: "overview",

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

      // Trim
      if (orderedIds.length > MAX_REQUESTS) {
        const removed = orderedIds.slice(MAX_REQUESTS);
        removed.forEach((id) => requests.delete(id));
        orderedIds = orderedIds.slice(0, MAX_REQUESTS);
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

  selectRequest: (id) => set({ selectedId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  clearRequests: () =>
    set({
      requests: new Map(),
      orderedIds: [],
      selectedId: null,
    }),

  // Filters
  searchQuery: "",
  methodFilters: new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]),
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
  activeScenarioId: null,
  setScenarios: (scenarios, activeId) =>
    set({ scenarios, activeScenarioId: activeId }),

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
