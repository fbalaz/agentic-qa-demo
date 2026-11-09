// Starts the checkout app in a given build and waits until it answers /health.
import { spawn, type ChildProcess } from "node:child_process";

export type Build = "correct" | "broken";
export type RunningApp = { build: Build; baseURL: string; stop: () => Promise<void> };

export const DEFAULT_PORTS: Record<Build, number> = { correct: 3100, broken: 3101 };

// `bug` overrides DEMO_BUG for this broken build (used by scripts/recheck.ts, which replays runs made with different bugs).
export async function startApp(build: Build, port = DEFAULT_PORTS[build], bug?: string): Promise<RunningApp> {
  const baseURL = `http://localhost:${port}`;
  if (await healthy(baseURL, build)) {
    // Already running (e.g. started by hand before the talk). Reuse it, don't stop it.
    return { build, baseURL, stop: async () => {} };
  }
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "app/server.ts"], {
    // DEMO_BUG picks the planted bug of the broken build: unset = no discount at all (€105), "shipping" = discount on shipping too (€94.50).
    env: { ...process.env, PORT: String(port), DISCOUNT_BUG: build === "broken" ? (bug || process.env.DEMO_BUG || "1") : "0" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (await healthy(baseURL, build)) {
      return {
        build,
        baseURL,
        stop: async () => {
          child.kill();
          await new Promise((r) => child.once("exit", r));
        },
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`app (${build}) did not start on ${baseURL}`);
}

async function healthy(baseURL: string, build: Build): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL}/health`, { headers: { "x-demo-harness": "1" } });
    const body = (await res.json()) as { build?: string };
    return body.build === build;
  } catch {
    return false;
  }
}
