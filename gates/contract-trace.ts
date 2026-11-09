// Gate: every generated test names a requirement that has a contract, and asserts the contract's expected total.
import fs from "node:fs";
import { fail, loadContracts, pass, specFiles } from "./common.js";

const GATE = "contract-trace";
const files = specFiles();
if (!files.length) fail(GATE, "no tests in tests/generated");
const contracts = loadContracts();

for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const m = content.match(/@requirement\s+([\w-]+)@([\w.-]+)/);
  if (!m) fail(GATE, `${f} has no "// @requirement <id>@<version>" header`);
  const c = contracts[m[1]];
  if (!c) fail(GATE, `${f} names ${m[1]}, but contracts/ has no contract for it`);
  if (!c.source.includes(m[2])) fail(GATE, `${f} names version ${m[2]}, the contract is based on ${c.source.join(", ")}`);
  const total = Number(c.expected.total_eur).toFixed(2);
  if (!content.includes(total)) fail(GATE, `${f} does not assert the contract's expected total €${total}`);
}
pass(GATE, `${files.length} test file(s) trace to a contract`);
