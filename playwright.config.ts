import { defineConfig } from "@playwright/test";

// Apps are started by the orchestrator / gates (see orchestrator/apps.ts), not by Playwright,
// so the same tests can run against the correct and the broken build.
export default defineConfig({
  testDir: process.env.TEST_DIR ?? "tests/generated",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  reporter: [["list"], ["json", { outputFile: process.env.PW_JSON_REPORT ?? "test-results/report.json" }]],
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on",
  },
});
