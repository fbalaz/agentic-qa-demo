// Gate: every failure has a trace and a classification.
//   RUN_DIR=runs/<id> npm run gate:evidence   checks a QA team run (traces + Execution Agent classification)
//   npm run gate:evidence                      runs the suite against the build under test and checks traces
import fs from "node:fs";
import { readEvents } from "../orchestrator/runlog.js";
import { startApp } from "../orchestrator/apps.js";
import { fail, pass, runSuite } from "./common.js";

const GATE = "evidence";
const runDir = process.env.RUN_DIR;

if (runDir) {
  const ev = readEvents(runDir);
  const last = ev.filter((e) => e.type === "test_run").at(-1);
  if (!last) fail(GATE, `${runDir} has no test run`);
  const failures = (last.failures as { title: string; trace?: string }[]) ?? [];
  if (!failures.length) pass(GATE, "last run has no failures");
  const missingTrace = failures.filter((f) => !f.trace || !fs.existsSync(f.trace));
  if (missingTrace.length) fail(GATE, `no trace for: ${missingTrace.map((f) => f.title).join(", ")}`);
  const handover = ev.find((e) => e.type === "handover" && e.agent === "execution")?.handover as any;
  if (!handover?.classification || handover.classification === "none") fail(GATE, "failures are not classified by the Execution Agent");
  pass(GATE, `${failures.length} failure(s) with trace, classified as ${handover.classification}`);
}

const build = (process.env.BUILD_UNDER_TEST ?? "broken") as "broken" | "correct";
const app = await startApp(build);
const res = await runSuite(app.baseURL, `test-results/evidence-${build}`);
await app.stop();
const missing = res.failures.filter((f) => !f.trace || !fs.existsSync(f.trace));
if (missing.length) fail(GATE, `no trace for: ${missing.map((f) => f.title).join(", ")}`);
pass(GATE, `${res.failed} failure(s) on the ${build} build, each with a trace`);
