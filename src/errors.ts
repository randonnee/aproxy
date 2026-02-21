import { Data } from "effect";

export class RulesLoadError extends Data.TaggedError("RulesLoadError")<{ cause: unknown }> {}
export class RequestError extends Data.TaggedError("RequestError")<{ cause: unknown }> {}
export class ProxyError extends Data.TaggedError("ProxyError")<{ cause: unknown }> {}
export class CertError extends Data.TaggedError("CertError")<{ cause: unknown }> {}
export class CommandError extends Data.TaggedError("CommandError")<{
  command: string;
  args: string[];
  stderr: string;
  exitCode: number;
}> {
  get message() {
    return `${this.command} ${this.args.join(" ")} exited with ${this.exitCode}: ${this.stderr}`;
  }
}
