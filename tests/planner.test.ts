import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planIntent } from "../src/host.js";
import { plannerTicket, plannerTitle } from "../src/planner.js";
import { loadConfig, saveConfig } from "../src/routing.js";
import { Store } from "../src/store.js";

function scratch(): { store: Store; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-plan-"));
  return { store: new Store(root), root };
}

describe("plannerTitle", () => {
  it("keeps short intents whole and collapses whitespace", () => {
    expect(plannerTitle("  add   JWT auth\n")).toBe("Plan: add JWT auth");
  });

  it("truncates long intents so the board stays readable", () => {
    const title = plannerTitle("x".repeat(200));
    expect(title.length).toBeLessThanOrEqual("Plan: ".length + 72);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("plannerTicket", () => {
  const intent = "add user auth with JWT, tests, and update the docs";

  it("carries the intent and forbids building", () => {
    const t = plannerTicket(intent);
    expect(t.desc).toContain(intent);
    expect(t.desc).toContain("Do NOT write code");
    expect(t.desc).toContain("only produces other tickets");
  });

  it("teaches the title convention routing depends on", () => {
    const desc = plannerTicket(intent).desc;
    expect(desc).toContain("routing reads the title first");
    for (const kind of ["backend/api:", "cli/script:", "docs:"]) expect(desc).toContain(kind);
  });

  it("asks for contracts, parallel-safe tickets and no duplicates", () => {
    const desc = plannerTicket(intent).desc;
    expect(desc).toContain("contract:");
    expect(desc).toContain("in parallel");
    expect(desc).toContain("never create a ticket for something already closed");
  });

  it("references the project brief only when there is one", () => {
    expect(plannerTicket(intent, { planFile: "PLAN.md" }).desc).toContain("Read PLAN.md");
    expect(plannerTicket(intent).desc).not.toContain("Read PLAN.md");
  });

  it("numbers its steps continuously with and without a brief", () => {
    const withPlan = plannerTicket(intent, { planFile: "PLAN.md" }).desc;
    const without = plannerTicket(intent).desc;
    for (const n of ["1.", "2.", "3.", "4.", "5.", "6."]) expect(withPlan).toContain(n);
    for (const n of ["1.", "2.", "3.", "4.", "5."]) expect(without).toContain(n);
    expect(without).not.toContain("6.");
  });
});

describe("planIntent", () => {
  it("parks the intent as a planner ticket routed to the reasoning tool", async () => {
    const { store, root } = scratch();
    const result = await planIntent(store, loadConfig(root), "add JWT auth and docs", "test-host");
    expect(result.error).toBeUndefined();
    const ticket = result.ticket!;
    expect(ticket.title).toBe("Plan: add JWT auth and docs");
    // Not routed by keyword: "docs" would otherwise pull this to gemini.
    expect(ticket.routedTo).toMatchObject({ tool: "claude-code", auto: true, via: "default" });
    expect(store.read().tickets).toHaveLength(1);
  });

  it("honours an explicit planner tool and the project's default", async () => {
    const { store, root } = scratch();
    const config = loadConfig(root);
    expect((await planIntent(store, config, "x", "t", { tool: "codex" })).ticket!.routedTo).toMatchObject({
      tool: "codex",
      auto: false,
      via: "manual",
    });
    config.routing.defaultTool = "gemini";
    saveConfig(root, config);
    expect((await planIntent(store, loadConfig(root), "y", "t")).ticket!.routedTo!.tool).toBe("gemini");
  });

  it("refuses an empty request without writing", async () => {
    const { store, root } = scratch();
    expect((await planIntent(store, loadConfig(root), "   ", "t")).error).toContain("empty");
    expect(store.read().tickets).toHaveLength(0);
  });
});
