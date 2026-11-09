// Append-only run log. Every decision, tool call, model call and gate result is one JSON line in
// runs/<runId>/events.jsonl. The viewer, the measurement script and the evidence gate all read it.
import fs from "node:fs";
import path from "node:path";

export type RunEvent = {
  t: number; // ms since run start
  type:
    | "run_start" | "agent_start" | "agent_end" | "model_call" | "tool_call" | "permission_denied"
    | "handover" | "gate" | "test_run" | "spec_read" | "human_decision_required" | "human_decision"
    | "note" | "run_end";
  agent?: string;
  [key: string]: unknown;
};

export class RunLog {
  readonly dir: string;
  private readonly file: string;
  readonly startedAt = Date.now();

  constructor(readonly runId: string, root = "runs") {
    this.dir = path.join(root, runId);
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, "events.jsonl");
  }

  emit(e: Omit<RunEvent, "t">): void {
    const event = { t: Date.now() - this.startedAt, ...e } as RunEvent;
    fs.appendFileSync(this.file, JSON.stringify(event) + "\n");
    const who = e.agent ? `[${e.agent}]` : "[orchestrator]";
    const detail = (e.summary ?? e.tool ?? e.result ?? e.status ?? "") as string;
    console.log(`${String(event.t).padStart(6)}ms ${who.padEnd(16)} ${e.type} ${detail}`);
  }

  writeJson(name: string, data: unknown): void {
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(data, null, 2));
  }
}

export function readEvents(runDir: string): RunEvent[] {
  const file = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function newRunId(config: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${stamp}-${config}`;
}
