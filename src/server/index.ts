import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AGENT_LIVE_MS,
  CLAIM_TTL_MS,
  Store,
  activeClaims,
  claimConflicts,
  liveAgentIds,
  nextId,
} from "../store.js";
import { factKind, findDuplicate, recentLessons, searchFacts } from "../memory.js";
import type { Resolution, StoreData, Ticket, TicketStatus } from "../types.js";

function nowISO(): string {
  return new Date().toISOString();
}

const store = new Store();

const session = {
  agentId: process.env.CONNECTR_AGENT ?? "",
  tool: process.env.CONNECTR_TOOL ?? "",
  model: process.env.CONNECTR_MODEL ?? "",
};

const PROTOCOL_INSTRUCTIONS = [
  "ConnectR is the shared brain for multiple AI coding agents working in this repository.",
  "Protocol: (1) Call whoami once at session start. (2) Call recall before assuming context; call remember for durable decisions and facts other agents must know. (3) Never start work without a ticket: ticket_create, then ticket_claim - claim-before-build prevents duplicate work. (4) Post evidence (test output, commit SHAs, file paths) via ticket_update as you go. (5) Finish with ticket_close including a resolution type. (6) Before editing files another agent might touch, claim_files them; release_files when done.",
  "Lessons: when something fails - a command errors, a test breaks, an assumption proves wrong - store it with remember kind='lesson' (what happened + root cause in text, corrective action in fix). Before retrying a failure or starting risky work, recall kind='lesson' so no agent repeats a mistake another already paid for.",
].join(" ");

const server = new McpServer({ name: "connectr", version: "0.1.0" }, { instructions: PROTOCOL_INSTRUCTIONS });

function clientName(): string {
  try {
    return server.server.getClientVersion()?.name ?? "";
  } catch {
    return "";
  }
}

function callerId(): string {
  return session.agentId || clientName() || `anon-${process.pid}`;
}

function touch(d: StoreData): string {
  const id = callerId();
  const prev = d.agents[id];
  d.agents[id] = {
    id,
    tool: session.tool || prev?.tool || clientName() || "unknown",
    model: session.model || prev?.model || "",
    pid: process.pid,
    cwd: process.cwd(),
    lastSeen: nowISO(),
  };
  return id;
}

function note(d: StoreData, t: Ticket, text: string): void {
  t.notes.push({ agent: callerId(), text, ts: nowISO() });
  t.updatedAt = nowISO();
}

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

server.registerTool(
  "whoami",
  {
    title: "Register identity",
    description:
      "Register this agent's identity (call once when your session starts). Returns you, the other agents currently live on this repo, open tickets and active file claims.",
    inputSchema: {
      tool: z.string().describe("Which coding tool you are, e.g. claude-code, codex, cursor, kiro, gemini-cli, antigravity"),
      model: z.string().optional().describe("Model id if known, e.g. claude-opus-4-5"),
    },
  },
  async ({ tool, model }) => {
    session.agentId = `${tool}-${process.pid}`;
    session.tool = tool;
    if (model) session.model = model;
    const summary = await store.mutate((d) => {
      const me = touch(d);
      return {
        you: d.agents[me],
        peers: liveAgentIds(d).filter((id) => id !== me).map((id) => d.agents[id]),
        openTickets: d.tickets.filter((t) => t.status !== "closed").length,
        activeClaims: activeClaims(d).length,
        factCount: d.facts.length,
        recentLessons: recentLessons(d.facts).map((f) => ({ id: f.id, text: f.text, fix: f.fix })),
      };
    });
    return ok(summary);
  }
);

