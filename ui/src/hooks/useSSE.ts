import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";
import { API_BASE } from "../lib/api";
import type { SSEEvent } from "../lib/types";
import type { NetworkEvent } from "../stores/appStore";

const NETWORK_FLUSH_INTERVAL_MS = 100;
const MAX_NETWORK_BATCH = 500;

export function useSSE() {
  const sourceRef = useRef<EventSource | null>(null);

  const setConnected = useAppStore((s) => s.setConnected);
  const applyNetworkEvents = useAppStore((s) => s.applyNetworkEvents);
  const setSimulators = useAppStore((s) => s.setSimulators);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/events`);
    sourceRef.current = source;

    const networkQueue: NetworkEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushNetwork = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (networkQueue.length === 0) return;
      const batch = networkQueue.splice(0, MAX_NETWORK_BATCH);
      applyNetworkEvents(batch);
      if (networkQueue.length > 0) {
        flushTimer = setTimeout(flushNetwork, 0);
      }
    };

    source.onopen = () => setConnected(true);

    source.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as SSEEvent;
          switch (evt.type) {
            case "request":
            case "response":
            case "error":
            case "ws_open":
            case "ws_close":
            case "ws_message":
              networkQueue.push(evt);
              if (!flushTimer) {
                flushTimer = setTimeout(
                  flushNetwork,
                  NETWORK_FLUSH_INTERVAL_MS
                );
              }
              break;
            case "rules_list":
              // Refresh scenarios from API
              api.getScenarios().then((data) => {
              useAppStore
                .getState()
                .setScenarios(data.scenarios, data.activeScenarioIds);
            });
            break;
          case "views_list":
            api.getViews().then((data) => {
              useAppStore
                .getState()
                .setViews(data.views, data.defaultViewId);
            });
            break;
          case "simulators_list":
            setSimulators(evt.simulators);
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => setConnected(false);

    return () => {
      flushNetwork();
      source.close();
      sourceRef.current = null;
    };
  }, [setConnected, applyNetworkEvents, setSimulators]);
}
