#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { Store, liveAgentIds, nextId } from "../store.js";
import { ISOLATIONS, PERMISSION_MODES, loadConfig, saveConfig, type Isolation, type PermissionMode } from "../routing.js";
import { isGitRepo, listWorktrees, mergeWorktree } from "../worktree.js";
import { MODE_INFO, toolRegistry } from "../tools.js";
import { detectTools, suggestOrchestra, PLAN_TEMPLATE } from "../detect.js";
import { planIntent, planOpenTickets, prepareWorkspace, recordAttempt, sweepDeadRuns } from "../host.js";
import { plannerTicket } from "../planner.js";
import { MIN_EVIDENCE, learnRoutes, resolveToolSmart } from "../learn.js";
import { launchTicket, toolKnown } from "../spawn.js";
import type { Ticket } from "../types.js";
import { ALL_TARGETS, applyEdit, hasConnectr, type ToolTarget } from "./targets.js";

function wireTargets(targets: ToolTarget[], dryRun?: boolean): { changed: number; unchanged: number } {
  let changed = 0;
  let unchanged = 0;
  for (const target of targets) {
    for (const edit of target.edits()) {
      const already = hasConnectr(edit);
      if (dryRun) {
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
  return { changed, unchanged };
}

const program = new Command();

program
  .name("connectr")
  .description("Shared brain for AI coding agents - one MCP board, memory and file-claims across Claude Code, Codex, Cursor, Kiro, Gemini CLI and Antigravity.")
  .version(JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version);

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
    const { changed, unchanged } = wireTargets(targets, opts.dryRun);
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

program
  .command("new")
  .description("Create a project: folder + PLAN.md + a suggested orchestra of coding tools wired to one brain")
  .argument("<dir>", "project folder (created if missing)")
  .option("--plan <file>", "project brief to install as PLAN.md")
  .option("--tools <list>", "comma-separated tools to wire, skipping the suggestion: claude-code,codex,gemini,cursor,kiro,antigravity")
  .option("--mode <mode>", "dispatch permission profile: safe | auto | yolo", "auto")
  .option("-y, --yes", "accept the suggested orchestra without prompting")
  .action(async (dir: string, opts: { plan?: string; tools?: string; mode: string; yes?: boolean }) => {
    if (!PERMISSION_MODES.includes(opts.mode as PermissionMode)) {
      console.error(`unknown mode '${opts.mode}' - use safe, auto or yolo`);
      process.exitCode = 1;
      return;
    }
    const root = path.resolve(dir);
    fs.mkdirSync(root, { recursive: true });
    process.chdir(root); // init targets resolve project files against cwd

    // 1. the plan
    const planPath = path.join(root, "PLAN.md");
    let planCreated = false;
    if (opts.plan) {
      const src = path.resolve(opts.plan);
      if (!fs.existsSync(src)) {
        console.error(`plan file not found: ${src}`);
        process.exitCode = 1;
        return;
      }
      if (src !== planPath) fs.copyFileSync(src, planPath);
    } else if (!fs.existsSync(planPath)) {
      fs.writeFileSync(planPath, PLAN_TEMPLATE);
      planCreated = true;
    }
    const planText = fs.readFileSync(planPath, "utf8");

    // 2. detect + suggest the orchestra
    const detected = detectTools();
    const suggestions = suggestOrchestra(planText, detected);
    const known = detected.map((d) => d.tool);
    console.log(`project: ${root}\nplan   : PLAN.md${planCreated ? " (template - fill it in!)" : ""}\n`);
    console.log("orchestra suggestion (from your plan + what's installed):");
    for (const s of suggestions) {
      console.log(`  [${s.suggested ? "x" : " "}] ${s.tool.padEnd(12)} ${s.kind.padEnd(12)} ${s.reason}`);
    }

    // 3. selection: --tools > interactive confirm > suggestion
    let selected = suggestions.filter((s) => s.suggested).map((s) => s.tool);
    if (opts.tools) {
      selected = opts.tools.split(",").map((s) => s.trim()).filter(Boolean);
      const bad = selected.filter((t) => !known.includes(t));
      if (bad.length > 0) {
        console.error(`unknown tool(s): ${bad.join(", ")} - use ${known.join(", ")}`);
        process.exitCode = 1;
        return;
      }
    } else if (!opts.yes && process.stdin.isTTY && process.stdout.isTTY) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("\nwire these tools? [Y]es / [n]o / comma-list to override: ")).trim();
      rl.close();
      if (/^n/i.test(answer)) {
        console.log("aborted - nothing wired");
        return;
      }
      if (answer && !/^y/i.test(answer)) {
        selected = answer.split(",").map((s) => s.trim()).filter(Boolean);
        const bad = selected.filter((t) => !known.includes(t));
        if (bad.length > 0) {
          console.error(`unknown tool(s): ${bad.join(", ")} - use ${known.join(", ")}`);
          process.exitCode = 1;
          return;
        }
      }
    }
    if (selected.length === 0) {
      console.error("no tools selected - install at least one coding tool or pass --tools");
      process.exitCode = 1;
      return;
    }

    // 4. wire only the selected tools (+ the tool-agnostic AGENTS.md block)
    const slugs = new Set<string>(["agents-md"]);
    for (const d of detected) if (selected.includes(d.tool)) for (const s of d.targetSlugs) slugs.add(s);
    console.log("");
    wireTargets(ALL_TARGETS.filter((t) => slugs.has(t.slug)));

    // 5. project config
    const config = loadConfig(root);
    config.permissionMode = opts.mode as PermissionMode;
    config.tools = selected;
    config.planFile = "PLAN.md";
    saveConfig(root, config);

    // 6. seed the board: the first agent decomposes the plan into tickets
    const store = new Store(root);
    const dispatchTool = suggestions.find((s) => s.kind === "dispatch" && selected.includes(s.tool))?.tool;
    const seed = plannerTicket(`Build what ${"PLAN.md"} describes.`, { planFile: "PLAN.md" });
    const seeded = await store.mutate((d): string | null => {
      if (d.tickets.length > 0) return null;
      const t: Ticket = {
        id: nextId("t", d.tickets),
        title: seed.title,
        desc: seed.desc,
        status: "open",
        notes: [],
        createdBy: "connectr-new",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        routedTo: { tool: dispatchTool ?? "claude-code", auto: true, via: "default" },
      };
      d.tickets.push(t);
      return t.id;
    });

    console.log(
      [
        "",
        `wired: ${selected.join(", ")}   mode: ${opts.mode}`,
        seeded ? `board: seeded ${seeded} "${seed.title}" (routed to ${dispatchTool ?? "claude-code"})` : "board: existing tickets kept",
        "",
        "next:",
        planCreated ? "  1. fill in PLAN.md" : "  1. review PLAN.md",
        `  2. cd ${dir}`,
        "  3. connectr run     (dispatches the decompose ticket - the board fills itself)",
        "     or connectr dash (interactive host)",
        "  restart IDE tools (Cursor/Kiro/Antigravity) so they pick up the MCP config",
      ].join("\n")
    );
  });

program
  .command("plan")
  .description("Describe what you want; ConnectR breaks it into routed tickets on the board")
  .argument("<intent>", "what you want built, in plain language")
  .option("--tool <name>", "which tool does the planning (default: the project's default tool)")
  .option("--run", "dispatch the tickets it creates as soon as planning finishes")
  .action(async (intent: string, opts: { tool?: string; run?: boolean }) => {
    if (opts.tool && !toolKnown(opts.tool)) {
      console.error(`unknown tool '${opts.tool}' - use claude-code, codex or gemini`);
      process.exitCode = 1;
      return;
    }
    const store = new Store();
    const config = loadConfig(process.cwd());
    const result = await planIntent(store, config, intent, "host", { tool: opts.tool });
    if (result.error) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    const planner = result.ticket!;
    const before = new Set(store.read().tickets.map((t) => t.id));
    console.log(`planning with ${planner.routedTo!.tool} (${planner.id}) - mode ${config.permissionMode}\n`);

    const runsDir = path.join(store.dir, "runs");
    const pws = prepareWorkspace(planner.id, process.cwd(), store.dir, config);
    const { child, logFile } = launchTicket(planner, pws.cwd, runsDir, {
      mode: config.permissionMode,
      planFile: config.planFile,
      userTools: config.toolSpecs,
      env: pws.env,
    });
    if (!child) {
      console.error(`${planner.routedTo!.tool} not found - install it or pass --tool`);
      process.exitCode = 1;
      return;
    }
    console.log(`log: ${logFile}`);
    await new Promise((r) => child.on("close", r));

    // Tickets created through MCP carry no routing yet - resolve it now so the summary
    // shows which tool each one is headed for, not "unrouted".
    await planOpenTickets(new Store(), config);
    const created = new Store().read().tickets.filter((t) => !before.has(t.id));
    if (created.length === 0) {
      console.log("\nno tickets were created - read the log above to see what the planner did");
      return;
    }
    console.log(`\n${created.length} ticket(s) created:`);
    for (const t of created) {
      const rt = t.routedTo;
      console.log(`  ${t.id.padEnd(5)} -> ${(rt ? rt.tool + (rt.model ? `:${rt.model}` : "") : "unrouted").padEnd(14)} ${t.title}`);
    }
    console.log(opts.run ? "\ndispatching..." : `\nrun them: connectr run   (or connectr ui to watch)`);
    if (opts.run) {
      const plan = await planOpenTickets(new Store(), config);
      for (const t of plan) {
        const ws = prepareWorkspace(t.id, process.cwd(), store.dir, config);
        const { child: c, logFile: lf } = launchTicket(t, ws.cwd, runsDir, {
          mode: config.permissionMode,
          planFile: config.planFile,
          userTools: config.toolSpecs,
          env: ws.env,
          detach: true,
        });
        console.log(c ? `launched ${t.id} -> ${t.routedTo!.tool} (pid ${c.pid}, log ${lf})` : `${t.id}: ${t.routedTo!.tool} NOT FOUND`);
      }
      console.log("\nagents are running detached - watch them with: connectr ui");
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
    const ticket = await store.mutate((d): Ticket => {
      const routedTo = manual
        ? { tool: opts.tool!, model: opts.model, auto: false, via: "manual" as const }
        : (() => {
            const smart = resolveToolSmart(title, opts.desc ?? "", d, config);
            return { tool: smart.tool, model: opts.model ?? smart.model, auto: true, via: smart.via, reason: smart.reason };
          })();
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
        routedTo,
      };
      d.tickets.push(t);
      return t;
    });
    const rt = ticket.routedTo!;
    console.log(`ticket ${ticket.id} -> ${rt.tool}${opts.model ? ` (${opts.model})` : ""} [${manual ? "manual" : `auto: ${rt.via}`}]`);
    if (!manual && rt.reason) console.log(`  ${rt.reason}`);
    console.log(`  run: connectr run --id ${ticket.id}   (or connectr run for all open tasks)`);
  });

program
  .command("run")
  .description("Dispatch open tasks to their routed tools, in parallel (the host console)")
  .option("--id <ids>", "comma-separated ticket ids, e.g. t1,t2")
  .option("--dry-run", "show the dispatch plan without launching agents")
  .action(async (opts: { id?: string; dryRun?: boolean }) => {
    const store = new Store();
    const config = loadConfig(process.cwd());
    const wanted = opts.id ? opts.id.split(",").map((s) => s.trim()) : null;
    const plan = await planOpenTickets(store, config, { include: wanted });
    if (plan.length === 0) {
      console.log("no open tickets to dispatch");
      return;
    }
    for (const t of plan) {
      const tool = t.routedTo!.tool;
      const model = t.routedTo!.model;
      console.log(`t${t.id.slice(1).padEnd(3)} -> ${(tool + (model ? `:${model}` : "")).padEnd(24)} ${t.title}`);
    }
    console.log(`dispatch permission mode: ${config.permissionMode}`);
    if (opts.dryRun) {
      console.log("(dry-run: nothing launched)");
      return;
    }
    const runsDir = path.join(store.dir, "runs");
    const children = plan.map((t) => {
      const tool = t.routedTo!.tool;
      const ws = prepareWorkspace(t.id, process.cwd(), store.dir, config);
      if (ws.isolationNote) console.log(`${t.id}: isolation skipped - ${ws.isolationNote}`);
      const { child, logFile } = launchTicket(t, ws.cwd, runsDir, {
        mode: config.permissionMode,
        planFile: config.planFile,
        userTools: config.toolSpecs,
        env: ws.env,
      });
      if (!child) {
        console.log(`${t.id}: ${tool} NOT FOUND - skipped`);
        return null;
      }
      const model = t.routedTo!.model;
      console.log(
        `launched ${t.id} -> ${tool}${model ? ` (${model})` : ""} (pid ${child.pid})` +
          (ws.worktree ? `\n          tree ${ws.worktree}` : "")
      );
      return { child, ticket: t };
    });
    // A child that exits without its ticket closed is a failed run. Record it as an
    // attempt so routing learns from it, and reopen the ticket so a retry is just
    // running again - otherwise the board sits stuck until the liveness steal.
    await Promise.all(
      children.map(async (entry) => {
        if (!entry?.child) return;
        const code = await new Promise<number | null>((r) => entry.child!.on("close", (c) => r(c)));
        const fresh = new Store().read().tickets.find((x) => x.id === entry.ticket.id);
        const rt = entry.ticket.routedTo!;
        const target = rt.model ? `${rt.tool}:${rt.model}` : rt.tool;
        if (fresh && fresh.status !== "closed") {
          await recordAttempt(new Store(), entry.ticket.id, target, "failed", `exited ${code ?? "?"} without closing`);
          console.log(`${entry.ticket.id}: ${target} exited without closing the ticket - reopened, counted as a loss`);
        } else {
          await recordAttempt(new Store(), entry.ticket.id, target, "completed");
        }
      })
    );
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
  .command("sweep")
  .description("Reopen tickets whose agent is gone, and count those runs as failures")
  .action(async () => {
    const swept = await sweepDeadRuns(new Store());
    if (swept.length === 0) {
      console.log("nothing stuck - every in-progress ticket has a live agent");
      return;
    }
    for (const s of swept) console.log(`reopened ${s.id} (${s.target} is gone) - counted as a loss`);
    console.log(`\n${swept.length} ticket(s) back on the board. Retry with: connectr run`);
  });

program
  .command("trees")
  .description("Show the git worktrees ConnectR made for tickets, and what is waiting in them")
  .action(() => {
    const store = new Store();
    const root = path.dirname(store.dir);
    if (!isGitRepo(root)) {
      console.log("not a git repository - isolation is unavailable here");
      return;
    }
    const trees = listWorktrees(root, store.dir);
    if (trees.length === 0) {
      console.log("no worktrees. Turn isolation on with: connectr isolation worktree");
      return;
    }
    for (const t of trees) {
      const state = [t.commits > 0 ? `${t.commits} commit${t.commits === 1 ? "" : "s"} to merge` : "nothing to merge"];
      if (t.dirty) state.push("UNCOMMITTED changes");
      console.log(`${t.ticket.padEnd(6)} ${t.branch.padEnd(18)} ${state.join(" · ")}`);
      console.log(`       ${t.path}`);
    }
    console.log("\nbring one back with: connectr merge <ticket>");
  });

program
  .command("merge")
  .description("Merge a ticket's worktree branch back into your current branch")
  .argument("<ticket>", "ticket id, e.g. t12")
  .option("--keep", "keep the worktree and branch after merging")
  .action((ticket: string, opts: { keep?: boolean }) => {
    const store = new Store();
    const root = path.dirname(store.dir);
    const result = mergeWorktree(root, store.dir, ticket, { remove: !opts.keep });
    console.log(result.message);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("isolation")
  .description("Show or set whether each dispatched ticket gets its own git worktree")
  .argument("[mode]", "off | worktree")
  .action((mode?: string) => {
    const root = path.dirname(new Store().dir);
    const config = loadConfig(root);
    if (mode) {
      if (!ISOLATIONS.includes(mode as Isolation)) {
        console.error(`unknown isolation '${mode}' - use off or worktree`);
        process.exitCode = 1;
        return;
      }
      if (mode === "worktree" && !isGitRepo(root)) {
        console.error("this project is not a git repository, so worktree isolation cannot work here");
        process.exitCode = 1;
        return;
      }
      config.isolation = mode as Isolation;
      saveConfig(root, config);
    }
    console.log(
      config.isolation === "worktree"
        ? `worktree${mode ? " (saved)" : ""} - every dispatched ticket gets its own checkout on branch connectr/<ticket>, sharing one board`
        : `off${mode ? " (saved)" : ""} - all agents work in this tree; claim_files only warns them off each other`
    );
  });

program
  .command("auto")
  .description("Show or set auto-continue: the ui host keeps launching queued tickets until the board is clear")
  .argument("[state]", "on | off")
  .action((state?: string) => {
    const root = path.dirname(new Store().dir);
    const config = loadConfig(root);
    if (state) {
      if (state !== "on" && state !== "off") {
        console.error(`unknown state '${state}' - use on or off`);
        process.exitCode = 1;
        return;
      }
      config.autoContinue = state === "on";
      saveConfig(root, config);
    }
    console.log(
      config.autoContinue
        ? `on${state ? " (saved)" : ""} - while connectr ui runs, queued tickets launch on their own; a ticket that fails twice is left for you`
        : `off${state ? " (saved)" : ""} - nothing launches until you press Launch or run connectr run`
    );
  });

program
  .command("mode")
  .description("Show or set the dispatch permission mode every tool is launched in")
  .argument("[mode]", "safe | auto | yolo")
  .action((mode?: string) => {
    const config = loadConfig(process.cwd());
    if (mode) {
      if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
        console.error(`unknown mode '${mode}' - use safe, auto or yolo`);
        process.exitCode = 1;
        return;
      }
      config.permissionMode = mode as PermissionMode;
      saveConfig(process.cwd(), config);
    }
    const info = MODE_INFO.find((m) => m.id === config.permissionMode);
    console.log(`${config.permissionMode}${mode ? " (saved)" : ""} - ${info?.blurb ?? ""}\n`);
    console.log("what each dispatchable tool is launched with:");
    for (const t of toolRegistry(config.toolSpecs).filter((x) => x.kind === "dispatch")) {
      const flags = (t.modes?.[config.permissionMode] ?? []).join(" ");
      console.log(`  ${t.id.padEnd(13)} ${flags || "no extra flags"}`);
    }
  });

program
  .command("tools")
  .description("List the coding tools ConnectR can see, and whether each is ready to work")
  .option("--json", "machine-readable output, for programs that drive ConnectR")
  .action((opts: { json?: boolean }) => {
    const config = loadConfig(process.cwd());
    const found = detectTools(config.toolSpecs);
    if (opts.json) {
      console.log(JSON.stringify({ tools: found, permissionMode: config.permissionMode }, null, 2));
      return;
    }
    for (const t of found) {
      const state = !t.installed
        ? "not installed"
        : t.signedIn === false
          ? `signed out${t.signInHint ? ` - run: ${t.signInHint}` : ""}`
          : t.signedIn === null
            ? t.kind === "participant"
              ? "joins the brain over MCP"
              : "installed (sign-in not checkable)"
            : "installed · signed in";
      console.log(`${t.installed && t.signedIn !== false ? "x" : " "}  ${t.tool.padEnd(13)} ${t.kind.padEnd(12)} ${state}`);
    }
  });

program
  .command("routes")
  .description("Show learned routing: how past outcomes reshape where new tasks go")
  .action(() => {
    const store = new Store();
    const config = loadConfig(process.cwd());
    const d = store.read();
    const table = learnRoutes(d, config);
    // Outcomes, not closed tickets: a run that failed on an open ticket is evidence too.
    const outcomes = [...table.values()].reduce((n, c) => n + c.evidence, 0);
    console.log(`learned routing from ${outcomes} run(s) on record - an override needs ${MIN_EVIDENCE}+ in a category\n`);
    if (table.size === 0) {
      console.log("no runs on record yet - close some tickets and come back");
      return;
    }
    for (const c of table.values()) {
      const terms = c.category.split("|");
      const label = c.category === "default" ? "default" : terms.slice(0, 3).join("|") + (terms.length > 3 ? "|…" : "");
      const stats = Object.entries(c.stats)
        .map(([tool, s]) => `${tool} ${s.wins}-${s.losses}`)
        .join(" · ");
      console.log(`${c.learned ? "◆" : "·"} ${label}`);
      console.log(`    rule says ${c.ruleTool} · record: ${stats || "none"}`);
      console.log(`    pick: ${c.pick}${c.learned ? "  << LEARNED override" : ""} (${c.reason})`);
    }
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
    const config = loadConfig(process.cwd());
    console.log("\ntools:");
    for (const t of detectTools(config.toolSpecs)) {
      const state = !t.installed
        ? "not installed"
        : t.signedIn === false
          ? `signed out${t.signInHint ? ` - run: ${t.signInHint}` : ""}`
          : t.signedIn === null
            ? t.kind === "participant"
              ? "joins the brain over MCP"
              : "installed (sign-in not checkable)"
            : "installed · signed in";
      const ready = t.installed && t.signedIn !== false;
      console.log(`  [${ready ? "x" : " "}] ${t.tool.padEnd(13)} ${t.kind.padEnd(12)} ${state}`);
    }
    console.log(`\ndispatch mode: ${config.permissionMode}`);
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

program
  .command("ui")
  .description("Local web dashboard: board, agents, memory, run logs - add tasks and dispatch from the browser")
  .option("--port <n>", "port to listen on (bound to 127.0.0.1 only)", "4270")
  .action(async (opts: { port: string }) => {
    const { startUi } = await import("../ui/server.js");
    const port = Number(opts.port);
    const server = startUi(port);
    server.on("listening", () => {
      console.log(`connectr ui -> http://127.0.0.1:${port}   (Ctrl+C to stop)`);
    });
    server.on("error", (e) => {
      console.error(`ui failed to start: ${(e as Error).message}`);
      process.exit(1);
    });
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
