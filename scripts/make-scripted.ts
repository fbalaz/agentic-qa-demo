// Generates fixtures/scripted-*.jsonl (main comparison and the no-AC experiment): hand-written agent
// responses that reproduce the talk's story without calling the API. Tools still run for real
// (tests really fail on the broken build). Token counts are estimates. Always present these as
// "scripted", never as a recorded model run.
import fs from "node:fs";
import type { AgentName } from "../orchestrator/config.js";
import type { Recording } from "../orchestrator/model.js";

let idCounter = 0;
type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
const say = (text: string): Block => ({ type: "text", text });
const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `toolu_scripted_${++idCounter}`, name, input });

function recordings(script: [AgentName, Block[], number?][]): Recording[] {
  const calls = new Map<AgentName, number>();
  // Rough token estimate: context grows with each call of the same agent.
  const ctx = new Map<AgentName, number>();
  return script.map(([agent, content, contextTokens]) => {
    const call = (calls.get(agent) ?? 0) + 1;
    calls.set(agent, call);
    const out = Math.ceil(JSON.stringify(content).length / 4) + 120;
    const input = (ctx.get(agent) ?? 0) + (contextTokens ?? 1500);
    ctx.set(agent, input + out);
    return {
      agent,
      call,
      response: {
        content: content as any,
        stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        usage: { input_tokens: input, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model: "claude-opus-5-5",
        latency_ms: 2500 + out * 8,
        estimated: true,
      },
    };
  });
}

const FIXTURE = { name: "checkout-01-basket", items: [{ sku: "HEADPHONES", name: "Headphones", priceEur: 100 }], shippingEur: 5 };

const spec = (total: string, header = "") => `${header}import { test, expect } from "@playwright/test";
import fixture from "./data/checkout-01-basket.json" with { type: "json" };
import { createBasket, deleteBasket } from "../support/basket";

test.describe("CHECKOUT-01 coupon SAVE10", () => {
  let basket: { basketId: string; url: string };

  test.beforeEach(async ({ request }) => {
    basket = await createBasket(request, fixture);
  });

  test.afterEach(async ({ request }) => {
    await deleteBasket(request, basket.basketId, fixture.owner);
  });

  test("shows the coupon as applied", async ({ page }) => {
    await page.goto(basket.url);
    await page.getByTestId("coupon-input").fill("SAVE10");
    await page.getByTestId("apply-coupon").click();
    await expect(page.getByTestId("coupon-message")).toHaveText("Coupon SAVE10 applied");
  });

  test("order total after SAVE10", async ({ page }) => {
    await page.goto(basket.url);
    await page.getByTestId("coupon-input").fill("SAVE10");
    await page.getByTestId("apply-coupon").click();
    await expect(page.getByTestId("order-total")).toHaveText("${total}");
  });
});
`;

// ---------------- loose team ----------------
// Same documents as the team with rules. The failure is the "repair until green", not missing information.
const loose = recordings([
  ["requirements", [say("Reading the user story and the acceptance criteria."), use("read_doc", { name: "user-story" }), use("read_doc", { name: "acceptance-criteria" })], 900],
  ["requirements", [use("submit_handover", {
    summary:
      "Test conditions for CHECKOUT-01: (1) SAVE10 is accepted and a confirmation is shown (AC-1), (2) 10% off the goods, shipping not discounted (AC-2, AC-3). " +
      "Basket €100 + €5 shipping -> expected total €95.00. Risks: rounding, coupon case sensitivity.",
  })]],
  ["test_data", [say("Let me re-read the requirement to be sure of the basket."), use("read_doc", { name: "user-story" }), use("read_doc", { name: "acceptance-criteria" })], 2600],
  ["test_data", [say("Basket as in AC-3."), use("write_fixture", FIXTURE)]],
  ["test_data", [use("submit_handover", { summary: "Basket: headphones €100 + shipping €5 in tests/generated/data/checkout-01-basket.json. Expected total with SAVE10: €95.00." })]],
  ["ui", [say("Reading the requirement, the helper and the page."), use("read_doc", { name: "acceptance-criteria" }), use("read_file", { path: "tests/support/basket.ts" }), use("read_app_page", { path: "/cart/demo" })], 4200],
  ["ui", [say("Writing the tests: coupon message and order total €95.00."), use("write_test", { file: "checkout-01.spec.ts", content: spec("€95.00") })]],
  ["ui", [use("submit_handover", { summary: "Wrote tests/generated/checkout-01.spec.ts: coupon message + order total €95.00." })]],
  ["execution", [say("Re-reading the requirement, then running the suite."), use("read_doc", { name: "user-story" }), use("run_tests", {})], 6800],
  ["execution", [say("The total assertion failed: €105.00 instead of €95.00. Re-running to rule out flakiness."), use("run_tests", {})]],
  ["execution", [say("Still €105.00. One more run to be sure."), use("run_tests", {})]],
  ["execution", [say("The application consistently shows €105.00 after SAVE10 and the coupon message is shown, so the coupon works. The expected total looks outdated; repairing it to match the current behaviour, as instructed."), use("write_test", { file: "checkout-01.spec.ts", content: spec("€105.00") })]],
  ["execution", [use("run_tests", {})]],
  ["execution", [use("submit_handover", { summary: "Fixed outdated assertion, all tests pass (2/2). The order total expectation was updated to the value the application shows." })]],
  ["reviewer", [use("submit_review", { verdict: "approve", reason: "Execution Agent fixed an outdated assertion; all tests pass. Coupon flow covered.", classification: "none" })], 700],
]);

// ---------------- loose team, no acceptance criteria (separate experiment) ----------------
// Only the user story exists, so the Requirements Agent guesses that shipping is discounted (€94.50)
// and the guess travels through the team as a fact.
const looseNoAC = recordings([
  ["requirements", [say("Reading the requirement first."), use("read_doc", { name: "user-story" })], 900],
  ["requirements", [use("submit_handover", {
    summary:
      "Test conditions for CHECKOUT-01: (1) SAVE10 is accepted and a confirmation is shown, (2) the order total drops by 10%. " +
      "Assumption: discount probably applies to the whole order (goods + shipping). Example basket €100 + €5 shipping -> expected total €94.50. " +
      "Risks: rounding, coupon case sensitivity.",
  })]],
  ["test_data", [say("Let me re-read the requirement to be sure of the basket."), use("read_doc", { name: "user-story" })], 2600],
  ["test_data", [say("Basket configured for whole-order discount, as the Requirements Agent described."), use("write_fixture", FIXTURE)]],
  ["test_data", [use("submit_handover", { summary: "Basket configured for whole-order discount: headphones €100 + shipping €5 in tests/generated/data/checkout-01-basket.json. Expected total with SAVE10: €94.50." })]],
  ["ui", [say("Reading the requirement, the helper and the page."), use("read_doc", { name: "user-story" }), use("read_file", { path: "tests/support/basket.ts" }), use("read_app_page", { path: "/cart/demo" })], 4200],
  ["ui", [say("Writing the tests: expect 10% off order total (94.50)."), use("write_test", { file: "checkout-01.spec.ts", content: spec("€94.50") })]],
  ["ui", [use("submit_handover", { summary: "Wrote tests/generated/checkout-01.spec.ts: coupon message + expect 10% off order total (94.50)." })]],
  ["execution", [say("Re-reading the requirement, then running the suite."), use("read_doc", { name: "user-story" }), use("run_tests", {})], 6800],
  ["execution", [say("The total assertion failed: €105.00 instead of €94.50. Re-running to rule out flakiness."), use("run_tests", {})]],
  ["execution", [say("Still €105.00. One more run to be sure."), use("run_tests", {})]],
  ["execution", [say("The application consistently shows €105.00 after SAVE10. The test expectation looks outdated, so I am repairing it to match the current behaviour, as instructed."), use("write_test", { file: "checkout-01.spec.ts", content: spec("€105.00") })]],
  ["execution", [use("run_tests", {})]],
  ["execution", [use("submit_handover", { summary: "Fixed outdated assertion, all tests pass (2/2). The order total expectation was updated to the value the application shows." })]],
  ["reviewer", [use("submit_review", { verdict: "approve", reason: "Execution Agent fixed an outdated assertion; all tests pass. Test VERIFIES order-level discount.", classification: "none" })], 700],
]);

// ---------------- team with rules ----------------
const contract = {
  requirement_id: "CHECKOUT-01",
  source: ["user-story-v3", "ac-v2"],
  expected: { goods_eur: 100, shipping_eur: 5, total_eur: 95 },
  assumptions: [{ text: "Shipping is excluded from the discount", status: "confirmed", evidence: "ac-v2#AC-3" }],
  open_questions: [],
  oracle: "acceptance-criteria",
};
const rules = recordings([
  ["requirements", [say("Reading the user story and the acceptance criteria."), use("read_doc", { name: "user-story" }), use("read_doc", { name: "acceptance-criteria" })], 900],
  ["requirements", [say("The user story says '10% off my order'; AC-3 says shipping is never discounted. Confirmed from AC-3: expected total €95.00."), use("submit_handover", contract)]],
  ["test_data", [use("write_fixture", FIXTURE)], 700],
  ["test_data", [use("submit_handover", { fixture_file: "tests/generated/data/checkout-01-basket.json", owner: "qa-tests", cleanup: "each test deletes its basket in afterEach" })]],
  ["ui", [use("read_file", { path: "tests/support/basket.ts" }), use("read_app_page", { path: "/cart/demo" })], 900],
  ["ui", [use("write_test", { file: "checkout-01.spec.ts", content: spec("€95.00", "// @requirement CHECKOUT-01@ac-v2\n") })]],
  ["ui", [use("submit_handover", { test_files: ["tests/generated/checkout-01.spec.ts"], requirement: "CHECKOUT-01@ac-v2", asserted_total_eur: 95 })]],
  ["execution", [use("run_tests", {})], 800],
  ["execution", [say("The total shows €105.00 instead of €95.00. The test may be outdated; updating the expectation."), use("write_test", { file: "checkout-01.spec.ts", content: spec("€105.00", "// @requirement CHECKOUT-01@ac-v2\n") })]],
  ["execution", [say("I have no write access. Proposing the change instead."), use("propose_patch", { file: "checkout-01.spec.ts", new_content: spec("€105.00", "// @requirement CHECKOUT-01@ac-v2\n"), reason: "Application consistently shows €105.00; expectation may be outdated." })]],
  ["execution", [use("submit_handover", {
    status: "failed",
    classification: "test_bug",
    evidence: { failed_assertion: "order-total toHaveText('€95.00')", expected: "€95.00", actual: "€105.00", trace: "see run #1 trace" },
    proposed_patch: true,
  })]],
  ["reviewer", [say("Checking the source of truth myself."), use("read_doc", { name: "acceptance-criteria" })], 2400],
  ["reviewer", [use("submit_review", {
    verdict: "reject",
    reason: "The proposed change 95 -> 105 contradicts AC-3 (shipping is never discounted, total €95.00). The trace shows the coupon accepted but no discount applied: this is a product bug, not an outdated test.",
    classification: "product_bug",
  })]],
]);

// ---------------- team with rules, no acceptance criteria (separate experiment) ----------------
// The right reaction: write the guess down as unconfirmed and stop for a human before any test exists.
const rulesNoAC = recordings([
  ["requirements", [say("Reading the user story and the acceptance criteria."), use("read_doc", { name: "user-story" }), use("read_doc", { name: "acceptance-criteria" })], 900],
  ["requirements", [say("There are no acceptance criteria. The user story says '10% off my order' and does not say whether shipping is discounted (€94.50 or €95.00). I will not guess."), use("submit_handover", {
    requirement_id: "CHECKOUT-01",
    source: ["user-story-v3"],
    expected: { goods_eur: 100, shipping_eur: 5, total_eur: 94.5 },
    assumptions: [{ text: "SAVE10 also discounts shipping (10% off the whole order)", status: "unconfirmed" }],
    open_questions: ["Is shipping discounted by SAVE10? Expected total is €94.50 if yes, €95.00 if no."],
    oracle: "acceptance-criteria",
  })]],
]);

fs.mkdirSync("fixtures", { recursive: true });
for (const [name, recs] of [["scripted-loose", loose], ["scripted-rules", rules], ["scripted-loose-no-ac", looseNoAC], ["scripted-rules-no-ac", rulesNoAC]] as const) {
  fs.writeFileSync(`fixtures/${name}.jsonl`, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote fixtures/${name}.jsonl (${recs.length} model responses)`);
}
