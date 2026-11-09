import fs from "node:fs";
import YAML from "yaml";

// Pick up ANTHROPIC_API_KEY / DEMO_MODEL from .env when present. Variables already set in the shell win.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

export const AGENT_NAMES = ["requirements", "test_data", "ui", "execution", "reviewer"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type ContextMode = "full" | "contract" | "summary" | "evidence";

export type AgentConfig = {
  docs: string[];
  tools: string[];
  write: string[];
  // Extra roots read_file may open besides tests/. "run-output" is the current run's directory
  // (Playwright traces and the error-context.md page snapshots written on failure).
  read?: string[];
  context: ContextMode;
};

export type TeamConfig = {
  name: string;
  // Documents that exist in this experiment. Default: both. The "no-ac" experiments remove the acceptance criteria.
  available_docs?: string[];
  team_instruction: string;
  model: { id: string; effort: "low" | "medium" | "high" | "xhigh" | "max"; max_tokens: number; fallbacks?: "default" | null };
  limits: { max_test_runs: number; max_turns_per_agent: number };
  agents: Record<AgentName, AgentConfig>;
  gates: { assumptions: boolean; contract_trace: boolean; assertion_diff: boolean; evidence: boolean };
};

export function loadConfig(name: string): TeamConfig {
  const file = name.endsWith(".yaml") ? name : `orchestrator/configs/${name}.yaml`;
  const cfg = YAML.parse(fs.readFileSync(file, "utf8")) as TeamConfig;
  for (const a of AGENT_NAMES) if (!cfg.agents[a]) throw new Error(`${file}: missing agent "${a}"`);
  if (process.env.DEMO_MODEL) cfg.model.id = process.env.DEMO_MODEL;
  cfg.available_docs ??= ["user-story", "acceptance-criteria"];
  for (const a of AGENT_NAMES) cfg.agents[a].docs = cfg.agents[a].docs.filter((d) => cfg.available_docs!.includes(d));
  return cfg;
}

// "loose", "loose-no-ac" -> "loose"; "rules", "rules-no-ac" -> "rules"
export const teamKind = (cfg: TeamConfig) => (cfg.name.startsWith("rules") ? "rules" : "loose");
