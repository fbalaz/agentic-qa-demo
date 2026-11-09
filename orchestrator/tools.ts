// Tools the agents can call. Permissions are enforced HERE, in code, not in the prompt:
// a tool the config does not grant, or a write outside the agent's write paths, is refused.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentName, TeamConfig } from "./config.js";
import type { RunLog } from "./runlog.js";

type Tool = Anthropic.Beta.Messages.BetaTool;

export type TestRun = {
  n: number;
  passed: number;
  failed: number;
  failures: { title: string; message: string; trace?: string; page_snapshot?: string }[];
  rawOutput: string;
};

export type RunState = {
  runId: string;
  productURL: string; // the build under test (the broken one)
  handovers: Partial<Record<AgentName, any>>;
  testVersions: Record<string, { by: AgentName; content: string }[]>;
  proposals: { by: AgentName; file: string; new_content: string; reason: string }[];
  testRuns: TestRun[];
  review?: { verdict: "approve" | "reject"; reason: string; classification?: string };
  gateResults?: { gate: string; result: "passed" | "blocked"; reason: string }[];
  docReads?: string[];
};

export type ToolContext = { agent: AgentName; cfg: TeamConfig; log: RunLog; state: RunState };
export type ToolResult = { content: string; isError?: boolean; terminal?: boolean };

const ROOT = process.cwd();
const DOCS: Record<string, string> = {
  "user-story": "specs/user-story.md",
  "acceptance-criteria": "specs/acceptance-criteria.md",
};

// ---------- tool definitions ----------

const str = { type: "string" } as const;

const baseTools: Record<string, Tool> = {
  read_doc: {
    name: "read_doc",
    description: "Read a project document by name. Known names: user-story, acceptance-criteria.",
    input_schema: { type: "object", properties: { name: str }, required: ["name"] },
  },
  read_file: {
    name: "read_file",
    description: "Read a file under tests/ (test helpers, generated tests and fixtures). Where granted, also a page_snapshot listed in a test failure: the page as rendered when the test failed.",
    input_schema: { type: "object", properties: { path: str }, required: ["path"] },
  },
  read_app_page: {
    name: "read_app_page",
    description: "Fetch the rendered HTML of a page of the application under test, e.g. /cart/demo.",
    input_schema: { type: "object", properties: { path: str }, required: ["path"] },
  },
  create_basket: {
    name: "create_basket",
    description: "Create a basket in the application's test data sandbox to check that a fixture works. Returns basketId and url.",
    input_schema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", properties: { sku: str, name: str, priceEur: { type: "number" } }, required: ["sku", "name", "priceEur"] } },
        shippingEur: { type: "number" },
      },
      required: ["items", "shippingEur"],
    },
  },
  delete_basket: {
    name: "delete_basket",
    description: "Delete a basket from the test data sandbox. Only baskets you created can be deleted.",
    input_schema: { type: "object", properties: { basketId: str }, required: ["basketId"] },
  },
  write_fixture: {
    name: "write_fixture",
    description:
      "Write a basket fixture for the tests to tests/generated/data/<name>.json. Tests create the basket from it at runtime via createBasket() in tests/support/basket.ts.",
    input_schema: {
      type: "object",
      properties: {
        name: str,
        items: { type: "array", items: { type: "object", properties: { sku: str, name: str, priceEur: { type: "number" } }, required: ["sku", "name", "priceEur"] } },
        shippingEur: { type: "number" },
      },
      required: ["name", "items", "shippingEur"],
    },
  },
  write_test: {
    name: "write_test",
    description: "Create or overwrite a Playwright test file under tests/generated/ (path relative to tests/generated/).",
    input_schema: { type: "object", properties: { file: str, content: str }, required: ["file", "content"] },
  },
  run_tests: {
    name: "run_tests",
    description: "Run the whole generated Playwright suite against the application under test and return the results.",
    input_schema: { type: "object", properties: {} },
  },
  propose_patch: {
    name: "propose_patch",
    description: "Propose a change to a test file without applying it. The orchestrator routes it through gates and review.",
    input_schema: { type: "object", properties: { file: str, new_content: str, reason: str }, required: ["file", "new_content", "reason"] },
  },
  submit_review: {
    name: "submit_review",
    description: "Submit your review verdict. This ends your turn.",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["approve", "reject"] },
        reason: str,
        classification: { type: "string", enum: ["product_bug", "test_bug", "requirement_unclear", "none"] },
      },
      required: ["verdict", "reason", "classification"],
    },
  },
};

