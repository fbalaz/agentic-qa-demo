// CLI:
//   npm run run:loose                         live run, loose team (needs Claude API credentials)
//   npm run run:rules                         live run, team with rules
//   npm run replay -- runs/<id>               replay a recorded run (no network; tests run for real)
//   npm run replay -- scripted-loose          replay the hand-written rehearsal script (labelled "scripted")
//   options: --pace 1   replay at recorded speed (0 = as fast as possible)
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { RunLog, newRunId, readEvents } from "./runlog.js";
import { LiveClient, ReplayClient, type ModelClient } from "./model.js";
import { runTeam } from "./orchestrator.js";
import { startApp } from "./apps.js";
import { buildReport } from "./report.js";

export async function runOnce(opts: { config?: string; replay?: string; pace?: number }) {
  let configName = opts.config ?? "loose";
  let recording: string | undefined;
  let source: "replay" | "scripted" | undefined;
  if (opts.replay) {
    const r = opts.replay;
    if (fs.existsSync(path.join("fixtures", `${r}.jsonl`))) {
      recording = path.join("fixtures", `${r}.jsonl`);
      source = "scripted";
      configName = r.replace(/^scripted-/, "");
    } else {
      recording = path.join(r, "model-calls.jsonl");
      source = "replay";
      configName = String(readEvents(r).find((e) => e.type === "run_start")?.config ?? configName);
    }
    if (!fs.existsSync(recording)) throw new Error(`No recording at ${recording}`);
  }
  const cfg = loadConfig(configName);
  const runId = newRunId(source ? `${configName}-${source}` : configName);
  const log = new RunLog(runId);
  const recordFile = path.join(log.dir, "model-calls.jsonl");
  const model: ModelClient = recording
    ? new ReplayClient(source!, recording, opts.pace ?? 0, recordFile)
    : new LiveClient(cfg, recordFile);

  const app = await startApp("broken"); // the product under test carries the planted bug
  try {
    const result = await runTeam(cfg, model, log, app.baseURL);
    const report = buildReport(log.dir);
    log.writeJson("report.json", report);
    console.log(`\n${result.status.toUpperCase()}: ${result.reason}`);
    console.log(`run: ${log.dir}`);
    console.log(`tokens: ${report.tokens.total}${report.tokens.estimated ? " (estimated)" : ""}, suite runs: ${report.suite_runs}, spec reads: ${report.spec_reads}, fix loops: ${report.fix_loops}`);
    if (result.status === "awaiting_human") {
      const options = (readEvents(log.dir).find((e) => e.type === "human_decision_required")?.options as string[] | undefined) ?? [];
      console.log(`decide with: npm run decide -- ${runId} ${options.join("|")}  (or use the viewer)`);
    }
    return { runId, dir: log.dir, result, report };
  } finally {
    await app.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.ts")) {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const next = args[args.indexOf("--replay") + 1];
  const replay = args.includes("--replay") ? (next && !next.startsWith("--") ? next : "scripted-loose") : undefined;
  runOnce({ config: opt("config"), replay, pace: Number(opt("pace") ?? 0) }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
