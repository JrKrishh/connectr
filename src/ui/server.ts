import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { addTaskFromInput, launchPlanned, planIntent, planOpenTickets, recordAttempt, sweepDeadRuns, type LaunchSummary } from "../host.js";
import type { Ticket } from "../types.js";
import { diffWorktree, listWorktrees, mergeWorktree, type TreeStatus } from "../worktree.js";
import { factKind } from "../memory.js";
import { PERMISSION_MODES, loadConfig, saveConfig, type PermissionMode } from "../routing.js";
import { MODE_INFO, toolRegistry } from "../tools.js";
import { Store, liveAgentIds } from "../store.js";
import { UI_HTML } from "./page.js";

const dispatched = new Set<string>();

// Auto-continue: after this many failed runs a ticket is left for the human. Without a
// cap the loop would relaunch a doomed ticket forever.
const MAX_AUTO_ATTEMPTS = 2;

/**
 * The moment one of our launched agents exits, settle the run: an unclosed ticket is a
 * failed attempt (recorded, reopened, counted as a routing loss) - the same contract
 * `connectr run` applies, but for the detached children this host launches.
 */
async function recordFailure(id: string, target: string, detail: string): Promise<void> {
  const store = new Store();
  await recordAttempt(store, id, target, "failed", detail);
  dispatched.delete(id); // eligible again - routing now knows about the loss
  const fails = (store.read().tickets.find((x) => x.id === id)?.attempts ?? []).filter(
    (a) => a.outcome === "failed"
  ).length;
  if (fails >= MAX_AUTO_ATTEMPTS && loadConfig(projectRoot()).autoContinue) {
    await store.mutate((d) => {
      const t = d.tickets.find((x) => x.id === id);
      t?.notes.push({
        agent: "connectr",
        text: `${fails} runs have failed - auto-continue is leaving this one for you; press Launch to retry it`,
        ts: new Date().toISOString(),
      });
    });
  }
}

async function reconcile(ticket: Ticket, code: number | null): Promise<void> {
  const fresh = new Store().read().tickets.find((x) => x.id === ticket.id);
  const rt = ticket.routedTo!;
  const target = rt.model ? `${rt.tool}:${rt.model}` : rt.tool;
  if (fresh && fresh.status !== "closed") {
    await recordFailure(ticket.id, target, `exited ${code ?? "?"} without closing`);
  } else {
    await recordAttempt(new Store(), ticket.id, target, "completed");
  }
}

/**
 * A launch that produced no child (the routed tool isn't installed) must be booked as a
 * failed attempt too - otherwise the auto tick, which excludes only tickets already in
 * `dispatched` or past the retry cap, would relaunch it every few seconds forever, one new
 * log file each time, and never park it.
 */
async function settleLaunches(launches: LaunchSummary[]): Promise<void> {
  for (const l of launches) {
    if (l.ok) dispatched.add(l.id);
    else await recordFailure(l.id, l.model ? `${l.tool}:${l.model}` : l.tool, "tool not available to launch");
  }
}

let autoBusy = false;
async function autoTick(): Promise<void> {
  if (autoBusy) return;
  autoBusy = true;
  try {
    const config = loadConfig(projectRoot());
    if (!config.autoContinue) return;
    const store = new Store();
    const plan = (await planOpenTickets(store, config, { exclude: dispatched })).filter(
      (t) => (t.attempts ?? []).filter((a) => a.outcome === "failed").length < MAX_AUTO_ATTEMPTS
    );
    if (!plan.length) return;
    const launches = launchPlanned(plan, process.cwd(), store.dir, config, true, reconcile);
    await settleLaunches(launches);
  } catch {
    /* a bad tick must not kill the interval */
  } finally {
    autoBusy = false;
  }
}

// Config belongs to the project the store belongs to. Reading it from process.cwd()
// instead silently split the two apart whenever CONNECTR_STORE pointed elsewhere - the
// board went to one project while its permission mode was read from, and written to,
// whichever directory the server happened to be launched in.
function projectRoot(): string {
  return path.dirname(new Store().dir);
}

// Tree status shells out to git per worktree; at the SSE cadence of once a second that
// would be a constant git storm, so it is cached briefly. 3s staleness is invisible next
// to how long an agent run takes.
let treeCache: { at: number; trees: TreeStatus[] } = { at: 0, trees: [] };
function treeStatuses(): TreeStatus[] {
  const now = Date.now();
  if (now - treeCache.at > 3000) {
    const store = new Store();
    treeCache = { at: now, trees: listWorktrees(projectRoot(), store.dir) };
  }
  return treeCache.trees;
}

const TICKET_ID = /^t\d+$/;