// submit_handover has a free-text shape in the loose team and a contract shape in the team with rules.
function handoverTool(agent: AgentName, cfg: TeamConfig): Tool {
  const description = "Hand your result over to the next agent. This ends your turn.";
  if (cfg.agents[agent].context !== "contract") {
    return { name: "submit_handover", description, input_schema: { type: "object", properties: { summary: str }, required: ["summary"] } };
  }
  const schemas: Record<string, Tool["input_schema"]> = {
    requirements: {
      type: "object",
      properties: {
        requirement_id: str,
        source: { type: "array", items: str },
        expected: {
          type: "object",
          properties: { goods_eur: { type: "number", description: "goods value before discount" }, shipping_eur: { type: "number" }, total_eur: { type: "number" } },
          required: ["goods_eur", "shipping_eur", "total_eur"],
        },
        assumptions: {
          type: "array",
          items: {
            type: "object",
            properties: { text: str, status: { type: "string", enum: ["confirmed", "unconfirmed"] }, evidence: str },
            required: ["text", "status"],
          },
        },
        open_questions: { type: "array", items: str },
        notes: { type: "array", items: str, description: "Observations that do not affect the expected total or the test steps. Never block the run." },
        oracle: { type: "string", enum: ["acceptance-criteria", "observed-behaviour"] },
      },
      required: ["requirement_id", "source", "expected", "assumptions", "open_questions", "oracle"],
    },
    test_data: {
      type: "object",
      properties: { fixture_file: str, owner: str, cleanup: str },
      required: ["fixture_file", "owner", "cleanup"],
    },
    ui: {
      type: "object",
      properties: { test_files: { type: "array", items: str }, requirement: str, asserted_total_eur: { type: "number" } },
      required: ["test_files", "requirement", "asserted_total_eur"],
    },
    execution: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        classification: { type: "string", enum: ["product_bug", "test_bug", "flaky", "environment", "none"] },
        evidence: {
          type: "object",
          properties: { failed_assertion: str, expected: str, actual: str, trace: str },
        },
        proposed_patch: { type: "boolean" },
      },
      required: ["status", "classification", "evidence", "proposed_patch"],
    },
  };
  return { name: "submit_handover", description, input_schema: schemas[agent] };
}

export function toolsFor(agent: AgentName, cfg: TeamConfig): Tool[] {
  return cfg.agents[agent].tools.map((name) => {
    if (name === "submit_handover") return handoverTool(agent, cfg);
    if (name === "read_doc") return { ...baseTools.read_doc, description: `Read a project document by name. Known names: ${cfg.available_docs!.join(", ")}.` };
    return baseTools[name];
  });
}

// ---------- permission checks ----------

function deny(ctx: ToolContext, tool: string, reason: string): ToolResult {
  ctx.log.emit({ type: "permission_denied", agent: ctx.agent, tool, summary: reason });
  return { content: `PERMISSION DENIED: ${reason}`, isError: true };
}

function canWrite(ctx: ToolContext, relPath: string): boolean {
  const abs = path.resolve(ROOT, relPath);
  if (!abs.startsWith(path.join(ROOT, "tests", "generated"))) return false;
  return ctx.cfg.agents[ctx.agent].write.some((p) => abs.startsWith(path.resolve(ROOT, p)));
}

// ---------- tool execution ----------

