// Re-checks finished runs without any model calls: runs each run's generated tests against the CORRECT build
// and against the BROKEN build the run was made with, then classifies every test:
//   - fails on the correct build                      -> invalid (wrong expectation; it would be red on a bug-free app too)
//   - passes on correct, fails on broken              -> catches the bug
//   - passes on both                                  -> blind (does not notice the bug)
// A red run only "caught the bug" if at least one test catches it. "bug_caught" in measure.ts counts every red run.
//
//   npm run recheck                     every run in runs/ that has generated tests
//   npm run recheck -- 20261108-133444-loose 20261108-133530-loose
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp, type RunningApp } from "../orchestrator/apps.js";
import { readEvents } from "../orchestrator/runlog.js";
import { buildReport } from "../orchestrator/report.js";
import { runSuite, TEST_DIR } from "../gates/common.js";

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const runs = (wanted.length ? wanted : fs.readdirSync("runs"))
  .map((r) => path.join("runs", path.basename(r)))
  .filter((d) => fs.existsSync(path.join(d, "tests-generated")) && fs.existsSync(path.join(d, "events.jsonl")))
  .sort();
if (!runs.length) {
  console.log("no runs with generated tests found in runs/");
  process.exit(0);
}

// Keep whatever is in tests/generated now and put it back at the end.
const backup = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-"));
fs.cpSync(TEST_DIR, backup, { recursive: true });
const clear = () => {
  for (const e of fs.readdirSync(TEST_DIR)) if (e !== ".gitkeep") fs.rmSync(path.join(TEST_DIR, e), { recursive: true, force: true });
};

// One correct build, plus one broken build per planted bug seen in the runs (ports 3201, 3202, ...).
const correct = await startApp("correct", 3200);
const broken = new Map<string, RunningApp>();
const brokenFor = async (bug: string) => {
  if (!broken.has(bug)) broken.set(bug, await startApp("broken", 3201 + broken.size, bug === "no-discount" ? "1" : bug));
  return broken.get(bug)!;
};

const rows: Record<string, string | number>[] = [];
const summary = { right: 0, mixed: 0, wrong: 0, green: 0, other: 0 };
try {
  for (const dir of runs) {
    const name = path.basename(dir);
    const rep = buildReport(dir);
    const start = readEvents(dir).find((e) => e.type === "run_start");
    const bug = String(start?.bug ?? "no-discount");
    const base = { run: name, model: String(start?.model ?? "?").replace("claude-", ""), bug, status: rep.status };
    const hasSpecs = fs.readdirSync(path.join(dir, "tests-generated")).some((f) => f.endsWith(".spec.ts"));
    if (rep.asked_to_clarify || rep.status === "error" || !hasSpecs) {
      rows.push({ ...base, catches_bug: "-", invalid: "-", blind: "-", verdict: rep.asked_to_clarify ? "stopped to ask a human (no tests)" : "no tests to check" });
      summary.other++;
      continue;
    }
    clear();
    fs.cpSync(path.join(dir, "tests-generated"), TEST_DIR, { recursive: true });
    const good = await runSuite(correct.baseURL, path.join("test-results", "recheck", name, "correct"));
    const bad = await runSuite((await brokenFor(bug)).baseURL, path.join("test-results", "recheck", name, "broken"));
    const badByTitle = new Map(bad.tests.map((t) => [t.title, t.passed]));
    let catches = 0, invalid = 0, blind = 0;
    for (const t of good.tests) {
      if (!t.passed) {
        invalid++;
        console.log(`  ${name}: INVALID test (fails on the correct build): ${t.title}`);
      } else if (badByTitle.get(t.title) === false) catches++;
      else blind++;
    }
    if (!good.tests.length) invalid++; // suite did not run at all
    let verdict: string;
    if (rep.status === "green") { verdict = "wrong green (missed the bug)"; summary.green++; }
    else if (catches > 0 && invalid === 0) { verdict = "red for the right reason"; summary.right++; }
    else if (catches > 0) { verdict = `caught the bug, but ${invalid} invalid test(s) too`; summary.mixed++; }
    else { verdict = "red for the WRONG reason only (bug not caught)"; summary.wrong++; }
    rows.push({ ...base, catches_bug: catches, invalid, blind, verdict });
  }
} finally {
  await correct.stop();
  for (const b of broken.values()) await b.stop();
  clear();
  fs.cpSync(backup, TEST_DIR, { recursive: true });
  fs.rmSync(backup, { recursive: true, force: true });
}
console.table(rows);
console.log(
  `right reason: ${summary.right}   caught but with invalid tests: ${summary.mixed}   wrong reason only: ${summary.wrong}   wrong green: ${summary.green}   no tests: ${summary.other}`,
);
