export type ScenarioRuleMeta = {
  id: string;
  name?: string;
  description?: string;
};

export type LoadedScenarioMeta = {
  id: string;
  name: string;
  description?: string;
  rules: ScenarioRuleMeta[];
  filePath: string;
};

export type SerializedRuleResponse = {
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};
