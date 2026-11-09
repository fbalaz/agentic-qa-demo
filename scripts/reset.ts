// Clears generated tests and Playwright output so the next run starts clean. Runs are kept.
import fs from "node:fs";
import path from "node:path";

for (const entry of fs.readdirSync("tests/generated")) {
  if (entry !== ".gitkeep") fs.rmSync(path.join("tests/generated", entry), { recursive: true, force: true });
}
fs.rmSync("test-results", { recursive: true, force: true });
console.log("tests/generated and test-results cleared");
