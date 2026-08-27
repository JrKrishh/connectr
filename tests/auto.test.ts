import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { startUi } from "../src/ui/server.js";
import { Store } from "../src/store.js";

// Auto-continue exercised end to end against a fake tool: `node sleeper.cjs` lives for
// 300ms and exits without closing its ticket, which is exactly what a dead agent looks
// like. Nothing here launches a real coding CLI.

let server: http.Server;
let base = "";
let root = "";
let prevStore: string | undefined;
let prevTick: string | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  prevStore = process.env.CONNECTR_STORE;
  prevTick = process.env.CONNECTR_AUTO_TICK;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-auto-"));
  process.env.CONNECTR_STORE = path.join(root, ".connectr");
  process.env.CONNECTR_AUTO_TICK = "250";

  const sleeper = path.join(root, "sleeper.cjs");
  fs.writeFileSync(sleeper, "setTimeout(function(){process.exit(0)},300);\n");
  const longSleeper = path.join(root, "long-sleeper.cjs");
  fs.writeFileSync(longSleeper, "setTimeout(function(){process.exit(0)},60000);\n");
  fs.mkdirSync(path.join(root, ".connectr"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".connectr", "config.json"),
    JSON.stringify(
      {
        routing: { rules: [], defaultTool: "claude-code" },
        permissionMode: "auto",
        isolation: "off",
        autoContinue: true,
        tools: [
          { id: "fake", kind: "dispatch", bin: "node", args: [sleeper], prompt: "stdin", modes: { safe: [], auto: [], yolo: [] } },
          { id: "ghost", kind: "dispatch", bin: "connectr-no-such-binary-xyz", args: ["{prompt}"], prompt: "stdin", modes: { safe: [], auto: [], yolo: [] } },
        ],
      },
      null,
      2
    )
  );

  server = startUi(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (prevStore === undefined) delete process.env.CONNECTR_STORE;
  else process.env.CONNECTR_STORE = prevStore;
  if (prevTick === undefined) delete process.env.CONNECTR_AUTO_TICK;
  else process.env.CONNECTR_AUTO_TICK = prevTick;
  await new Promise<void>((r) => server.close(() => r()));
});