server.registerTool(
  "remember",
  {
    title: "Remember a fact",
    description:
      'Store a durable fact, decision or lesson in shared memory for all agents. kind="fact" for conventions/environment facts, kind="decision" for choices made ("auth uses refresh-token rotation"), kind="lesson" for mistakes paid for - put what happened + root cause in text and the corrective action in fix. Keep each entry one self-contained sentence; near-duplicates are rejected with the existing entry.',
    inputSchema: {
      text: z.string().min(1).describe("The fact, one self-contained sentence (for lessons: what happened + root cause)"),
      kind: z.enum(["fact", "decision", "lesson"]).default("fact").describe("What kind of memory this is"),
      fix: z.string().optional().describe("Lessons only: the corrective action, e.g. 'use X instead of Y'"),
      tags: z.array(z.string()).default([]).describe("Short topic tags, e.g. ['auth','database']"),
    },
  },
  async ({ text, kind, fix, tags }) => {
    const result = await store.mutate((d) => {
      touch(d);
      const dup = findDuplicate(d.facts, text);
      if (dup) return { dup, fact: null as never, total: d.facts.length };
      const f = { id: nextId("f", d.facts), kind, text, fix, tags, agent: callerId(), ts: nowISO() };
      d.facts.push(f);
      return { dup: null, fact: f, total: d.facts.length };
    });
    if (result.dup) {
      const d = result.dup;
      return ok({
        duplicate: true,
        existing: { id: d.id, kind: factKind(d), text: d.text, fix: d.fix, by: d.agent, ts: d.ts },
        hint: "already in shared memory - nothing stored; update tags/fix by remembering a materially different sentence",
      });
    }
    return ok({ remembered: result.fact.id, kind, totalFacts: result.total });
  }
);

server.registerTool(
  "recall",
  {
    title: "Recall facts",
    description:
      "Search shared memory for facts, decisions and lessons other agents stored. Call before assuming context or repeating solved work; recall kind='lesson' before retrying a failure or starting risky work.",
    inputSchema: {
      query: z.string().describe("Keywords, e.g. 'refresh token rotation'"),
      kind: z.enum(["fact", "decision", "lesson"]).optional().describe("Only return this kind of memory"),
    },
  },
  async ({ query, kind }) => {
    await store.mutate((d) => {
      touch(d);
    });
    const scored = searchFacts(store.read().facts, query, kind);
    return ok({
      results: scored.map(({ f, score }) => ({
        id: f.id,
        kind: factKind(f),
        text: f.text,
        ...(f.fix ? { fix: f.fix } : {}),
        tags: f.tags,
        by: f.agent,
        ts: f.ts,
        score,
      })),
      matched: scored.length,
    });
  }
);

