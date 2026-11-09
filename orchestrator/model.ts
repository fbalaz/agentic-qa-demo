// Model access with three sources:
//   live     -> calls the Claude API and records every response to runs/<id>/model-calls.jsonl
//   replay   -> plays back a recorded run's responses (no network). Tools still execute for real.
//   scripted -> same as replay, but the recording was written by hand (fixtures/scripted-*.jsonl).
//               Use it for rehearsal and as a stage backup. Always label it as scripted.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentName, TeamConfig } from "./config.js";

export type ModelResponse = {
  content: Anthropic.Beta.Messages.BetaContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  model: string;
  latency_ms: number;
  estimated?: boolean; // token counts estimated (scripted fixtures)
};

export type Recording = { agent: AgentName; call: number; response: ModelResponse };
export type ModelSource = "live" | "replay" | "scripted";

export interface ModelClient {
  readonly source: ModelSource;
  readonly recordedFrom?: string;
  call(
    agent: AgentName,
    system: string,
    messages: Anthropic.Beta.Messages.BetaMessageParam[],
    tools: Anthropic.Beta.Messages.BetaTool[],
  ): Promise<ModelResponse>;
}

// USD per million tokens. Update if you switch models (DEMO_MODEL).
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function costUsd(model: string, u: ModelResponse["usage"]): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (u.input_tokens * p.input + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.input * 1.25 + u.output_tokens * p.output) / 1e6;
}

export class LiveClient implements ModelClient {
  readonly source = "live" as const;
  private readonly client = new Anthropic();
  private readonly calls = new Map<AgentName, number>();

  constructor(private readonly cfg: TeamConfig, private readonly recordFile: string) {}

  async call(agent: AgentName, system: string, messages: Anthropic.Beta.Messages.BetaMessageParam[], tools: Anthropic.Beta.Messages.BetaTool[]) {
    const started = Date.now();
    const useFallbacks = this.cfg.model.fallbacks === "default";
    const msg = await this.client.beta.messages.create({
      model: this.cfg.model.id,
      max_tokens: this.cfg.model.max_tokens,
      output_config: { effort: this.cfg.model.effort },
      // Stable system prompt + tools first, so repeated calls within an agent hit the prompt cache.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const response: ModelResponse = {
      content: msg.content,
      stop_reason: msg.stop_reason,
      usage: msg.usage,
      model: msg.model,
      latency_ms: Date.now() - started,
    };
    const call = (this.calls.get(agent) ?? 0) + 1;
    this.calls.set(agent, call);
    fs.appendFileSync(this.recordFile, JSON.stringify({ agent, call, response } satisfies Recording) + "\n");
    return response;
  }
}

export class ReplayClient implements ModelClient {
  private readonly queues = new Map<AgentName, ModelResponse[]>();

  constructor(readonly source: "replay" | "scripted", readonly recordedFrom: string, private readonly pace = 0, recordFile?: string) {
    const lines = fs.readFileSync(recordedFrom, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const r = JSON.parse(line) as Recording;
      if (!this.queues.has(r.agent)) this.queues.set(r.agent, []);
      this.queues.get(r.agent)!.push(r.response);
    }
    if (recordFile) fs.copyFileSync(recordedFrom, recordFile);
  }

  async call(agent: AgentName) {
    const next = this.queues.get(agent)?.shift();
    if (!next) {
      throw new Error(`Recording ${path.basename(this.recordedFrom)} has no more responses for ${agent}. The run diverged from the recording.`);
    }
    if (this.pace > 0) await new Promise((r) => setTimeout(r, next.latency_ms * this.pace));
    return next;
  }
}
