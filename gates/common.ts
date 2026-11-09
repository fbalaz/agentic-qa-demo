import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import YAML from "yaml";

export const TEST_DIR = "tests/generated";

export function specFiles(): string[] {
  if (!fs.existsSync(TEST_DIR)) return [];
  return fs.readdirSync(TEST_DIR).filter((f) => f.endsWith(".spec.ts")).map((f) => path.join(TEST_DIR, f));
}

export function loadContracts(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fs.readdirSync("contracts").filter((f) => f.endsWith(".yaml"))) {
    const c = YAML.parse(fs.readFileSync(path.join("contracts", f), "utf8"));
    out[c.requirement_id] = c;
  }
  return out;
}

export function pass(gate: string, msg: string): never {
  console.log(`✔ ${gate}: PASSED  ${msg}`);
  process.exit(0);
}

export function fail(gate: string, msg: string): never {
  console.log(`✘ ${gate}: BLOCKED  ${msg}`);
  process.exit(1);
}

export function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export type SuiteResult = { passed: number; failed: number; failures: { title: string; trace?: string }[]; tests: { title: string; passed: boolean }[] };

export async function runSuite(baseURL: string, outDir: string): Promise<SuiteResult> {
  const report = path.join(outDir, "report.json");
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
      env: { ...process.env, BASE_URL: baseURL, PW_OUTPUT_DIR: outDir, PW_JSON_REPORT: report, FORCE_COLOR: "0" },
      stdio: "ignore",
    });
    child.on("close", () => resolve());
  });
  const res: SuiteResult = { passed: 0, failed: 0, failures: [], tests: [] };
  if (!fs.existsSync(report)) return { passed: 0, failed: 1, failures: [{ title: "suite did not run" }], tests: [] };
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  const walk = (s: any) => {
    for (const x of s.suites ?? []) walk(x);
    for (const spec of s.specs ?? []) for (const t of spec.tests ?? []) {
      const r = t.results?.at(-1);
      if (!r) continue;
      res.tests.push({ title: spec.title, passed: r.status === "passed" });
      if (r.status === "passed") res.passed++;
      else {
        res.failed++;
        res.failures.push({ title: spec.title, trace: (r.attachments ?? []).find((a: any) => a.name === "trace")?.path });
      }
    }
  };
  for (const s of rep.suites ?? []) walk(s);
  if (res.passed + res.failed === 0) return { passed: 0, failed: 1, failures: [{ title: "no tests ran" }], tests: [] };
  return res;
}