async function addTask(input: string): Promise<string> {
  const res = await fetch(base + "/api/task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).ticket.id;
}

describe("auto-continue", () => {
  it("launches a queued ticket on its own, retries once, then leaves it for the human", async () => {
    const id = await addTask("exercise the auto loop @fake");

    // Two runs, each: tick (<=250ms) + 300ms child + reconcile. Poll until both failures land.
    const deadline = Date.now() + 20_000;
    let fails = 0;
    while (Date.now() < deadline) {
      const t = new Store().read().tickets.find((x) => x.id === id)!;
      fails = (t.attempts ?? []).filter((a) => a.outcome === "failed").length;
      if (fails >= 2) break;
      await sleep(200);
    }
    expect(fails).toBe(2);

    const t = new Store().read().tickets.find((x) => x.id === id)!;
    expect(t.status).toBe("open"); // reopened, not stuck in_progress
    expect(t.notes.some((n) => n.text.includes("auto-continue is leaving this one"))).toBe(true);

    // Parked for good: the retry cap holds even with the loop still ticking.
    await sleep(1200);
    const after = new Store().read().tickets.find((x) => x.id === id)!;
    expect((after.attempts ?? []).filter((a) => a.outcome === "failed").length).toBe(2);

    // Both runs actually happened and wrote logs.
    const runs = fs.readdirSync(path.join(process.env.CONNECTR_STORE!, "runs")).filter((f) => f.startsWith(`${id}-`));
    expect(runs.length).toBe(2);
  }, 30_000);

  it("parks a ticket routed to a missing tool instead of relaunching it forever", async () => {
    await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoContinue: true }),
    });
    const id = await addTask("build the thing @ghost");

    // The tool doesn't exist, so no child ever spawns (ok:false). Poll until the retry cap.
    const deadline = Date.now() + 15_000;
    let fails = 0;
    while (Date.now() < deadline) {
      fails = (new Store().read().tickets.find((x) => x.id === id)!.attempts ?? []).filter(
        (a) => a.outcome === "failed"
      ).length;
      if (fails >= 2) break;
      await sleep(150);
    }
    expect(fails).toBe(2);

    // The whole point: it stops at the cap, it does not spam a log file every tick.
    await sleep(1500);
    const t = new Store().read().tickets.find((x) => x.id === id)!;
    expect((t.attempts ?? []).filter((a) => a.outcome === "failed").length).toBe(2);
    expect(t.status).toBe("open");
    expect(t.notes.some((n) => n.text.includes("auto-continue is leaving this one"))).toBe(true);
    const runs = fs.readdirSync(path.join(process.env.CONNECTR_STORE!, "runs")).filter((f) => f.startsWith(`${id}-`));
    expect(runs.length).toBeLessThanOrEqual(2);
  }, 25_000);

  it("stops a running agent, kills its process, and does not count it as a routing loss", async () => {
    const alive = (p: number) => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    };
    await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoContinue: false }),
    });
    const id = await addTask("long job to interrupt @fake");
    // Stand in for a live dispatched run with a real long-lived process. (The dashboard's
    // own detached launch shapes have a separate Windows problem; stopRun itself is
    // platform-independent - it kills a pid and mutates the ticket - so it is tested directly.)
    const { spawn } = await import("node:child_process");
    const longSleeper = path.join(root, "long-sleeper.cjs");
    const proc = spawn(process.execPath, [longSleeper], { detached: true, stdio: "ignore" });
    proc.unref();
    const pid = proc.pid!;
    await new Store().mutate((d) => {
      const t = d.tickets.find((x) => x.id === id)!;
      t.status = "in_progress";
      t.owner = "a1";
      t.run = { pid, startedAt: new Date().toISOString(), logFile: "x.log" };
    });
    expect(alive(pid)).toBe(true);
    expect((await (await fetch(base + "/api/state")).json()).tickets.find((t: { id: string }) => t.id === id).running).toBe(true);

    const res = await fetch(base + "/api/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: id }),
    });
    expect(res.status).toBe(200);

    const d2 = Date.now() + 10_000;
    while (Date.now() < d2 && alive(pid)) await sleep(150);
    expect(alive(pid)).toBe(false); // process actually killed

    const t = new Store().read().tickets.find((x) => x.id === id)!;
    expect(t.status).toBe("open"); // back on the board
    expect(t.run).toBeUndefined();
    expect((t.attempts ?? []).filter((a) => a.outcome === "failed")).toHaveLength(0); // NOT a routing loss
    expect(t.notes.some((n) => n.text.includes("stopped by you"))).toBe(true);
  }, 30_000);

  it("sweeps a run whose process is dead by pid, without waiting for the MCP window", async () => {
    const id = await addTask("orphaned by a host crash @fake");
    const store = new Store();
    await store.mutate((data) => {
      const t = data.tickets.find((x) => x.id === id)!;
      t.status = "in_progress";
      t.owner = "host-that-died";
      t.run = { pid: 2147480000, startedAt: new Date().toISOString(), logFile: "x.log" }; // a pid that isn't alive
    });
    const swept = await (await fetch(base + "/api/sweep", { method: "POST" })).json();
    expect(swept.swept.map((s: { id: string }) => s.id)).toContain(id);
    const t = new Store().read().tickets.find((x) => x.id === id)!;
    expect(t.status).toBe("open");
    expect(t.run).toBeUndefined();
    expect((t.attempts ?? []).some((a) => a.outcome === "failed" && a.detail === "agent gone")).toBe(true);
  }, 15_000);

  it("launches nothing once auto-continue is switched off", async () => {
    const res = await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoContinue: false }),
    });
    expect((await res.json()).autoContinue).toBe(false);

    const id = await addTask("this one waits for the human @fake");
    await sleep(1200); // several ticks worth
    const t = new Store().read().tickets.find((x) => x.id === id)!;
    expect(t.status).toBe("open");
    expect(t.attempts ?? []).toHaveLength(0);
  }, 15_000);
});
