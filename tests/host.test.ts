import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addTaskFromInput, planOpenTickets, recordAttempt, sweepDeadRuns } from "../src/host.js";
import { loadConfig } from "../src/routing.js";
import { Store } from "../src/store.js";

function scratch(): { store: Store; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-host-"));
  return { store: new Store(root), root };
}

describe("addTaskFromInput", () => {
  it("auto-routes plain titles and records the routing", async () => {
    const { store, root } = scratch();
    const r = await addTaskFromInput(store, loadConfig(root), "write project docs", "test-host");
    expect(r.error).toBeUndefined();
    expect(r.ticket!.routedTo).toMatchObject({ tool: "gemini", auto: true, via: "rule" });
    expect(store.read().tickets).toHaveLength(1);
  });

  it("honors manual @tool:model assignment", async () => {
    const { store, root } = scratch();
    const r = await addTaskFromInput(store, loadConfig(root), "migrate db @codex:gpt-5-codex", "test-host");
    expect(r.ticket!.routedTo).toEqual({ tool: "codex", model: "gpt-5-codex", auto: false, via: "manual" });
  });

  it("rejects unknown tools and empty titles without writing", async () => {
    const { store, root } = scratch();
    expect((await addTaskFromInput(store, loadConfig(root), "x @vscode", "t")).error).toContain("unknown tool");
    expect((await addTaskFromInput(store, loadConfig(root), "   ", "t")).error).toContain("empty title");
    expect(store.read().tickets).toHaveLength(0);
  });
});

describe("failed runs", () => {
  it("reopens the ticket, drops the dead owner and leaves a trace", async () => {
    const { store, root } = scratch();
    await addTaskFromInput(store, loadConfig(root), "build the auth backend", "t");
    await store.mutate((d) => {
      d.tickets[0].status = "in_progress";
      d.tickets[0].owner = "claude-code-99";
    });

    await recordAttempt(store, "t1", "claude-code", "failed", "exited 1 without closing");
    const t = store.read().tickets[0];
    expect(t.status).toBe("open"); // retry is just running again
    expect(t.owner).toBeUndefined(); // a dead owner must not block the next claim
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts![0]).toMatchObject({ target: "claude-code", outcome: "failed" });
    expect(t.notes.at(-1)!.text).toContain("run failed on claude-code");
  });

  it("never reopens a ticket that was actually closed", async () => {
    const { store, root } = scratch();
    await addTaskFromInput(store, loadConfig(root), "write docs", "t");
    await store.mutate((d) => {
      d.tickets[0].status = "closed";
      d.tickets[0].resolution = "completed";
    });
    await recordAttempt(store, "t1", "gemini", "failed", "late exit");
    expect(store.read().tickets[0].status).toBe("closed");
  });

  it("sweep only touches tickets whose agent is gone", async () => {
    const { store, root } = scratch();
    await addTaskFromInput(store, loadConfig(root), "build the auth backend", "t");
    await addTaskFromInput(store, loadConfig(root), "write the docs", "t");
    await store.mutate((d) => {
      // t1: owner long gone. t2: owner alive right now.
      d.agents["dead-1"] = { id: "dead-1", tool: "codex", model: "", pid: 1, cwd: ".", lastSeen: new Date(Date.now() - 60 * 60_000).toISOString() };
      d.agents["live-1"] = { id: "live-1", tool: "gemini", model: "", pid: 2, cwd: ".", lastSeen: new Date().toISOString() };
      d.tickets[0].status = "in_progress";
      d.tickets[0].owner = "dead-1";
      d.tickets[1].status = "in_progress";
      d.tickets[1].owner = "live-1";
    });

    const swept = await sweepDeadRuns(store);
    expect(swept.map((s) => s.id)).toEqual(["t1"]);
    const after = store.read().tickets;
    expect(after[0].status).toBe("open");
    expect(after[1].status).toBe("in_progress"); // a working agent is left alone
    expect(swept[0].target).toBe("claude-code"); // the target it was routed to
  });
});

describe("planOpenTickets", () => {
  it("routes unrouted open tickets, persists it, and respects exclude/include", async () => {
    const { store, root } = scratch();
    const config = loadConfig(root);
    await addTaskFromInput(store, config, "build the auth backend", "t");
    await addTaskFromInput(store, config, "write a cli script", "t");
    await store.mutate((d) => {
      d.tickets[0].routedTo = undefined; // simulate an MCP-created ticket with no routing
    });

    const all = await planOpenTickets(store, config);
    expect(all).toHaveLength(2);
    expect(all[0].routedTo!.tool).toBe("claude-code");
    expect(store.read().tickets[0].routedTo!.tool).toBe("claude-code"); // persisted

    expect(await planOpenTickets(store, config, { exclude: new Set(["t1"]) })).toHaveLength(1);
    expect((await planOpenTickets(store, config, { include: ["t2"] }))[0].id).toBe("t2");
  });
});
