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
    expect(categoryOf("write the readme docs", "", config).ruleTool).toBe("gemini");
    expect(categoryOf("mysterious chore", "", config)).toEqual({ category: "default", ruleTool: "claude-code" });
  });

  it("weights the title over the description (regression: the real t2 misroute)", () => {
    // Verbatim shape of the ticket that misrouted: an explicit cli/script title whose
    // description name-drops backend words, which used to win on first-match.
    const title = "cli/script: project scaffold - package.json, npm start / npm run dist, electron-builder";
    const desc =
      "Create the package.json and scripts. The dashboard server child is spawned later by src/server.js; " +
      "the api surface and database of projects live in the registry module.";
    expect(categoryOf(title, desc, config).ruleTool).toBe("codex");
    expect(categoryOf(title, "", config).ruleTool).toBe("codex");
  });

  it("the best-supported rule wins, so a passing mention cannot hijack the subject", () => {
    // Regression: "build" belongs to the codex rule and appears in this docs title, but
    // "docs" + "readme" is stronger evidence, so the docs rule must win.
    expect(categoryOf("docs: README with run, build and troubleshooting instructions", "", config).ruleTool).toBe("gemini");
    // ...and a genuine build-tooling title still goes to codex.
    expect(categoryOf("write the release build script", "", config).ruleTool).toBe("codex");
  });

  it("still uses the description when the title matches no rule", () => {
    expect(categoryOf("phase two", "write the user docs and a readme", config).ruleTool).toBe("gemini");
    expect(categoryOf("phase two", "nothing categorical here", config).ruleTool).toBe("claude-code");
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

  it("does not override while the rule's own tool has never been tried in the category", () => {
    // Every docs ticket was worked by claude-code, but gemini (the rule tool) never ran here,
    // so there is no evidence gemini is worse - the rule must stand so it gets a chance.
    const d = data([
      closedTicket("t1", "write the guide docs", "claude-code-11"),
      closedTicket("t2", "update the readme", "claude-code-11"),
      closedTicket("t3", "write user docs", "claude-code-11"),
    ]);
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.evidence).toBeGreaterThanOrEqual(MIN_EVIDENCE);
    expect(c.stats["gemini"]).toBeUndefined();
    expect(c.learned).toBe(false);
    expect(c.pick).toBe("gemini");
    expect(c.reason).toContain("untried");
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

describe("model-level learning", () => {
  // Agents report their model through whoami; the store carries it on the agent record.
  function withModels(tickets: Ticket[], agents: Record<string, string>): StoreData {
    const d = data(tickets);
    for (const [id, model] of Object.entries(agents)) {
      d.agents[id] = { id, tool: id.split("-").slice(0, -1).join("-"), model, pid: 1, cwd: ".", lastSeen: new Date().toISOString() };
    }
    return d;
  }

  it("credits the model that finished the work, not just the tool", () => {
    const d = withModels([closedTicket("t1", "write the guide docs", "claude-code-11")], { "claude-code-11": "opus" });
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.stats["claude-code:opus"].wins).toBe(1);
    expect(c.stats["claude-code"]).toBeUndefined();
  });

  it("routes to a specific model once one proves itself in a category", () => {
    const d = withModels(
      [
        closedTicket("t1", "write the guide docs", "gemini-1"),
        closedTicket("t2", "update the readme", "gemini-2"),
        closedTicket("t3", "write user docs", "gemini-2"),
        closedTicket("t4", "more docs", "gemini-2"),
      ],
      { "gemini-1": "gemini-2.5-flash", "gemini-2": "gemini-2.5-pro" }
    );
    const smart = resolveToolSmart("write the user guide docs", "", d, config);
    expect(smart.tool).toBe("gemini");
    expect(smart.model).toBe("gemini-2.5-pro"); // same tool, model chosen from evidence
    expect(smart.via).toBe("learned");
    expect(smart.reason).toContain("strongest gemini");
  });

  it("counts a model-level routing miss as a loss for the model that was asked", () => {
    const d = withModels(
      [closedTicket("t1", "write docs", "gemini-2", { routedTo: { tool: "gemini", model: "gemini-2.5-flash", auto: true } })],
      { "gemini-2": "gemini-2.5-pro" }
    );
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.stats["gemini:gemini-2.5-pro"].wins).toBe(1);
    expect(c.stats["gemini:gemini-2.5-flash"].losses).toBe(1);
  });

  it("treats the rule's tool as tried when any of its models has run", () => {
    // gemini only ever ran as a model variant; that still counts as gemini being tried,
    // so a genuinely stronger other tool is allowed to take the category.
    const d = withModels(
      [
        closedTicket("t1", "write the guide docs", "claude-code-11"),
        closedTicket("t2", "update the readme", "claude-code-11"),
        closedTicket("t3", "write user docs", "claude-code-11"),
        closedTicket("t4", "docs again", "gemini-1"),
        closedTicket("t5", "more docs", "gemini-1", { resolution: "wontfix" }),
      ],
      { "claude-code-11": "", "gemini-1": "gemini-2.5-flash" }
    );
    const c = learnRoutes(d, config).get(DOCS_RULE)!;
    expect(c.stats["gemini:gemini-2.5-flash"]).toBeDefined();
    expect(c.learned).toBe(true);
    expect(c.pick).toBe("claude-code");
  });
});

describe("resolveToolSmart", () => {
  it("routes by learned override when evidence exists, else by rule", () => {
    const learned = data([
      closedTicket("t1", "write the guide docs", "claude-code-11"),
      closedTicket("t2", "update the readme", "claude-code-11"),
      closedTicket("t3", "write user docs", "claude-code-11", { routedTo: { tool: "gemini", auto: true } }),
    ]);
    const smart = resolveToolSmart("summarize the research docs", "", learned, config);
    expect(smart.tool).toBe("claude-code");
    expect(smart.via).toBe("learned");
    expect(smart.reason).toContain("beats gemini");

    const fresh = resolveToolSmart("summarize the research docs", "", data([]), config);
    expect(fresh).toMatchObject({ tool: "gemini", via: "rule" });
    expect(resolveToolSmart("mysterious chore", "", data([]), config).via).toBe("default");
  });
});