export async function runTool(ctx: ToolContext, name: string, input: any): Promise<ToolResult> {
  if (!ctx.cfg.agents[ctx.agent].tools.includes(name)) return deny(ctx, name, `${ctx.agent} is not granted the tool ${name}`);
  switch (name) {
    case "read_doc": {
      // A document that does not exist in this experiment is not a permission denial.
      if (!ctx.cfg.available_docs!.includes(input.name)) return { content: `Unknown document "${input.name}"`, isError: true };
      if (!ctx.cfg.agents[ctx.agent].docs.includes(input.name)) {
        return deny(ctx, name, `${ctx.agent} has no access to the document "${input.name}"`);
      }
      const file = DOCS[input.name];
      if (!file) return { content: `Unknown document "${input.name}"`, isError: true };
      const text = fs.readFileSync(file, "utf8");
      // Repeated work: the document was already read in this run and this agent already had it in its context.
      const ctxMode = ctx.cfg.agents[ctx.agent].context;
      const repeated = (ctx.state.docReads ??= []).includes(input.name) && (ctxMode === "full" || ctxMode === "summary");
      ctx.state.docReads.push(input.name);
      ctx.log.emit({ type: "spec_read", agent: ctx.agent, doc: input.name, chars: text.length, repeated, summary: input.name });
      return { content: text };
    }
    case "read_file": {
      const abs = path.resolve(ROOT, input.path);
      const roots = [path.join(ROOT, "tests"), ...readRoots(ctx)];
      if (!roots.some((r) => abs.startsWith(r + path.sep) || abs === r)) {
        return deny(ctx, name, readRoots(ctx).length ? "read_file is limited to tests/ and the current run's output" : "read_file is limited to tests/");
      }
      if (!fs.existsSync(abs)) return { content: `No such file: ${input.path}`, isError: true };
      return { content: fs.readFileSync(abs, "utf8") };
    }
    case "read_app_page": {
      const res = await fetch(new URL(input.path, ctx.state.productURL));
      const html = (await res.text()).replace(/<footer[\s\S]*?<\/footer>/, "");
      return { content: `HTTP ${res.status}\n${html}` };
    }
    case "create_basket": {
      const res = await fetch(new URL("/api/test-data/baskets", ctx.state.productURL), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: ownerFor(ctx), items: input.items, shippingEur: input.shippingEur }),
      });
      return { content: await res.text(), isError: !res.ok };
    }
    case "delete_basket": {
      const res = await fetch(new URL(`/api/test-data/baskets/${input.basketId}?owner=${ownerFor(ctx)}`, ctx.state.productURL), { method: "DELETE" });
      if (res.status === 403) return deny(ctx, name, `basket ${input.basketId} belongs to another owner`);
      return { content: await res.text(), isError: !res.ok };
    }
    case "write_fixture": {
      const rel = path.join("tests/generated/data", `${path.basename(String(input.name)).replace(/\.json$/, "")}.json`);
      if (!canWrite(ctx, rel)) return deny(ctx, name, `${ctx.agent} may not write ${rel}`);
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      const fixture = { owner: "qa-tests", items: input.items, shippingEur: input.shippingEur };
      fs.writeFileSync(rel, JSON.stringify(fixture, null, 2) + "\n");
      return { content: `Wrote ${rel}. Import it in a test with: import fixture from "./data/${path.basename(rel)}" with { type: "json" };` };
    }
    case "write_test": {
      const rel = path.join("tests/generated", String(input.file).replace(/^tests\/generated\//, ""));
      if (!canWrite(ctx, rel)) {
        return deny(ctx, name, `${ctx.agent} has no write access to tests. Use propose_patch to suggest a change.`);
      }
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      fs.writeFileSync(rel, input.content);
      (ctx.state.testVersions[rel] ??= []).push({ by: ctx.agent, content: input.content });
      const versions = ctx.state.testVersions[rel];
      if (versions.length > 1) {
        ctx.log.emit({ type: "note", agent: ctx.agent, summary: `modified ${rel}`, diff: expectationChange(versions[0].content, input.content) });
      }
      return { content: `Wrote ${rel}` };
    }
    case "run_tests":
      return runTests(ctx);
    case "propose_patch": {
      ctx.state.proposals.push({ by: ctx.agent, file: input.file, new_content: input.new_content, reason: input.reason });
      return { content: "Patch recorded. It will go through the assertion-diff gate and review. It has NOT been applied." };
    }
    case "submit_handover":
      ctx.state.handovers[ctx.agent] = input;
      ctx.log.emit({ type: "handover", agent: ctx.agent, handover: input, summary: summarizeHandover(input) });
      return { content: "Handover accepted.", terminal: true };
    case "submit_review":
      ctx.state.review = input;
      ctx.log.emit({ type: "handover", agent: ctx.agent, handover: input, summary: `${String(input.verdict).toUpperCase()}: ${input.reason}` });
      return { content: "Review recorded.", terminal: true };
  }
  return { content: `Unknown tool ${name}`, isError: true };
}

function ownerFor(ctx: ToolContext): string {
  return `${ctx.agent}-${ctx.state.runId}`;
}

