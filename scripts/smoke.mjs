import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-smoke-"));
const storeDir = path.join(root, ".connectr");

function makeAgent(clientName) {
  const child = spawn(process.execPath, [path.resolve("dist/server/index.js")], {
    env: { ...process.env, CONNECTR_STORE: storeDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  const pending = new Map();
  let nextId = 1;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 15_000);
    });
  async function start() {
    await send("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: clientName, version: "0.0.0" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  async function call(toolName, args) {
    const res = await send("tools/call", { name: toolName, arguments: args ?? {} });
    if (res.error) throw new Error(`rpc error: ${JSON.stringify(res.error)}`);
    return { isError: !!res.result.isError, text: res.result.content[0].text };
  }
  return { start, send, call, kill: () => child.kill() };
}

let passed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    console.error(`  FAIL ${label} ${extra}`);
    process.exitCode = 1;
  }
}

const a = makeAgent("smoke-claude");
const b = makeAgent("smoke-codex");

console.log("== Phase 3 smoke: shared brain across two live agents ==");
await a.start();
await b.start();

const tools = await a.send("tools/list", {});
check("10 tools exposed", tools.result.tools.length === 10, `got ${tools.result.tools.length}: ${tools.result.tools.map((t) => t.name).join(",")}`);

const me = JSON.parse((await a.call("whoami", { tool: "claude-code", model: "opus" })).text);
check("A registered", me.you.tool === "claude-code");

const mem = JSON.parse((await a.call("remember", { text: "auth uses refresh-token rotation", tags: ["auth"] })).text);
check("A remembered a fact", mem.remembered === "f1");

const t1 = JSON.parse((await a.call("ticket_create", { title: "implement login endpoint" })).text);
check("A created ticket t1", t1.created === "t1");

const claim = JSON.parse((await a.call("ticket_claim", { id: "t1" })).text);
check("A claimed t1", claim.claimed === "t1" && claim.status === "in_progress");

// --- second agent, fresh process ---
const meB = JSON.parse((await b.call("whoami", { tool: "codex" })).text);
check("B sees A as live peer", Array.isArray(meB.peers) && meB.peers.some((p) => p.tool === "claude-code"), JSON.stringify(meB.peers));

const rec = JSON.parse((await b.call("recall", { query: "refresh token rotation" })).text);
check(
  "B recalls A's memory cross-process",
  rec.results.length > 0 && rec.results[0].text.includes("refresh-token rotation"),
  JSON.stringify(rec)
);

const steal = await b.call("ticket_claim", { id: "t1" });
check("B refused claim on A's live ticket", steal.isError === true && steal.text.includes("owned by live agent"), steal.text);

const t2c = JSON.parse((await b.call("ticket_create", { title: "build login UI" })).text);
const t2 = JSON.parse((await b.call("ticket_claim", { id: t2c.created })).text);
check("B claims its own t2 in parallel", t2.claimed === "t2");

const fc = JSON.parse((await b.call("claim_files", { paths: ["src\\Login.tsx"] })).text);
check("B file claim recorded", Array.isArray(fc.claimed) && fc.claimed[0] === "src\\Login.tsx");

const conflict = JSON.parse((await a.call("claim_files", { paths: ["src/login.tsx"] })).text);
check("A warned of file conflict with B", conflict.conflicts.length > 0, JSON.stringify(conflict));

const ev = JSON.parse((await a.call("ticket_update", { id: "t1", note: "tests green, sha abc123" })).text);
check("A posted evidence", ev.notes === 2);

const closed = JSON.parse((await a.call("ticket_close", { id: "t1", resolution: "completed", note: "done" })).text);
check("A closed t1 completed", closed.closed === "t1" && closed.resolution === "completed");

const board = JSON.parse((await b.call("board_view", {})).text);
check(
  "board reflects full state for B",
  board.tickets.find((t) => t.id === "t1")?.status === "closed" &&
    board.tickets.find((t) => t.id === "t2")?.owner?.startsWith("codex"),
  JSON.stringify(board)
);

a.kill();
b.kill();

console.log(`\n${passed} checks passed${process.exitCode === 1 ? " (WITH FAILURES)" : ""}`);
process.exit(process.exitCode ?? 0);
