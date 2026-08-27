import path from "node:path";
import { spawn } from "node:child_process";
import { agentTarget, resolveToolSmart, targetKey } from "./learn.js";
import { plannerTicket } from "./planner.js";
import { parseTaskInput, type ConnectrConfig } from "./routing.js";
import { launchTicket } from "./spawn.js";
import { createWorktree } from "./worktree.js";
import { Store, liveAgentIds, nextId } from "./store.js";
import type { Ticket } from "./types.js";

// Shared host actions used by the CLI `run`, the TUI dash and the web UI.

export interface AddTaskResult {
  ticket?: Ticket;
  error?: string;
}

export async function addTaskFromInput(store: Store, config: ConnectrConfig, raw: string, createdBy: string): Promise<AddTaskResult> {
  const parsed = parseTaskInput(raw, (config.toolSpecs ?? []).filter((t) => t.kind === "dispatch").map((t) => t.id));
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
  /** Set when the agent was given its own git worktree instead of the shared tree. */
  worktree?: string;
  /** Why isolation was skipped, when it was asked for but not possible. */
  isolationNote?: string;
}

/**
 * Record how a dispatch ended. A failed run also reopens the ticket and drops the dead
 * owner, so retrying is just `connectr run` again - and because failures are scored as
 * losses, the router will pick a different target on its own.
 */
export async function recordAttempt(
  store: Store,
  ticketId: string,
  target: string,
  outcome: "completed" | "failed",
  detail?: string
): Promise<void> {
  await store.mutate((d) => {
    const t = d.tickets.find((x) => x.id === ticketId);
    if (!t) return;
    (t.attempts ??= []).push({ target, at: new Date().toISOString(), outcome, detail });
    t.run = undefined; // the process is over either way
    if (outcome === "failed" && t.status !== "closed") {
      t.status = "open";
      t.owner = undefined;
      t.notes.push({
        agent: "connectr",
        text: `run failed on ${target}${detail ? ` (${detail})` : ""} - reopened for another attempt`,
        ts: new Date().toISOString(),
      });
      t.updatedAt = new Date().toISOString();
    }
  });
}

/** Remember the process behind a launched ticket, so it can be stopped and so a restarted
 * host can distinguish a live run from an orphaned one. */
export async function recordRun(store: Store, ticketId: string, pid: number, logFile: string): Promise<void> {
  await store.mutate((d) => {
    const t = d.tickets.find((x) => x.id === ticketId);
    if (t) t.run = { pid, startedAt: new Date().toISOString(), logFile };
  });
}

/** Is this pid still a live process? EPERM means it exists but isn't ours - still alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Kill a dispatched agent's whole process tree, cross-platform. Detached children are
 * their own group on posix (negative pid) and need taskkill /T on Windows. */
export function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    /* already gone */
  }
}

export interface StopResult {
  ok: boolean;
  message: string;
}

/**
 * Stop a running ticket at the user's request. This is not a failure - the tool did not
 * lose, the human intervened - so it records no attempt and no routing loss; it just kills
 * the process and puts the ticket back on the board. The caller must mark the ticket in a
 * "stopping" set first so the child's own exit handler does not re-file it as a failure.
 */
export async function stopRun(store: Store, ticketId: string): Promise<StopResult> {
  const t = store.read().tickets.find((x) => x.id === ticketId);
  if (!t) return { ok: false, message: `no ticket ${ticketId}` };
  const pid = t.run?.pid;
  if (!pid) return { ok: false, message: `${ticketId} has no running agent to stop` };
  killTree(pid);
  await store.mutate((d) => {
    const tk = d.tickets.find((x) => x.id === ticketId);
    if (!tk) return;
    tk.run = undefined;
    tk.owner = undefined;
    if (tk.status !== "closed") tk.status = "open";
    tk.notes.push({ agent: "connectr", text: "stopped by you - back on the board", ts: new Date().toISOString() });
    tk.updatedAt = new Date().toISOString();
  });
  return { ok: true, message: `stopped ${ticketId}` };
}

/**
 * Tickets left in_progress by an agent that is no longer alive. A detached dispatch cannot
 * report its own death, so this is how those runs become data instead of a stuck board.
 */
export async function sweepDeadRuns(store: Store): Promise<{ id: string; target: string }[]> {
  const d = store.read();
  const live = new Set(liveAgentIds(d));
  // A ticket is orphaned if its recorded process is gone (fast and exact - survives a host
  // restart), or, for older runs with no pid, if its owner stopped heartbeating over MCP.
  const stuck = d.tickets.filter((t) => {
    if (t.status !== "in_progress") return false;
    if (t.run?.pid) return !pidAlive(t.run.pid);
    return t.owner && !live.has(t.owner);
  });
  const swept: { id: string; target: string }[] = [];
  for (const t of stuck) {
    const target = t.routedTo ? targetKey(t.routedTo.tool, t.routedTo.model) : t.owner ? agentTarget(d, t.owner) : "unknown";
    await recordAttempt(store, t.id, target, "failed", "agent gone");
    swept.push({ id: t.id, target });
  }
  return swept;
}

export interface Workspace {
  cwd: string;
  env?: Record<string, string>;
  worktree?: string;
  isolationNote?: string;
}

/**
 * Where a ticket's agent should work. With isolation on it gets a private git worktree,
 * but every agent must still meet on ONE board: a worktree has no `.connectr` (it is
 * gitignored), so CONNECTR_STORE pins the store to the main project and the wiring files
 * are copied across. Every dispatch path goes through here - an agent quietly launched in
 * the shared tree is exactly the bug isolation exists to prevent.
 */
export function prepareWorkspace(ticketId: string, cwd: string, storeDir: string, config: ConnectrConfig): Workspace {
  if (config.isolation !== "worktree") return { cwd };
  const made = createWorktree(cwd, storeDir, ticketId);
  if (!made.worktree) return { cwd, isolationNote: made.reason };
  return { cwd: made.worktree.path, env: { CONNECTR_STORE: storeDir }, worktree: made.worktree.path };
}

export function launchPlanned(
  plan: Ticket[],
  cwd: string,
  storeDir: string,
  config: ConnectrConfig,
  detach: boolean,
  onExit?: (ticket: Ticket, code: number | null) => void
): LaunchSummary[] {
  const runsDir = path.join(storeDir, "runs");
  return plan.map((t) => {
    const { cwd: workDir, env, worktree, isolationNote } = prepareWorkspace(t.id, cwd, storeDir, config);
    const { child, logFile } = launchTicket(t, workDir, runsDir, {
      detach,
      mode: config.permissionMode,
      planFile: config.planFile,
      userTools: config.toolSpecs,
      env,
    });
    // A detached child still emits close while this process lives, so a long-running
    // host can reconcile the run the moment the agent exits instead of waiting for a sweep.
    if (child && onExit) child.on("close", (code) => onExit(t, code));
    return {
      id: t.id,
      tool: t.routedTo!.tool,
      model: t.routedTo!.model,
      pid: child?.pid,
      ok: !!child,
      logFile,
      worktree,
      isolationNote,
    };
  });
}
