import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import * as api from "../lib/api";

export function useInitialData() {
  const setProxyEnabled = useAppStore((s) => s.setProxyEnabled);
  const setCaTrusted = useAppStore((s) => s.setCaTrusted);
  const setScenarios = useAppStore((s) => s.setScenarios);
  const setViews = useAppStore((s) => s.setViews);
  const setSimulators = useAppStore((s) => s.setSimulators);
  const setTheme = useAppStore((s) => s.setTheme);
  const setMaxRequests = useAppStore((s) => s.setMaxRequests);

  useEffect(() => {
    api
      .getProxyStatus()
      .then((p) => setProxyEnabled(p.enabled))
      .catch(() => {});
    api
      .getCaTrustStatus()
      .then((d) => setCaTrusted(d.trusted))
      .catch(() => {});
    api
      .getScenarios()
      .then((d) => setScenarios(d.scenarios, d.activeScenarioIds))
      .catch(() => {});
    api
      .getViews()
      .then((d) => setViews(d.views, d.defaultViewId))
      .catch(() => {});
    api
      .getSimulators()
      .then((d) => setSimulators(d.simulators))
      .catch(() => {});
    api
      .getTheme()
      .then((d) => setTheme(d.theme))
      .catch(() => {});
    api
      .getConfig()
      .then((d) => setMaxRequests(d.config.maxRequests))
      .catch(() => {});
  }, [setProxyEnabled, setCaTrusted, setScenarios, setViews, setSimulators, setTheme, setMaxRequests]);
}
