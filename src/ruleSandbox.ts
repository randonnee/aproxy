import type { RuleContext } from "../shared/rules";
import type { LoadedScenarioMeta, SerializedRuleResponse } from "./ruleSandboxTypes";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

type LoadResult = { filePath: string; scenarios: LoadedScenarioMeta[]; error?: string };
type RunResult = { scenarioId: string; ruleId: string; response: SerializedRuleResponse | null; error?: string };

type WorkerMessage =
  | { type: "load"; requestId: string; filePath: string; code: string }
  | { type: "run"; requestId: string; scenarioId: string; ruleId: string; context: RuleContext }
  | { type: "reset" };

type WorkerReply =
  | { type: "loaded"; requestId: string; filePath: string; scenarios: LoadedScenarioMeta[] }
  | { type: "result"; requestId: string; scenarioId: string; ruleId: string; response: SerializedRuleResponse | null }
  | { type: "error"; requestId?: string; message: string; scenarioId?: string; ruleId?: string };

export class RuleSandbox {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private buffer = "";
  private pendingLoads = new Map<string, (result: LoadResult) => void>();
  private pendingRuns = new Map<string, (result: RunResult) => void>();
  private readonly runTimeoutMs = 500;
  private readonly loadTimeoutMs = 2000;

  async start() {
    if (this.proc) return;
    const workerPath = process.env.APROXY_RULES_WORKER_PATH ?? `${import.meta.dir}/ruleSandboxWorker.ts`;
    this.proc = Bun.spawn(["bun", workerPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });
    this.proc.exited.then(() => {
      this.failAll("Sandbox worker exited");
      this.proc = null;
    }).catch(() => {
      this.failAll("Sandbox worker exited");
      this.proc = null;
    });
    const stdout = this.proc.stdout;
    if (!stdout || typeof stdout === "number") return;
    const reader = (stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.handleOutput(decoder.decode(value));
      }
    };
    void pump();
  }

  stop() {
    if (!this.proc) return;
    try {
      this.proc.kill();
    } catch {}
    this.failAll("Sandbox worker stopped");
    this.proc = null;
    this.buffer = "";
  }

  async reset() {
    await this.sendMessage({ type: "reset" });
  }

  async loadScenarioModule(filePath: string, code: string): Promise<LoadResult> {
    await this.start();
    return new Promise((resolve) => {
      const requestId = randomUUID();
      this.pendingLoads.set(requestId, resolve);
      void this.sendMessage({ type: "load", requestId, filePath, code });
      setTimeout(() => {
        if (this.pendingLoads.has(requestId)) {
          this.pendingLoads.delete(requestId);
          resolve({ filePath, scenarios: [], error: "Sandbox load timed out" });
          this.stop();
        }
      }, this.loadTimeoutMs);
    });
  }

  async runRule(scenarioId: string, ruleId: string, context: RuleContext): Promise<RunResult> {
    await this.start();
    return new Promise((resolve) => {
      const requestId = randomUUID();
      this.pendingRuns.set(requestId, resolve);
      void this.sendMessage({ type: "run", requestId, scenarioId, ruleId, context });
      setTimeout(() => {
        if (this.pendingRuns.has(requestId)) {
          this.pendingRuns.delete(requestId);
          resolve({ scenarioId, ruleId, response: null, error: "Sandbox rule timed out" });
          this.stop();
        }
      }, this.runTimeoutMs);
    });
  }

  deserializeResponse(serialized: SerializedRuleResponse): Response {
    const headers = new Headers(serialized.headers);
    const bodyBytes = serialized.bodyBase64
      ? Buffer.from(serialized.bodyBase64, "base64")
      : new Uint8Array();
    return new Response(bodyBytes, {
      status: serialized.status,
      headers,
    });
  }

  private async sendMessage(message: WorkerMessage) {
    if (!this.proc || !this.proc.stdin || typeof this.proc.stdin === "number") return;
    const payload = `${JSON.stringify(message)}\n`;
    if ("write" in this.proc.stdin) {
      (this.proc.stdin as { write: (data: string | Uint8Array) => number }).write(payload);
      return;
    }
    const writer = (this.proc.stdin as WritableStream<Uint8Array>).getWriter();
    await writer.write(new TextEncoder().encode(payload));
    writer.releaseLock();
  }

  private handleOutput(chunk: string) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as WorkerReply;
          this.handleMessage(message);
        } catch {}
      }
      index = this.buffer.indexOf("\n");
    }
  }

  private handleMessage(message: WorkerReply) {
    if (message.type === "loaded") {
      const resolve = this.pendingLoads.get(message.requestId);
      if (resolve) {
        resolve({ filePath: message.filePath, scenarios: message.scenarios });
        this.pendingLoads.delete(message.requestId);
      }
      return;
    }
    if (message.type === "result") {
      const resolve = this.pendingRuns.get(message.requestId);
      if (resolve) {
        resolve({ scenarioId: message.scenarioId, ruleId: message.ruleId, response: message.response });
        this.pendingRuns.delete(message.requestId);
      }
      return;
    }
    if (message.type === "error") {
      if (message.requestId && message.scenarioId && message.ruleId) {
        const resolve = this.pendingRuns.get(message.requestId);
        if (resolve) {
          resolve({ scenarioId: message.scenarioId, ruleId: message.ruleId, response: null, error: message.message });
          this.pendingRuns.delete(message.requestId);
        }
        return;
      }
      if (message.requestId) {
        const loadResolve = this.pendingLoads.get(message.requestId);
        if (loadResolve) {
          loadResolve({ filePath: "", scenarios: [], error: message.message });
          this.pendingLoads.delete(message.requestId);
        }
      }
    }
  }

  private failAll(message: string) {
    for (const resolve of this.pendingLoads.values()) {
      resolve({ filePath: "", scenarios: [], error: message });
    }
    for (const resolve of this.pendingRuns.values()) {
      resolve({ scenarioId: "", ruleId: "", response: null, error: message });
    }
    this.pendingLoads.clear();
    this.pendingRuns.clear();
  }
}
