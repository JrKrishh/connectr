import path from "node:path";
import { resolveToolSmart } from "./learn.js";
import { plannerTicket } from "./planner.js";
import { parseTaskInput, type ConnectrConfig } from "./routing.js";
import { launchTicket } from "./spawn.js";
import { Store, nextId } from "./store.js";
import type { Ticket } from "./types.js";

// Shared host actions used by the CLI `run`, the TUI dash and the web UI.

export interface AddTaskResult {
  ticket?: Ticket;
  error?: string;
}

export async function addTaskFromInput(store: Store, config: ConnectrConfig, raw: string, createdBy: string): Promise<AddTaskResult> {
  const parsed = parseTaskInput(raw);
  if (parsed.error) return { error: parsed.error };
  if (!parsed.title) return { error: "empty title - nothing created" };
  const ticket = await store.mutate((d): Ticket => {
    const routedTo = parsed.tool
      ? { tool: parsed.tool, model: parsed.model, auto: false, via: "manual" as const }
      : (() => {
          const smart = resolveToolSmart(parsed.title, "", d, config);
          return { tool: smart.tool, model: parsed.model ?? smart.model, auto: true, via: smart.via, reason: smart.reason };
        })();
    const t: Ticket = {
      id: nextId("t", d.tickets),
      title: parsed.title,
      desc: "",
      status: "open",
      notes: [],
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      routedTo,
    };
    d.tickets.push(t);
    return t;
  });
  return { ticket };
}

// The conversational front door: park the intent on the board as a planner ticket. It is
// dispatched like any other ticket; the agent that claims it fills the board with the
// real work. Planning is reasoning, so it goes to the project's default tool rather than
// whatever the intent's wording happens to match.
export async function planIntent(
  store: Store,
  config: ConnectrConfig,
  intent: string,
  createdBy: string,
  opts: { tool?: string } = {}
): Promise<AddTaskResult> {
  if (!intent.trim()) return { error: "say what you want built - the request is empty" };
  const { title, desc } = plannerTicket(intent, { planFile: config.planFile });
  const tool = opts.tool ?? config.routing.defaultTool;
  const ticket = await store.mutate((d): Ticket => {
    const t: Ticket = {
      id: nextId("t", d.tickets),
      title,
      desc,
      status: "open",
      notes: [],
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      routedTo: { tool, auto: !opts.tool, via: opts.tool ? "manual" : "default", reason: "planning goes to the project's reasoning tool" },
    };
    d.tickets.push(t);
    return t;
  });
  return { ticket };
}

// Assigns routing to any unrouted open ticket and returns copies of the dispatchable set.
export async function planOpenTickets(
  store: Store,
  config: ConnectrConfig,
  opts: { exclude?: Set<string>; include?: string[] | null } = {}
): Promise<Ticket[]> {
  const exclude = opts.exclude ?? new Set<string>();
  const include = opts.include ?? null;
  return store.mutate((d): Ticket[] => {
    const open = d.tickets.filter(
      (t) => t.status === "open" && !exclude.has(t.id) && (!include || include.includes(t.id))
    );
    for (const t of open) {
      if (!t.routedTo) {
        const smart = resolveToolSmart(t.title, t.desc, d, config);
        t.routedTo = { tool: smart.tool, model: smart.model, auto: true, via: smart.via, reason: smart.reason };
      }
    }
    return open.map((t) => ({ ...t }));
  });
}

export interface LaunchSummary {
  id: string;
  tool: string;
  model?: string;
  pid?: number;
  ok: boolean;
  logFile: string;
}

export function launchPlanned(plan: Ticket[], cwd: string, storeDir: string, config: ConnectrConfig, detach: boolean): LaunchSummary[] {
  const runsDir = path.join(storeDir, "runs");
  return plan.map((t) => {
    const { child, logFile } = launchTicket(t, cwd, runsDir, {
      detach,
      mode: config.permissionMode,
      planFile: config.planFile,
      userTools: config.toolSpecs,
    });
    return { id: t.id, tool: t.routedTo!.tool, model: t.routedTo!.model, pid: child?.pid, ok: !!child, logFile };
  });
}