function summarizeHandover(h: any): string {
  if (typeof h.summary === "string") return h.summary.slice(0, 160);
  return JSON.stringify(h).slice(0, 160);
}

// Returns the expected values asserted with toHaveText/toContainText/toBe before and after a change.
export function expectationChange(before: string, after: string): { before: string[]; after: string[] } | null {
  const grab = (s: string) =>
    [...s.matchAll(/(?:toHaveText|toContainText|toBe|toEqual)\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]).filter((v) => /\d/.test(v));
  const b = grab(before);
  const a = grab(after);
  if (JSON.stringify(b) === JSON.stringify(a)) return null;
  // Report only the values that differ, position by position.
  const n = Math.max(a.length, b.length);
  const diff = { before: [] as string[], after: [] as string[] };
  for (let i = 0; i < n; i++) {
    if (b[i] === a[i]) continue;
    if (b[i] !== undefined) diff.before.push(b[i]);
    if (a[i] !== undefined) diff.after.push(a[i]);
  }
  return diff;
}

async function runTests(ctx: ToolContext): Promise<ToolResult> {
  const { state, cfg, log } = ctx;
  if (state.testRuns.length >= cfg.limits.max_test_runs) {
    return { content: `Limit reached: the suite already ran ${state.testRuns.length} times in this run. Stop and hand over.`, isError: true };
  }
  const n = state.testRuns.length + 1;
  const outDir = path.join(log.dir, `pw-${n}`);
  const report = path.join(outDir, "report.json");
  const raw = await new Promise<string>((resolve) => {
    let out = "";
    const child = spawn(process.execPath, [path.join(ROOT, "node_modules/@playwright/test/cli.js"), "test"], {
      env: { ...process.env, BASE_URL: state.productURL, PW_OUTPUT_DIR: outDir, PW_JSON_REPORT: report, FORCE_COLOR: "0" },
    });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.replace(/\u001b\[[0-9;]*m/g, "")));
  });
  const run = parseReport(report, n, raw);
  state.testRuns.push(run);
  log.emit({
    type: "test_run", agent: ctx.agent, n, passed: run.passed, failed: run.failed, failures: run.failures,
    summary: `run #${n}: ${run.passed} passed, ${run.failed} failed`,
  });
  // The loose team pastes the whole raw output back into the conversation; the team with rules gets a compact summary.
  if (cfg.agents[ctx.agent].context === "full") return { content: raw };
  return { content: JSON.stringify({ run: n, passed: run.passed, failed: run.failed, failures: run.failures }, null, 2) };
}

// Extra read_file roots granted to this agent by the config ("run-output" = this run's directory).
function readRoots(ctx: ToolContext): string[] {
  return (ctx.cfg.agents[ctx.agent].read ?? []).map((r) => (r === "run-output" ? path.resolve(ctx.log.dir) : path.resolve(ROOT, r)));
}

function parseReport(file: string, n: number, raw: string): TestRun {
  const run: TestRun = { n, passed: 0, failed: 0, failures: [], rawOutput: raw };
  if (!fs.existsSync(file)) {
    run.failed = 1;
    run.failures.push({ title: "suite did not run", message: raw.slice(-2000) });
    return run;
  }
  const rep = JSON.parse(fs.readFileSync(file, "utf8"));
  const walk = (suite: any) => {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const r = t.results?.[t.results.length - 1];
        if (!r) continue;
        if (r.status === "passed") run.passed++;
        else {
          run.failed++;
          const trace = (r.attachments ?? []).find((a: any) => a.name === "trace")?.path;
          // Playwright writes error-context.md (an accessibility snapshot of the page) next to the trace on failure.
          const snapshot = (r.attachments ?? []).find((a: any) => a.name === "error-context")?.path;
          const message = String(r.error?.message ?? r.status).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1200);
          run.failures.push({
            title: spec.title, message,
            trace: trace ? path.relative(ROOT, trace) : undefined,
            page_snapshot: snapshot ? path.relative(ROOT, snapshot) : undefined,
          });
        }
      }
    }
  };
  for (const s of rep.suites ?? []) walk(s);
  if (run.passed + run.failed === 0 && (rep.errors ?? []).length) {
    run.failed = 1;
    run.failures.push({ title: "suite error", message: String(rep.errors[0].message ?? "").slice(0, 1200) });
  }
  return run;
}
