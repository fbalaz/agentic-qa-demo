// Deterministic orchestrator: fixed agent order, run state, limits, gates and escalation.
// It is plain code, not an LLM.
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_NAMES, teamKind, type AgentName, type TeamConfig } from "./config.js";
import { RunLog } from "./runlog.js";
import { costUsd, type ModelClient } from "./model.js";
import { runTool, toolsFor, expectationChange, type RunState } from "./tools.js";
import { AGENT_LABELS, contextFor, systemPrompt, type Transcript } from "./agents.js";

export type RunResult = { status: "green" | "red" | "awaiting_human" | "blocked" | "error"; reason: string };

export async function runTeam(cfg: TeamConfig, model: ModelClient, log: RunLog, productURL: string): Promise<RunResult> {
  resetGenerated();
  const state: RunState = { runId: log.runId, productURL, handovers: {}, testVersions: {}, proposals: [], testRuns: [], gateResults: [] };
  const transcripts: Transcript = {};
  log.emit({
    type: "run_start",
    config: cfg.name,
    team: teamKind(cfg),
    inputs: cfg.available_docs,
    started_at: log.startedAt,
    model: cfg.model.id,
    bug: process.env.DEMO_BUG || "no-discount",
    source: model.source,
    recorded_from: model.recordedFrom ? path.basename(path.dirname(model.recordedFrom)) || path.basename(model.recordedFrom) : undefined,
    agents: AGENT_NAMES.map((a) => ({ id: a, label: AGENT_LABELS[a] })),
    summary: `${cfg.name} team, source: ${model.source}`,
  });

  try {
    for (const agent of AGENT_NAMES) {
      if (agent === "reviewer") runPreReviewGates(cfg, state, log);
      await runAgent(agent, cfg, model, log, state, transcripts);

      if (agent === "requirements" && cfg.gates.assumptions) {
        const blocked = assumptionGate(state, log);
        if (blocked) return finish(log, state, { status: "awaiting_human", reason: blocked }, "clarify_requirement");
      }
      if (agent === "ui" && cfg.gates.contract_trace) {
        const blocked = contractTraceGate(state, log);
        if (blocked) return finish(log, state, { status: "blocked", reason: blocked });
      }
    }
  } catch (e) {
    return finish(log, state, { status: "error", reason: String(e instanceof Error ? e.message : e) });
  }

  const last = state.testRuns.at(-1);
  const green = !!last && last.failed === 0;
  const approved = state.review?.verdict === "approve";
  if (green && approved) return finish(log, state, { status: "green", reason: `${last!.passed}/${last!.passed} passed, reviewer approved` });
  if (teamKind(cfg) === "loose") {
    return finish(log, state, { status: "red", reason: green ? "reviewer rejected" : `${last?.failed ?? 0} failing test(s)` });
  }
  // Team with rules: a red result with a product bug classification goes to a human.
  return finish(
    log,
    state,
    { status: "awaiting_human", reason: `${last?.failed ?? 0} failing test(s); reviewer: ${state.review?.verdict ?? "none"} (${state.review?.classification ?? "unclassified"})` },
    "bug_or_requirement_change",
  );
}

async function runAgent(agent: AgentName, cfg: TeamConfig, model: ModelClient, log: RunLog, state: RunState, transcripts: Transcript) {
  const system = systemPrompt(agent, cfg);
  const tools = toolsFor(agent, cfg);
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: contextFor(agent, cfg, state, transcripts) }];
  const record: string[] = [];
  log.emit({ type: "agent_start", agent, summary: AGENT_LABELS[agent], context_chars: String(messages[0].content).length });

  for (let turn = 1; turn <= cfg.limits.max_turns_per_agent; turn++) {
    const res = await model.call(agent, system, messages, tools);
    const u = res.usage;
    log.emit({
      type: "model_call", agent, turn, model: res.model, stop_reason: res.stop_reason, latency_ms: res.latency_ms,
      input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cost_usd: costUsd(res.model, u), estimated: res.estimated ?? false,
      text: res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim().slice(0, 400),
      summary: `${u.input_tokens + (u.cache_read_input_tokens ?? 0)} in / ${u.output_tokens} out`,
    });
    if (res.stop_reason === "refusal") {
      log.emit({ type: "note", agent, summary: "model refused the request" });
      break;
    }
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    for (const b of res.content) if (b.type === "text" && b.text.trim()) record.push(`[says] ${b.text.trim()}`);

    const calls = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      if (res.stop_reason === "max_tokens") log.emit({ type: "note", agent, summary: "hit max_tokens" });
      break;
    }
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    let terminal = false;
    for (const c of calls) {
      const r = await runTool({ agent, cfg, log, state }, c.name, c.input);
      log.emit({ type: "tool_call", agent, tool: c.name, input: trimForLog(c.input), is_error: !!r.isError, result: r.content.slice(0, 300) });
      record.push(`[calls ${c.name}] ${JSON.stringify(c.input)}\n[result] ${r.content}`);
      results.push({ type: "tool_result", tool_use_id: c.id, content: r.content, is_error: r.isError });
      terminal ||= !!r.terminal;
    }
    messages.push({ role: "user", content: results });
    if (terminal) break;
  }

  // An agent that ends without a handover still leaves its last words; the loose team passes those on.
  if (!state.handovers[agent] && agent !== "reviewer") {
    const lastText = record.filter((r) => r.startsWith("[says]")).at(-1)?.slice(7) ?? "";
    if (cfg.agents[agent].context === "full" || cfg.agents[agent].context === "summary") state.handovers[agent] = { summary: lastText };
    log.emit({ type: "note", agent, summary: "ended without submit_handover" });
  }
  transcripts[agent] = record.join("\n");
  log.emit({ type: "agent_end", agent, summary: AGENT_LABELS[agent] });
}

