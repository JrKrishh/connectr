import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { addTaskFromInput, launchPlanned, planOpenTickets } from "../host.js";
import { factKind } from "../memory.js";
import { loadConfig } from "../routing.js";
import { Store, liveAgentIds } from "../store.js";
import { UI_HTML } from "./page.js";

const dispatched = new Set<string>();

function stateView(): unknown {
  const store = new Store();
  const config = loadConfig(process.cwd());
  const d = store.read();
  const now = Date.now();
  const live = new Set(liveAgentIds(d));
  const runsDir = path.join(store.dir, "runs");
  let allRuns: { file: string; mtime: number }[] = [];
  try {
    allRuns = fs
      .readdirSync(runsDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ file: f, mtime: fs.statSync(path.join(runsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    /* no runs yet */
  }
  const runs = allRuns.slice(0, 20);
  return {
    project: path.basename(process.cwd()),
    cwd: process.cwd(),
    mode: config.permissionMode,
    planFile: config.planFile ?? null,
    agents: Object.values(d.agents)
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
      .map((a) => ({ id: a.id, tool: a.tool, model: a.model, lastSeen: a.lastSeen, live: live.has(a.id) })),
    tickets: d.tickets.map((t) => ({
      id: t.id,
      title: t.title,
      desc: t.desc,
      status: t.status,
      owner: t.owner ?? null,
      resolution: t.resolution ?? null,
      routedTo: t.routedTo ?? null,
      lastNote: t.notes.at(-1)?.text ?? null,
      updatedAt: t.updatedAt,
      notes: t.notes,
      runs: allRuns.filter((r) => r.file.startsWith(`${t.id}-`)).map((r) => r.file),
    })),
    claims: d.claims.filter((c) => c.expiresAt > now).map((c) => ({ agent: c.agent, paths: c.paths })),
    facts: [...d.facts]
      .slice(-30)
      .reverse()
      .map((f) => ({ id: f.id, kind: factKind(f), text: f.text, fix: f.fix ?? null, tags: f.tags, agent: f.agent })),
    runs: runs.map((r) => r.file),
  };
}

function json(res: http.ServerResponse, code: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += String(c);
      if (raw.length > 64_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(UI_HTML);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    json(res, 200, stateView());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    let last = "";
    const push = (): void => {
      try {
        const now = JSON.stringify(stateView());
        if (now !== last) {
          last = now;
          res.write(`data: ${now}\n\n`);
        }
      } catch {
        /* keep stream alive across transient store reads */
      }
    };
    push();
    const timer = setInterval(push, 1000);
    const beat = setInterval(() => res.write(": beat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(timer);
      clearInterval(beat);
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/log") {
    const file = path.basename(url.searchParams.get("file") ?? ""); // basename kills traversal
    const full = path.join(new Store().dir, "runs", file);
    if (!file.endsWith(".log") || !fs.existsSync(full)) {
      json(res, 404, { error: "log not found" });
      return;
    }
    const size = fs.statSync(full).size;
    const start = Math.max(0, size - 16_000);
    const fd = fs.openSync(full, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    json(res, 200, { file, tail: buf.toString("utf8") });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/task") {
    const body = await readBody(req);
    const result = await addTaskFromInput(new Store(), loadConfig(process.cwd()), String(body.input ?? ""), "web-host");
    json(res, result.error ? 400 : 200, result);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/dispatch") {
    const body = await readBody(req);
    const store = new Store();
    const config = loadConfig(process.cwd());
    const plan = await planOpenTickets(store, config, { exclude: dispatched });
    if (body.dry) {
      json(res, 200, {
        mode: config.permissionMode,
        plan: plan.map((t) => ({ id: t.id, title: t.title, tool: t.routedTo!.tool, model: t.routedTo!.model ?? null })),
      });
      return;
    }
    const launches = launchPlanned(plan, process.cwd(), store.dir, config, true);
    for (const l of launches) if (l.ok) dispatched.add(l.id);
    json(res, 200, { mode: config.permissionMode, launches });
    return;
  }
  json(res, 404, { error: "not found" });
}

export function startUi(port: number): http.Server {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: (e as Error).message }));
  });
  server.listen(port, "127.0.0.1");
  return server;
}