server.registerTool(
  "ticket_create",
  {
    title: "Create a work ticket",
    description:
      "Create a task on the shared board so no other agent duplicates it. If you already know the interface another agent will build against, put it in contract (paths, function signatures, payload shapes).",
    inputSchema: {
      title: z.string().min(1),
      description: z.string().default("").describe("What to build, acceptance criteria if known"),
      contract: z.string().optional().describe("Published API/file contract others should build against"),
    },
  },
  async ({ title, description, contract }) => {
    const ticket = await store.mutate((d): Ticket => {
      touch(d);
      const t: Ticket = {
        id: nextId("t", d.tickets),
        title,
        desc: description,
        contract,
        status: "open",
        notes: [],
        createdBy: callerId(),
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      d.tickets.push(t);
      return t;
    });
    return ok({ created: ticket.id, ticket });
  }
);

server.registerTool(
  "ticket_claim",
  {
    title: "Claim a ticket",
    description:
      "Claim-before-build: mark a ticket yours before writing any code. Fails if another LIVE agent owns it, which is how duplicate work is prevented.",
    inputSchema: { id: z.string().describe("Ticket id, e.g. t1") },
  },
  async ({ id }) => {
    return store.mutate((d): ToolResult => {
      touch(d);
      const t = d.tickets.find((x) => x.id === id);
      if (!t) return fail(`ticket ${id} not found`);
      if (t.status === "closed") return fail(`ticket ${id} is closed (${t.resolution})`);
      const me = callerId();
      if (t.owner && t.owner !== me) {
        const ownerLive = liveAgentIds(d).includes(t.owner);
        if (ownerLive && Date.now() - Date.parse(d.agents[t.owner]?.lastSeen ?? 0) < AGENT_LIVE_MS) {
          return fail(`ticket ${id} is owned by live agent '${t.owner}' - pick a different ticket`);
        }
        note(d, t, `takeover from '${t.owner}' (not seen in >10m)`);
      }
      t.owner = me;
      t.status = "in_progress";
      note(d, t, "claimed");
      return ok({ claimed: t.id, owner: t.owner, status: t.status });
    });
  }
);

server.registerTool(
  "ticket_update",
  {
    title: "Post progress or evidence",
    description:
      "Append a progress note or evidence (test output, commit SHA, files changed) to a ticket you own. Optionally move its status.",
    inputSchema: {
      id: z.string(),
      note: z.string().optional(),
      status: z.enum(["open", "in_progress", "done"]).optional(),
    },
  },
  async ({ id, note: noteText, status }) => {
    return store.mutate((d): ToolResult => {
      touch(d);
      const t = d.tickets.find((x) => x.id === id);
      if (!t) return fail(`ticket ${id} not found`);
      if (noteText) note(d, t, noteText);
      if (status) {
        if (status === "done" && !t.owner) t.owner = callerId();
        t.status = status;
        t.updatedAt = nowISO();
      }
      return ok({ updated: t.id, status: t.status, notes: t.notes.length });
    });
  }
);

server.registerTool(
  "ticket_close",
  {
    title: "Close a ticket",
    description:
      "Close a finished ticket with an explicit resolution so the board stays trustworthy: completed (shipped), duplicate, wontfix, or already_done.",
    inputSchema: {
      id: z.string(),
      resolution: z.enum(["completed", "duplicate", "wontfix", "already_done"]),
      note: z.string().optional().describe("Closing evidence or explanation"),
    },
  },
  async ({ id, resolution, note: noteText }) => {
    return store.mutate((d): ToolResult => {
      touch(d);
      const t = d.tickets.find((x) => x.id === id);
      if (!t) return fail(`ticket ${id} not found`);
      t.status = "closed";
      t.resolution = resolution as Resolution;
      if (resolution === "completed" && !t.owner) t.owner = callerId();
      note(d, t, noteText ? `closed (${resolution}): ${noteText}` : `closed (${resolution})`);
      return ok({ closed: t.id, resolution });
    });
  }
);

server.registerTool(
  "board_view",
  {
    title: "View the board",
    description: "See every ticket, who owns what, active file claims and live agents. Check here before starting anything.",
    inputSchema: {},
  },
  async () => {
    const view = await store.mutate((d) => {
      touch(d);
      return {
        liveAgents: liveAgentIds(d),
        tickets: d.tickets.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          owner: t.owner ?? null,
          resolution: t.resolution ?? null,
          lastNote: t.notes.at(-1)?.text ?? null,
        })),
        claims: activeClaims(d).map((c) => ({ agent: c.agent, paths: c.paths })),
      };
    });
    return ok(view);
  }
);

server.registerTool(
  "claim_files",
  {
    title: "Claim files before editing",
    description:
      "Advisory file claim: announce you are editing these paths so other live agents get warned off. Non-blocking but conflicts are reported back to you immediately.",
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Repo-relative paths, e.g. src/auth.ts"),
    },
  },
  async ({ paths }) => {
    return store.mutate((d): ToolResult => {
      touch(d);
      const me = callerId();
      const conflicts = claimConflicts(d, me, paths);
      const expiresAt = Date.now() + CLAIM_TTL_MS;
      const mine = d.claims.find((c) => c.agent === me);
      if (mine) {
        mine.paths = Array.from(new Set(mine.paths.concat(paths)));
        mine.expiresAt = expiresAt;
      } else {
        d.claims.push({ agent: me, tool: d.agents[me]?.tool ?? "unknown", paths, expiresAt });
      }
      return ok({
        claimed: paths,
        conflicts: Object.entries(conflicts).map(([agent, ps]) => ({
          warning: `'${agent}' has also claimed: ${ps.join(", ")}`,
          agent,
          paths: ps,
        })),
      });
    });
  }
);

server.registerTool(
  "release_files",
  {
    title: "Release your file claims",
    description: "Release all file claims you hold. Do this when a unit of work is finished.",
    inputSchema: {},
  },
  async () => {
    const result = await store.mutate((d) => {
      touch(d);
      const me = callerId();
      const before = d.claims.length;
      d.claims = d.claims.filter((c) => c.agent !== me);
      return { released: before - d.claims.length };
    });
    return ok(result);
  }
);

await server.connect(new StdioServerTransport());
console.error(`[connectr] serving agent '${callerId()}' store=${store.dir}`);
