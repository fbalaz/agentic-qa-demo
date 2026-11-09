// Gate: the suite must pass on the correct build and fail on the broken build.
// A tiny form of mutation testing: a test that passes on both builds does not protect anything.
import { startApp } from "../orchestrator/apps.js";
import { fail, pass, runSuite, specFiles } from "./common.js";

const GATE = "sensitivity";
if (!specFiles().length) fail(GATE, "no tests in tests/generated");

const correct = await startApp("correct");
const broken = await startApp("broken");
const good = await runSuite(correct.baseURL, "test-results/sensitivity-correct");
const bad = await runSuite(broken.baseURL, "test-results/sensitivity-broken");
await correct.stop();
await broken.stop();
console.log(`  correct build: ${good.passed} passed, ${good.failed} failed`);
console.log(`  broken build:  ${bad.passed} passed, ${bad.failed} failed`);
if (good.failed > 0) fail(GATE, "the suite fails on the correct build");
if (bad.failed === 0) fail(GATE, "the suite passes on the broken build: it does not catch the bug");
pass(GATE, "passes on the correct build, fails on the broken one");
