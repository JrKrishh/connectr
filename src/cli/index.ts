#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { Store, liveAgentIds, nextId } from "../store.js";
import { PERMISSION_MODES, effectiveRules, loadConfig, resolveTool, saveConfig, type PermissionMode } from "../routing.js";
import { launchTicket, toolKnown } from "../spawn.js";
import type { Ticket } from "../types.js";
import { ALL_TARGETS, applyEdit, hasConnectr } from "./targets.js";

const program = new Command();

program
  .name("connectr")
  .description("Shared brain for AI coding agents - one MCP board, memory and file-claims across Claude Code, Codex, Cursor, Kiro, Gemini CLI and Antigravity.")
  .version("0.1.0");

program
  .command("serve")
  .description("Run the connectr MCP server on stdio (this is what agents launch)")
  .action(async () => {
    await import("../server/index.js");
  });

program
  .command("init")
  .description("Wire the connectr MCP server + protocol into your coding tools' configs")
  .option("--global", "also wire global configs (Codex, Gemini CLI, Antigravity)")
  .option("--mode <mode>", "dispatch permission profile: safe | auto | yolo")
  .option("--dry-run", "show what would change without writing")
  .action(async (opts: { global?: boolean; mode?: string; dryRun?: boolean }) => {
    if (opts.mode && !PERMISSION_MODES.includes(opts.mode as PermissionMode)) {
      console.error(`unknown mode '${opts.mode}' - use safe, auto or yolo`);
      process.exitCode = 1;
      return;
    }
    const targets = opts.global ? [...ALL_TARGETS] : [...ALL_TARGETS].filter((t) => t.scope === "project");
    let changed = 0;
    let unchanged = 0;
    for (const target of targets) {
      for (const edit of target.edits()) {
        const already = hasConnectr(edit);
        if (opts.dryRun) {
          console.log(`[dry-run] ${already ? "(exists)" : "(new)"} ${edit.label} -> ${edit.file}`);
          continue;
        }
        try {
          const did = applyEdit(edit);
          if (did) {
            changed++;
            console.log(`wired   ${edit.label} -> ${edit.file}`);
          } else {
            unchanged++;
            console.log(`ok      ${edit.label} (already wired)`);
          }
        } catch (e) {
          console.error(`FAILED  ${edit.label} (${edit.file}): ${(e as Error).message}`);
          process.exitCode = 1;
        }
      }
    }
    if (!opts.dryRun) {
      const config = loadConfig(process.cwd());
      if (opts.mode) {
        config.permissionMode = opts.mode as PermissionMode;
        saveConfig(process.cwd(), config);
      }
      console.log(
        `\ndispatch permission mode: ${config.permissionMode}${opts.mode ? " (saved)" : "  (change: connectr init --mode safe|auto|yolo)"}`
      );
      console.log(
        `\nDone. ${changed} file(s) written, ${unchanged} already up to date.\nRestart your coding tools so they pick up the new MCP config, then ask an agent:\n  "Use connectr whoami and board_view, then tell me what you see."`
      );
    }
  });

const taskCmd = program
  .command("task")
  .description("Create and manage work items on the shared board");

taskCmd
  .command("add")
  .description("Add a task; ConnectR auto-routes it to the best tool unless you pick one")
  .argument("<title>", "task title")
  .option("-d, --desc <text>", "description / acceptance criteria")
  .option("-c, --contract <text>", "API contract other agents must build against")
  .option("--tool <name>", "manual routing: claude-code | codex | gemini")
  .option("--model <name>", "model hint recorded on the ticket")
  .action(async (title: string, opts: { desc?: string; contract?: string; tool?: string; model?: string }) => {
    if (opts.tool && !toolKnown(opts.tool)) {
      console.error(`unknown tool '${opts.tool}' - use claude-code, codex or gemini`);
      process.exitCode = 1;
      return;
    }
    const store = new Store();
    const config = loadConfig(process.cwd());
    const manual = !!opts.tool;
    const tool = opts.tool ?? resolveTool(`${title} ${opts.desc ?? ""}`, config);
    const ticket = await store.mutate((d): Ticket => {
      const t: Ticket = {
        id: nextId("t", d.tickets),
        title,
        desc: opts.desc ?? "",
        contract: opts.contract,
        status: "open",
        notes: [],
        createdBy: "host",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        routedTo: { tool, model: opts.model, auto: !manual },
      };
      d.tickets.push(t);
      return t;
    });
    console.log(`ticket ${ticket.id} -> ${tool}${opts.model ? ` (${opts.model})` : ""} [${manual ? "manual" : "auto-routed"}]`);
    if (!manual) {
      console.log(`  matched rule: ${effectiveRuleFor(`${title} ${opts.desc ?? ""}`, config) ?? "default"}`);
    }
    console.log(`  run: connectr run --id ${ticket.id}   (or connectr run for all open tasks)`);
  });

function effectiveRuleFor(text: string, config: ReturnType<typeof loadConfig>): string | null {
  const hay = text.toLowerCase();
  for (const rule of effectiveRules(config)) {
    try {
      if (new RegExp(rule.match, "i").test(hay)) return rule.match;
    } catch {
      /* skip */
    }
  }
  return null;
}