// ---------- gates ----------

function gate(state: RunState, log: RunLog, name: string, blockedReason: string | null): string | null {
  const result = blockedReason ? "blocked" : "passed";
  state.gateResults!.push({ gate: name, result, reason: blockedReason ?? "ok" });
  log.emit({ type: "gate", gate: name, result, summary: `${name}: ${result.toUpperCase()}${blockedReason ? ` (${blockedReason})` : ""}` });
  return blockedReason;
}

function assumptionGate(state: RunState, log: RunLog): string | null {
  const c = state.handovers.requirements;
  if (!c?.expected) return gate(state, log, "assumptions", "no requirement contract");
  const unconfirmed = (c.assumptions ?? []).filter((a: any) => a.status !== "confirmed");
  if (unconfirmed.length) return gate(state, log, "assumptions", `unconfirmed: ${unconfirmed.map((a: any) => a.text).join("; ")}`);
  if ((c.open_questions ?? []).length) return gate(state, log, "assumptions", `open questions: ${c.open_questions.join("; ")}`);
  if (c.oracle !== "acceptance-criteria") return gate(state, log, "assumptions", `oracle is ${c.oracle}, must be acceptance-criteria`);
  return gate(state, log, "assumptions", null);
}

function contractTraceGate(state: RunState, log: RunLog): string | null {
  const c = state.handovers.requirements;
  const files = Object.keys(state.testVersions);
  if (!files.length) return gate(state, log, "contract-trace", "no tests written");
  for (const f of files) {
    const content = state.testVersions[f].at(-1)!.content;
    const header = content.match(/@requirement\s+([\w-]+)@([\w.-]+)/);
    if (!header || header[1] !== c?.requirement_id) return gate(state, log, "contract-trace", `${f} does not name requirement ${c?.requirement_id}`);
    const total = Number(c.expected.total_eur).toFixed(2);
    if (!content.includes(total)) return gate(state, log, "contract-trace", `${f} does not assert the contract total ${total}`);
  }
  return gate(state, log, "contract-trace", null);
}

function runPreReviewGates(cfg: TeamConfig, state: RunState, log: RunLog) {
  if (cfg.gates.assertion_diff) {
    const changed = Object.entries(state.testVersions)
      .map(([f, v]) => ({ f, change: expectationChange(v[0].content, v.at(-1)!.content) }))
      .filter((x) => x.change);
    const proposed = state.proposals
      .map((p) => ({ p, change: expectationChange(state.testVersions[`tests/generated/${p.file.replace(/^tests\/generated\//, "")}`]?.[0]?.content ?? "", p.new_content) }))
      .filter((x) => x.change);
    const reasons = [
      ...changed.map((x) => `${x.f}: expected ${x.change!.before.join(", ")} -> ${x.change!.after.join(", ")}`),
      ...proposed.map((x) => `proposal by ${x.p.by}: expected ${x.change!.before.join(", ")} -> ${x.change!.after.join(", ")} (needs human approval)`),
    ];
    gate(state, log, "assertion-diff", reasons.length ? reasons.join("; ") : null);
  }
  if (cfg.gates.evidence) {
    const last = state.testRuns.at(-1);
    const e = state.handovers.execution;
    let reason: string | null = null;
    if (last && last.failed > 0) {
      if (!e || !e.classification || e.classification === "none") reason = "failure has no classification";
      else if (!last.failures.every((f) => f.trace && fs.existsSync(f.trace))) reason = "failure has no trace";
    }
    gate(state, log, "evidence", reason);
  }
}

// ---------- end of run ----------

function finish(log: RunLog, state: RunState, result: RunResult, decisionKind?: string): RunResult {
  if (result.status === "awaiting_human") {
    log.emit({
      type: "human_decision_required",
      kind: decisionKind,
      // When an agent proposed a test change that a gate blocked, the human may also side with the proposal.
      options: decisionKind === "clarify_requirement" ? ["clarified", "stop"]
        : state.proposals.length ? ["product_bug", "test_bug", "requirement_changed"] : ["product_bug", "requirement_changed"],
      evidence: {
        expected: state.handovers.requirements?.expected?.total_eur,
        proposals: state.proposals.map((p) => ({ by: p.by, file: p.file, reason: p.reason })),
        last_run: state.testRuns.at(-1) && { failed: state.testRuns.at(-1)!.failed, failures: state.testRuns.at(-1)!.failures },
        review: state.review,
        gates: state.gateResults,
      },
      summary: result.reason,
    });
  }
  log.emit({ type: "run_end", status: result.status, summary: `${result.status.toUpperCase()}: ${result.reason}` });
  fs.cpSync("tests/generated", path.join(log.dir, "tests-generated"), { recursive: true });
  return result;
}

function resetGenerated() {
  const dir = "tests/generated";
  for (const entry of fs.readdirSync(dir)) {
    if (entry === ".gitkeep") continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function trimForLog(input: unknown): unknown {
  const s = JSON.stringify(input);
  return s.length > 600 ? JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v))) : input;
}
