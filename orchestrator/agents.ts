// What each agent is told, and what context it gets. The two team configs share the same roles;
// they differ in context ("full" vs "contract"/"evidence"/"summary") and in the extra rules below.
import fs from "node:fs";
import { teamKind, type AgentName, type TeamConfig } from "./config.js";
import { expectationChange, type RunState } from "./tools.js";

export const AGENT_LABELS: Record<AgentName, string> = {
  requirements: "Requirements Agent",
  test_data: "Test Data Agent",
  ui: "UI Agent",
  execution: "Execution Agent",
  reviewer: "Reviewer Agent",
};

const ROLE: Record<AgentName, string> = {
  requirements:
    "You are the Requirements Agent. Analyse the requirement CHECKOUT-01, identify risks and test conditions, " +
    "and state the expected values for the example basket so the rest of the team can test against them.",
  test_data:
    "You are the Test Data Agent. Prepare the test data the scenario needs. Write a basket fixture with write_fixture. " +
    "You may check that it works with create_basket, but delete every basket you create.",
  ui:
    "You are the UI Agent. Write Playwright tests in TypeScript (@playwright/test) as tests/generated/checkout-01.spec.ts. " +
    "Read tests/support/basket.ts first and use createBasket()/deleteBasket() with the fixture from tests/generated/data/ " +
    "(import it from './data/<name>.json' with { type: 'json' }; the helper is at '../support/basket'). Use read_app_page on /cart/demo to learn the page; " +
    "use data-testid selectors. Apply the coupon by filling coupon-input and clicking apply-coupon. Assert the coupon message and the order total.",
  execution:
    "You are the Execution Agent. Run the generated suite with run_tests and investigate every failure.",
  reviewer:
    "You are the Reviewer Agent. You independently review the team's result and decide whether it can be merged.",
};

const RULES: Partial<Record<AgentName, string>> = {
  requirements:
    "Rules: expected values come from the acceptance criteria (oracle: acceptance-criteria), never from observed application behaviour. " +
    "Record every assumption with status 'confirmed' plus an evidence reference (e.g. ac-v2#AC-3), or 'unconfirmed'. " +
    "Anything you cannot confirm goes into open_questions. Use document versions in source (user-story-v3, ac-v2). " +
    "assumptions and open_questions are only for things the expected values or the test steps depend on: " +
    "an unconfirmed entry stops the whole run for a human. Edge cases the example basket does not exercise " +
    "(rounding, input handling, display details) go into notes instead, and notes never block. " +
    "goods_eur is the value of the goods in the basket before any discount.",
  ui:
    "Rules: the first line of every test file must be `// @requirement <requirement_id>@<acceptance criteria version>`, e.g. `// @requirement CHECKOUT-01@ac-v2`. " +
    "Assert exactly the expected total from the contract. Never derive expected values from the running application.",
  execution:
    "Rules: you have no write access to tests. Do not change expected values to match the application. " +
    "Classify each failure as product_bug, test_bug, flaky or environment, with evidence: the failed assertion, expected, actual and the trace path. " +
    "If you believe a test must change, describe the change with propose_patch; it will be reviewed and will not be applied automatically.",
  reviewer:
    "Rules: review against the acceptance criteria and the raw evidence, not against another agent's summary. " +
    "Reject any change to an expected value that contradicts the acceptance criteria. Classify the outcome.",
};

export function systemPrompt(agent: AgentName, cfg: TeamConfig): string {
  const parts = [
    "You are part of an automated QA team of five agents: Requirements, Test Data, UI, Execution and Reviewer. " +
      "An orchestrator runs you in that order and passes work between you.",
    `The team's instruction: ${cfg.team_instruction}`,
    ROLE[agent],
  ];
  if (teamKind(cfg) === "rules" && RULES[agent]) parts.push(RULES[agent]!);
  parts.push("When you are done, call submit_handover (or submit_review if you are the Reviewer). Do not ask the user questions; nobody is watching live.");
  return parts.join("\n\n");
}

// Text record of everything each agent did, used for the "full context" pattern of the loose team.
export type Transcript = Partial<Record<AgentName, string>>;

export function contextFor(agent: AgentName, cfg: TeamConfig, state: RunState, transcripts: Transcript): string {
  const mode = cfg.agents[agent].context;
  const h = state.handovers;
  if (mode === "full") {
    const story = fs.readFileSync("specs/user-story.md", "utf8");
    const earlier = Object.entries(transcripts)
      .map(([name, text]) => `=== Everything the ${AGENT_LABELS[name as AgentName]} did ===\n${text}`)
      .join("\n\n");
    const docs = `Project documents you can read with read_doc: ${cfg.agents[agent].docs.join(", ") || "none"}.`;
    return [`Requirement:\n${story}`, docs, earlier || "You are the first agent.", "Do your part now."].join("\n\n");
  }
  if (mode === "summary") {
    const last = state.testRuns.at(-1);
    const status = last ? (last.failed === 0 ? "GREEN" : "RED") : "NOT RUN";
    return `Summary from the Execution Agent:\n${h.execution?.summary ?? "(no summary)"}\n\nPipeline status: ${status}\n\nPlease review and give your verdict.`;
  }
  if (mode === "contract") {
    const payload: Record<string, unknown> = {};
    if (agent === "test_data") payload.requirement_contract = h.requirements;
    if (agent === "ui") Object.assign(payload, { requirement_contract: h.requirements, test_data: h.test_data });
    if (agent === "execution") Object.assign(payload, { expected: h.requirements?.expected, ui: h.ui });
    if (agent === "requirements") return "Start with the requirement CHECKOUT-01. Read the documents you have access to.";
    return `Your input (handover contract):\n${JSON.stringify(payload, null, 2)}`;
  }
  // evidence: what an independent reviewer needs. Source of truth and raw evidence, not a summary.
  const files = Object.entries(state.testVersions).map(([file, versions]) => ({
    file,
    written_by: versions[0].by,
    expectation_changes_after_first_version: expectationChange(versions[0].content, versions.at(-1)!.content),
    current_content: versions.at(-1)!.content,
  }));
  const proposals = state.proposals.map((p) => {
    const original = state.testVersions[`tests/generated/${p.file.replace(/^tests\/generated\//, "")}`]?.[0]?.content ?? "";
    return { by: p.by, file: p.file, reason: p.reason, expectation_change: expectationChange(original, p.new_content) };
  });
  const last = state.testRuns.at(-1);
  return `Evidence package:\n${JSON.stringify(
    {
      requirement_contract: h.requirements,
      tests: files,
      proposed_patches: proposals,
      last_test_run: last && { run: last.n, passed: last.passed, failed: last.failed, failures: last.failures },
      execution_classification: h.execution && { status: h.execution.status, classification: h.execution.classification, evidence: h.execution.evidence },
      gates: state.gateResults ?? [],
    },
    null,
    2,
  )}\n\n${
    cfg.agents.reviewer.read?.includes("run-output")
      ? "Every failure lists a page_snapshot: the page as rendered when the test failed. Read it with read_file and check what the page really showed before you classify. "
      : ""
  }${cfg.agents.reviewer.docs.includes("acceptance-criteria") ? "Read the acceptance criteria yourself, then give your verdict." : "Give your verdict."}`;
}
