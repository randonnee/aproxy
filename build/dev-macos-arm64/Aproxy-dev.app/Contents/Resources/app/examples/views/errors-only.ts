import type { ViewFactory } from "../../src/rules";

export const views: ViewFactory[] = [
  () => ({
    id: "errors-only",
    name: "Errors Only",
    description: "Show only requests with 4xx/5xx status codes",
    filter: (ctx) => (ctx.status ?? 0) >= 400,
  }),
];
