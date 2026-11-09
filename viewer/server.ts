// Run viewer: npm run viewer -> http://localhost:4000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readEvents } from "../orchestrator/runlog.js";
import { buildReport } from "../orchestrator/report.js";
import { recordDecision } from "../orchestrator/decide.js";

const PORT = Number(process.env.VIEWER_PORT ?? 4000);
const RUNS = "runs";

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function listRuns() {
  if (!fs.existsSync(RUNS)) return [];
  return fs
    .readdirSync(RUNS)
    .filter((d) => fs.existsSync(path.join(RUNS, d, "events.jsonl")))
    .sort()
    .reverse()
    .map((id) => {
      const r = buildReport(path.join(RUNS, id));
      return { id, config: r.config, source: r.source, status: r.status };
    });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync("viewer/index.html"));
      }
      if (url.pathname === "/api/runs") return json(res, 200, listRuns());
      if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
        const id = path.basename(parts[2]);
        const dir = path.join(RUNS, id);
        if (!fs.existsSync(dir)) return json(res, 404, { error: "no such run" });
        if (parts[3] === "events") return json(res, 200, readEvents(dir));
        if (parts[3] === "report") return json(res, 200, buildReport(dir));
        if (parts[3] === "decision" && req.method === "POST") {
          let raw = "";
          for await (const c of req) raw += c;
          const { decision, by } = JSON.parse(raw || "{}");
          return json(res, 200, recordDecision(id, decision, by ?? "human"));
        }
      }
      res.writeHead(404);
      res.end("not found");
    } catch (e) {
      json(res, 400, { error: String(e instanceof Error ? e.message : e) });
    }
  })
  .listen(PORT, () => console.log(`run viewer on http://localhost:${PORT}`));
