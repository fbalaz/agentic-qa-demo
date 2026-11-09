// Record the human decision for a run that is awaiting one.
//   npm run decide -- <runId> product_bug|test_bug|requirement_changed|clarified|stop [--by Filip]
//   test_bug = the human sides with a proposed test change that the assertion-diff gate blocked
import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./runlog.js";
import { buildReport } from "./report.js";

export function recordDecision(runId: string, decision: string, by = "human") {
  const dir = path.join("runs", runId);
  const events = readEvents(dir);
  const required = events.find((e) => e.type === "human_decision_required");
  if (!required) throw new Error(`Run ${runId} is not waiting for a human decision`);
  if (events.some((e) => e.type === "human_decision")) throw new Error(`Run ${runId} already has a human decision`);
  const options = [...((required.options as string[]) ?? [])];
  // Older runs did not offer test_bug; allow it when a gate blocked a proposed test change in that run.
  if (!options.includes("test_bug") && events.some((e) => e.type === "gate" && e.gate === "assertion-diff" && /proposal by/.test(String(e.summary ?? "")))) options.push("test_bug");
  if (!options.includes(decision)) throw new Error(`Decision must be one of: ${options.join(", ")}`);
  // Wall-clock time since the decision was requested, expressed on the run's own clock.
  const startedAt = Number(events.find((e) => e.type === "run_start")?.started_at ?? Date.now());
  const t = Math.max(Date.now() - startedAt, required.t);
  const finalStatus = ({ product_bug: "red", test_bug: "needs_test_fix", requirement_changed: "needs_requirement_update", clarified: "needs_clarification", stop: "stopped" } as Record<string, string>)[decision] ?? decision;
  const event = { t, type: "human_decision", decision, by, final_status: finalStatus, summary: `${by}: ${decision}` };
  fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify(event) + "\n");
  const report = buildReport(dir);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.endsWith("decide.ts")) {
  const [runId, decision] = process.argv.slice(2);
  const byIdx = process.argv.indexOf("--by");
  const by = byIdx > 0 ? process.argv[byIdx + 1] : "human";
  try {
    const r = recordDecision(runId, decision, by);
    console.log(`Recorded ${decision} for ${runId}. Final status: ${r.status}, human time: ${r.human_time_s}s`);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
