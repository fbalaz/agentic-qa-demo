// Run each configuration N times live and print the medians used on the slides.
//   npm run measure -- --runs 10                 both configs
//   npm run measure -- --runs 10 --config loose  one config
//   npm run measure -- --runs 5 --config loose-no-ac,rules-no-ac   the separate experiment without acceptance criteria
// Every live run calls the Claude API and costs money. Start with --runs 1.
import fs from "node:fs";
import { runOnce } from "./run.js";
import type { RunReport } from "./report.js";

const args = process.argv.slice(2);
const get = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const N = Number(get("runs") ?? 1);
const configs = get("config") ? get("config")!.split(",") : ["loose", "rules"];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const all: Record<string, RunReport[]> = {};
const failed: Record<string, number> = {}; // runs that crashed still count as attempts
for (const config of configs) {
  all[config] = [];
  failed[config] = 0;
  for (let i = 1; i <= N; i++) {
    console.log(`\n===== ${config} run ${i}/${N} =====`);
    try {
      const { report } = await runOnce({ config });
      all[config].push(report);
    } catch (e) {
      failed[config]++;
      console.error(`run failed: ${e}`);
    }
  }
}

const rows = Object.entries(all).map(([config, rs]) => ({
  config,
  runs: rs.length,
  failed: failed[config],
  bug_caught: `${rs.filter((r) => r.bug_caught).length}/${rs.length}`,
  ended_green: `${rs.filter((r) => r.ended_green).length}/${rs.length}`,
  asked_to_clarify: `${rs.filter((r) => r.asked_to_clarify).length}/${rs.length}`,
  median_tokens: median(rs.map((r) => r.tokens.total)),
  median_cost_usd: median(rs.map((r) => r.cost_usd ?? NaN)),
  median_suite_runs: median(rs.map((r) => r.suite_runs)),
  median_spec_reads: median(rs.map((r) => r.spec_reads)),
  median_fix_loops: median(rs.map((r) => r.fix_loops)),
}));
console.table(rows);
const out = `runs/measure-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(out, JSON.stringify({ rows, runs: all }, null, 2));
console.log(`saved ${out}`);
