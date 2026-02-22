import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";
import { API_BASE } from "../lib/api";
import type { SSEEvent } from "../lib/types";

export function useSSE() {
  const sourceRef = useRef<EventSource | null>(null);

  const setConnected = useAppStore((s) => s.setConnected);
  const addRequest = useAppStore((s) => s.addRequest);
  const updateResponse = useAppStore((s) => s.updateResponse);
  const updateError = useAppStore((s) => s.updateError);
  const setSimulators = useAppStore((s) => s.setSimulators);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/events`);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);

    source.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as SSEEvent;
        switch (evt.type) {
          case "request":
            addRequest(evt);
            break;
          case "response":
            updateResponse(evt);
            break;
          case "error":
            updateError(evt);
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
      source.close();
      sourceRef.current = null;
    };
  }, [setConnected, addRequest, updateResponse, updateError, setSimulators]);
}
