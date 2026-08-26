import path from "node:path";
import { parseTaskInput, resolveTool, type ConnectrConfig } from "./routing.js";
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
  const tool = parsed.tool ?? resolveTool(parsed.title, config);
  const ticket = await store.mutate((d): Ticket => {
    const t: Ticket = {
      id: nextId("t", d.tickets),
      title: parsed.title,
      desc: "",
      status: "open",
      notes: [],
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      routedTo: { tool, model: parsed.model, auto: !parsed.tool },
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
      if (!t.routedTo) t.routedTo = { tool: resolveTool(`${t.title} ${t.desc}`, config), auto: true };
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
    });
    return { id: t.id, tool: t.routedTo!.tool, model: t.routedTo!.model, pid: child?.pid, ok: !!child, logFile };
  });
}
