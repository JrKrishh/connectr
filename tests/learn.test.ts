import { describe, expect, it } from "vitest";
import { MIN_EVIDENCE, agentTool, categoryOf, learnRoutes, resolveToolSmart } from "../src/learn.js";
import { DEFAULT_RULES, loadConfig } from "../src/routing.js";
import type { StoreData, Ticket, TicketNote } from "../src/types.js";

const config = loadConfig("Z:\\nonexistent-learn-test");
const DOCS_RULE = DEFAULT_RULES.find((r) => r.tool === "gemini")!.match;

function note(agent: string, text: string): TicketNote {
  return { agent, text, ts: new Date().toISOString() };
}

function closedTicket(id: string, title: string, owner: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id,
    title,
    desc: "",
    status: "closed",
    resolution: "completed",
    owner,
    notes: [],
    createdBy: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function data(tickets: Ticket[]): StoreData {
  return {
    version: 1,
    agents: {
      "claude-code-11": { id: "claude-code-11", tool: "claude-code", model: "", pid: 1, cwd: ".", lastSeen: new Date().toISOString() },
    },
    facts: [],
    tickets,
    claims: [],
  };
}

describe("categoryOf / agentTool", () => {
  it("maps text to the first matching rule and falls back to default", () => {
    expect(categoryOf("write the readme docs", config).ruleTool).toBe("gemini");
    expect(categoryOf("mysterious chore", config)).toEqual({ category: "default", ruleTool: "claude-code" });
  });

  it("resolves an agent's tool from the registry, else the id prefix", () => {
    const d = data([]);
    expect(agentTool(d, "claude-code-11")).toBe("claude-code");
    expect(agentTool(d, "codex-8436")).toBe("codex"); // not registered - prefix
    expect(agentTool(d, "claude-code")).toBe("claude-code"); // no pid suffix
  });
});

describe("learnRoutes", () => {
  it("overrides the rule tool when another tool keeps winning the category", () => {
    const d = data([
      closedTicket("t1", "write the guide docs", "claude-code-11"),
      closedTicket("t2", "update the readme", "claude-code-11"),
      closedTicket("t3", "write user docs", "claude-code-11", {
        notes: [note("claude-code-11", "takeover from 'gemini-99' (not seen in >10m)")],
      }),
    ]);
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.ruleTool).toBe("gemini");
    expect(c.stats["claude-code"].wins).toBe(3);
    expect(c.stats["gemini"].losses).toBe(1);
    expect(c.learned).toBe(true);
    expect(c.pick).toBe("claude-code");
  });

  it("does not override below the evidence threshold", () => {
    const d = data([closedTicket("t1", "write the guide docs", "claude-code-11")]);
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.evidence).toBeLessThan(MIN_EVIDENCE);
    expect(c.learned).toBe(false);
    expect(c.pick).toBe("gemini");
  });

  it("counts a routing miss as a loss for the intended tool", () => {
    const d = data([
      closedTicket("t1", "write docs", "claude-code-11", { routedTo: { tool: "gemini", auto: true } }),
    ]);
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.stats["gemini"].losses).toBe(1);
    expect(c.stats["claude-code"].wins).toBe(1);
  });

  it("ignores non-completed closes and open tickets", () => {
    const d = data([
      closedTicket("t1", "write docs", "codex-1", { resolution: "wontfix" }),
      closedTicket("t2", "write docs", "codex-1", { status: "open", resolution: undefined }),
    ]);
    expect(learnRoutes(d, config).get(DOCS_RULE)).toBeUndefined();
  });
});

describe("resolveToolSmart", () => {
  it("routes by learned override when evidence exists, else by rule", () => {
    const learned = data([
      closedTicket("t1", "write the guide docs", "claude-code-11"),
      closedTicket("t2", "update the readme", "claude-code-11"),
      closedTicket("t3", "write user docs", "claude-code-11", { routedTo: { tool: "gemini", auto: true } }),
    ]);
    const smart = resolveToolSmart("summarize the research docs", learned, config);
    expect(smart.tool).toBe("claude-code");
    expect(smart.via).toBe("learned");
    expect(smart.reason).toContain("outperforms gemini");

    const fresh = resolveToolSmart("summarize the research docs", data([]), config);
    expect(fresh).toMatchObject({ tool: "gemini", via: "rule" });
    expect(resolveToolSmart("mysterious chore", data([]), config).via).toBe("default");
  });
});
