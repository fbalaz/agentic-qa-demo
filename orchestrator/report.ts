// Turns a run's events into the numbers used on the slides ("The bill", "Observe decisions").
import { readEvents, type RunEvent } from "./runlog.js";

export type RunReport = {
  run: string;
  config: string;
  source: string;
  status: string;
  reason: string;
  bug_caught: boolean;
  ended_green: boolean;
  asked_to_clarify: boolean;
  tokens: { input: number; cache_read: number; output: number; total: number; estimated: boolean };
  cost_usd: number | null;
  tokens_by_agent: Record<string, number>;
  spec_reads: number;
  suite_runs: number;
  fix_loops: number;
  permission_denials: number;
  gates: { gate: string; result: string }[];
  human_decision: string | null;
  human_time_s: number | null;
  duration_s: number;
};

export function buildReport(runDir: string): RunReport {
  const ev = readEvents(runDir);
  const start = ev.find((e) => e.type === "run_start") ?? ({} as RunEvent);
  const end = ev.filter((e) => e.type === "run_end").at(-1);
  const calls = ev.filter((e) => e.type === "model_call");
  const byAgent: Record<string, number> = {};
  let input = 0, cacheRead = 0, output = 0, cost: number | null = 0, estimated = false;
  for (const c of calls) {
    const i = Number(c.input_tokens) + Number(c.cache_read_input_tokens ?? 0) + Number(c.cache_creation_input_tokens ?? 0);
    input += Number(c.input_tokens) + Number(c.cache_creation_input_tokens ?? 0);
    cacheRead += Number(c.cache_read_input_tokens ?? 0);
    output += Number(c.output_tokens);
    byAgent[c.agent!] = (byAgent[c.agent!] ?? 0) + i + Number(c.output_tokens);
    cost = cost === null || c.cost_usd == null ? null : cost + Number(c.cost_usd);
    estimated ||= !!c.estimated;
  }
  const required = ev.find((e) => e.type === "human_decision_required");
  const decision = ev.filter((e) => e.type === "human_decision").at(-1);
  const status = String(decision?.final_status ?? end?.status ?? "unknown");
  const testFileWrites = ev.filter((e) => e.type === "note" && String(e.summary ?? "").startsWith("modified "));
  return {
    run: runDir.split("/").pop()!,
    config: String(start.config ?? "?"),
    source: String(start.source ?? "?"),
    status,
    reason: String(end?.summary ?? ""),
    // The build under test always has the planted bug, so a green run is always a wrong green.
    ended_green: status === "green",
    // Stopped before testing to ask a human about an unclear requirement (no-AC experiment).
    asked_to_clarify: required?.kind === "clarify_requirement",
    // "Caught" = the run reached the failing test and did not turn it green.
    bug_caught: status !== "green" && status !== "error" && required?.kind !== "clarify_requirement",
    tokens: { input, cache_read: cacheRead, output, total: input + cacheRead + output, estimated },
    // Scripted rehearsal runs have hand-estimated tokens; a price computed from them would look like a measurement.
    cost_usd: cost === null || estimated ? null : Math.round(cost * 10000) / 10000,
    tokens_by_agent: byAgent,
    spec_reads: ev.filter((e) => e.type === "spec_read").length,
    suite_runs: ev.filter((e) => e.type === "test_run").length,
    fix_loops: testFileWrites.length,
    permission_denials: ev.filter((e) => e.type === "permission_denied").length,
    gates: ev.filter((e) => e.type === "gate").map((g) => ({ gate: String(g.gate), result: String(g.result) })),
    human_decision: decision ? String(decision.decision) : null,
    human_time_s: required && decision ? Math.round((decision.t - required.t) / 1000) : null,
    duration_s: Math.round((end?.t ?? 0) / 1000),
  };
}
