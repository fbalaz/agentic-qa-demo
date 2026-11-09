// Gate: a change to an expected value in a test needs a human approval in approvals/.
// Compares the working tree with BASE_REF (default: origin/main, falling back to HEAD).
// Locally you can also compare two files: npm run gate:assertion-diff -- before.spec.ts after.spec.ts
import fs from "node:fs";
import path from "node:path";
import { expectationChange } from "../orchestrator/tools.js";
import { fail, git, pass, specFiles } from "./common.js";

const GATE = "assertion-diff";
const [a, b] = process.argv.slice(2);

if (a && b) {
  const change = expectationChange(fs.readFileSync(a, "utf8"), fs.readFileSync(b, "utf8"));
  if (change) fail(GATE, `expected ${change.before.join(", ")} -> ${change.after.join(", ")}: needs human approval`);
  pass(GATE, "no expected value changed");
}

const base = process.env.BASE_REF ?? (git("rev-parse", "--verify", "origin/main") ? "origin/main" : "HEAD");
const blocked: string[] = [];
for (const f of specFiles()) {
  const before = git("show", `${base}:${f}`);
  if (before === null) continue; // new file: nothing to compare against
  const change = expectationChange(before, fs.readFileSync(f, "utf8"));
  if (!change) continue;
  const approval = path.join("approvals", `${path.basename(f)}.yaml`);
  if (fs.existsSync(approval) && /approved_by:\s*\S+/.test(fs.readFileSync(approval, "utf8"))) {
    console.log(`  ${f}: expected value changed, approved in ${approval}`);
    continue;
  }
  blocked.push(`${f}: expected ${change.before.join(", ")} -> ${change.after.join(", ")}`);
}
if (blocked.length) fail(GATE, `${blocked.join("; ")}. A human must approve this in approvals/ (see approvals/README.md)`);
pass(GATE, `no unapproved expected value changes against ${base}`);
