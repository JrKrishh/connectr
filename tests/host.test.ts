import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addTaskFromInput, planOpenTickets } from "../src/host.js";
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