program
  .command("run")
  .description("Dispatch open tasks to their routed tools, in parallel (the host console)")
  .option("--id <ids>", "comma-separated ticket ids, e.g. t1,t2")
  .option("--dry-run", "show the dispatch plan without launching agents")
  .action(async (opts: { id?: string; dryRun?: boolean }) => {
    const store = new Store();
    const config = loadConfig(process.cwd());
    const wanted = opts.id ? opts.id.split(",").map((s) => s.trim()) : null;
    const d = store.read();
    const open = d.tickets.filter((t) => t.status === "open" && (!wanted || wanted.includes(t.id)));
    if (open.length === 0) {
      console.log("no open tickets to dispatch");
      return;
    }
    const plan = await store.mutate((data) => {
      const out: { ticket: Ticket; tool: string }[] = [];
      for (const t of open) {
        const fresh = data.tickets.find((x) => x.id === t.id)!;
        if (!fresh.routedTo) {
          fresh.routedTo = { tool: resolveTool(`${fresh.title} ${fresh.desc}`, config), auto: true };
        }
        out.push({ ticket: fresh, tool: fresh.routedTo.tool });
      }
      return out;
    });
    for (const p of plan) {
      const model = p.ticket.routedTo?.model;
      console.log(`t${p.ticket.id.slice(1).padEnd(3)} -> ${(p.tool + (model ? `:${model}` : "")).padEnd(24)} ${p.ticket.title}`);
    }
    console.log(`dispatch permission mode: ${config.permissionMode}`);
    if (opts.dryRun) {
      console.log("(dry-run: nothing launched)");
      return;
    }
    const runsDir = path.join(store.dir, "runs");
    const children = plan.map((p) => {
      const { child, logFile } = launchTicket(p.ticket, process.cwd(), runsDir, { mode: config.permissionMode });
      if (!child) {
        console.log(`${p.ticket.id}: ${p.tool} NOT FOUND - skipped`);
        return null;
      }
      const model = p.ticket.routedTo?.model;
      console.log(`launched ${p.ticket.id} -> ${p.tool}${model ? ` (${model})` : ""} (pid ${child.pid}, log ${logFile})`);
      return child;
    });
    await Promise.all(children.map((c) => (c ? new Promise((r) => c.on("close", r)) : Promise.resolve())));
    console.log("\n=== board after dispatch ===");
    const after = new Store().read();
    for (const t of after.tickets) {
      const owner = t.owner ? ` @${t.owner}` : "";
      const res = t.resolution ? ` (${t.resolution})` : "";
      console.log(`${t.id.padEnd(5)} [${t.status}]${owner}${res} ${t.title}`);
    }
  });

program
  .command("status")
  .description("Show store location and current shared state summary")
  .action(() => {
    const store = new Store();
    const d = store.read();
    const live = liveAgentIds(d);
    console.log(`store : ${store.dir}`);
    console.log(`agents: ${Object.keys(d.agents).length} known, live now: ${live.length ? live.join(", ") : "none"}`);
    console.log(`tickets: ${d.tickets.filter((t) => t.status !== "closed").length} open / ${d.tickets.length} total`);
    console.log(`facts : ${d.facts.length}`);
    console.log(`claims: ${d.claims.length}`);
  });

program
  .command("board")
  .description("Print the shared ticket board")
  .action(() => {
    const d = new Store().read();
    const now = Date.now();
    if (d.tickets.length === 0) return void console.log("(empty board)");
    for (const t of d.tickets) {
      const owner = t.owner ? ` @${t.owner}` : "";
      const res = t.resolution ? ` (${t.resolution})` : "";
      const route = t.routedTo ? ` -> ${t.routedTo.tool}${t.routedTo.auto ? "*" : ""}` : "";
      console.log(`${t.id.padEnd(5)} [${t.status}]${owner}${res} ${t.title}${route}`);
      const last = t.notes.at(-1);
      if (last) console.log(`        last note (${last.agent}): ${last.text}`);
    }
    const claims = d.claims.filter((c) => c.expiresAt > now);
    if (claims.length > 0) {
      console.log("\nfile claims:");
      for (const c of claims) console.log(`  @${c.agent}: ${c.paths.join(", ")}`);
    }
  });

program
  .command("doctor")
  .description("Check which tools are wired to connectr and whether the store is healthy")
  .action(async () => {
    console.log("config wiring:");
    for (const target of ALL_TARGETS) {
      for (const edit of target.edits()) {
        const okWired = hasConnectr(edit);
        const exists = fs.existsSync(edit.file);
        console.log(
          `  [${okWired ? "x" : " "}] ${target.scope.padEnd(6)} ${target.label}${exists || okWired ? "" : "  (file not created yet)"}`
        );
      }
    }
    console.log(`\ndispatch mode: ${loadConfig(process.cwd()).permissionMode}`);
    try {
      const store = new Store();
      await store.mutate(() => {});
      console.log(`store OK: ${store.dir}`);
    } catch (e) {
      console.error(`\nstore BROKEN: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("dash")
  .description("Live TUI dashboard: agents, tickets, file claims, recent memory")
  .action(async () => {
    const { runDash } = await import("../tui/dash.js");
    runDash();
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
