import { Data } from "effect";

export class RulesLoadError extends Data.TaggedError("RulesLoadError")<{ cause: unknown }> {}
export class RequestError extends Data.TaggedError("RequestError")<{ cause: unknown }> {}
export class ProxyError extends Data.TaggedError("ProxyError")<{ cause: unknown }> {}