function stateView(): unknown {
  const store = new Store();
  const config = loadConfig(projectRoot());
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
  const trees = treeStatuses();
  return {
    project: path.basename(process.cwd()),
    cwd: process.cwd(),
    mode: config.permissionMode,
    autoContinue: config.autoContinue === true,
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
      tree: (() => {
        const w = trees.find((x) => x.ticket === t.id);
        return w ? { commits: w.commits, dirty: w.dirty } : null;
      })(),
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

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The dashboard binds to loopback but the user's own browser can still reach it, so a page
 * on any site can fire requests at it. Two checks close that:
 *  - Host must be loopback. A DNS-rebinding attack points its domain at 127.0.0.1 but the
 *    browser still sends Host: attacker.com, so this rejects it.
 *  - A state-changing request that carries an Origin must be same-origin. A cross-site
 *    fetch always sends the attacker's Origin (even text/plain, which skips preflight), so
 *    it fails the match; our own page sends our origin. A request with no Origin is a
 *    non-browser client (the desktop main process posts /api/plan this way, curl, tests) -
 *    not a CSRF vector, since an attacker cannot make a victim's browser omit Origin.
 */
function originGuard(req: http.IncomingMessage): string | null {
  const host = req.headers.host ?? "";
  const hostname = host.replace(/:\d+$/, "");
  if (host && !LOOPBACK.has(hostname)) return "host not allowed";
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return "cross-origin request refused";
  }
  return null;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const denied = originGuard(req);
  if (denied) {
    json(res, 403, { error: denied });
    return;
  }
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
  if (req.method === "GET" && url.pathname === "/api/log/stream") {
    const file = path.basename(url.searchParams.get("file") ?? ""); // basename kills traversal
    const full = path.join(new Store().dir, "runs", file);
    if (!file.endsWith(".log") || !fs.existsSync(full)) {
      json(res, 404, { error: "log not found" });
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Start from a tail rather than the whole file, then send only what gets appended.
    let pos = Math.max(0, fs.statSync(full).size - 16_000);
    const push = (): void => {
      let size: number;
      try {
        size = fs.statSync(full).size;
      } catch {
        return; // file went away; the heartbeat will keep the stream open
      }
      if (size < pos) pos = 0; // truncated or replaced
      if (size === pos) return;
      const fd = fs.openSync(full, "r");
      const buf = Buffer.alloc(size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      pos = size;
      res.write(`data: ${JSON.stringify({ chunk: buf.toString("utf8") })}\n\n`);
    };
    push();
    // fs.watch is the fast path; on Windows it can miss events, so a slow interval
    // guarantees the stream still converges.
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(full, () => push());
    } catch {
      /* fall back to the interval alone */
    }
    const timer = setInterval(push, 1000);
    const beat = setInterval(() => res.write(": beat\n\n"), 15_000);
    req.on("close", () => {
      watcher?.close();
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
    const result = await addTaskFromInput(new Store(), loadConfig(projectRoot()), String(body.input ?? ""), "web-host");
    json(res, result.error ? 400 : 200, result);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/diff") {
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!TICKET_ID.test(ticket)) {
      json(res, 400, { error: "ticket must look like t3" });
      return;
    }
    const d = diffWorktree(projectRoot(), ticket);
    json(res, d.ok ? 200 : 404, d);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/merge") {
    const body = await readBody(req);
    const ticket = String(body.ticket ?? "");
    if (!TICKET_ID.test(ticket)) {
      json(res, 400, { error: "ticket must look like t3" });
      return;
    }
    const result = mergeWorktree(projectRoot(), new Store().dir, ticket, { remove: true });
    treeCache.at = 0; // the banner must disappear on the next state push, not in 3s
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sweep") {
    const swept = await sweepDeadRuns(new Store());
    json(res, 200, { swept });
    return;
  }
  if (url.pathname === "/api/settings" && (req.method === "GET" || req.method === "POST")) {
    const config = loadConfig(projectRoot());
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body.permissionMode !== undefined) {
        const mode = String(body.permissionMode);
        if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
          json(res, 400, { error: `unknown mode '${mode}' - use safe, auto or yolo` });
          return;
        }
        config.permissionMode = mode as PermissionMode;
      }
      if (body.autoContinue !== undefined) config.autoContinue = body.autoContinue === true;
      saveConfig(projectRoot(), config);
    }
    // Show what the chosen mode actually does to every tool that can be dispatched -
    // a mode is only meaningful if you can see the flags it hands each one.
    const dispatchTools = toolRegistry(config.toolSpecs).filter((t) => t.kind === "dispatch");
    json(res, 200, {
      permissionMode: config.permissionMode,
      autoContinue: config.autoContinue === true,
      modes: MODE_INFO,
      tools: dispatchTools.map((t) => ({
        tool: t.id,
        flags: {
          safe: t.modes?.safe ?? [],
          auto: t.modes?.auto ?? [],
          yolo: t.modes?.yolo ?? [],
        },
      })),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/plan") {
    const body = await readBody(req);
    const store = new Store();
    const config = loadConfig(projectRoot());
    const result = await planIntent(store, config, String(body.intent ?? ""), "web-host");
    if (result.error) {
      json(res, 400, result);
      return;
    }
    // Planning is a normal dispatch: the planner ticket goes out detached and the board
    // shows it working, so the page needs no special "thinking" state.
    const [launch] = launchPlanned([result.ticket!], process.cwd(), store.dir, config, true, reconcile);
    await settleLaunches([launch]);
    json(res, 200, { ticket: result.ticket, launch });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/dispatch") {
    const body = await readBody(req);
    const store = new Store();
    const config = loadConfig(projectRoot());
    const plan = await planOpenTickets(store, config, { exclude: dispatched });
    if (body.dry) {
      json(res, 200, {
        mode: config.permissionMode,
        plan: plan.map((t) => ({ id: t.id, title: t.title, tool: t.routedTo!.tool, model: t.routedTo!.model ?? null })),
      });
      return;
    }
    const launches = launchPlanned(plan, process.cwd(), store.dir, config, true, reconcile);
    await settleLaunches(launches);
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
  const auto = setInterval(autoTick, Number(process.env.CONNECTR_AUTO_TICK ?? 5000));
  server.on("close", () => clearInterval(auto));
  return server;
}
