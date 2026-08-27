import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "./routing.js";
import { expandArgs, findTool, toolRegistry, type ToolSpec } from "./tools.js";
import type { Ticket } from "./types.js";

export interface SpawnOptions {
  tool: string;
  cwd: string;
  prompt: string;
  logFile: string;
  model?: string;
  mode?: PermissionMode;
  detach?: boolean; // survive the parent exiting (dash host); logs go straight to the file fd
  userTools?: ToolSpec[];
  env?: Record<string, string>;
}

// Windows shims (.cmd/.bat) cannot be spawned directly and a shell string mangles free
// text, so resolve the shim ourselves and hand cmd.exe an argv array instead.
function resolveOnPath(bin: string): string | null {
  return bin === "codex" ? findCodex() : whereOnPath(bin);
}

export function whereOnPath(exe: string): string | null {
  const candidates = process.platform === "win32" ? [`${exe}.exe`, `${exe}.cmd`, `${exe}`] : [exe];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const c of candidates) {
      const full = path.join(dir, c);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

export function findCodex(): string | null {
  const onPath = whereOnPath("codex");
  if (onPath) return onPath;
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
    const m = toml.match(/CODEX_CLI_PATH\s*=\s*'([^']+)'/);
    if (m && fs.existsSync(m[1])) return m[1];
  } catch {
    /* no config */
  }
  try {
    const binDir = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin");
    const versions = fs.readdirSync(binDir).sort().reverse();
    for (const v of versions) {
      const exe = path.join(binDir, v, "codex.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* not installed */
  }
  return null;
}

export function toolKnown(tool: string, userTools: ToolSpec[] = []): boolean {
  return toolRegistry(userTools).some((t) => t.id === tool && t.kind === "dispatch");
}

// Model ids feed a powershell -Command string, so only plain token shapes pass.
export function safeModel(model?: string): string | null {
  if (!model) return null;
  return /^[A-Za-z0-9][\w.:/-]*$/.test(model) ? model : null;
}

export interface ToolCommand {
  command: string;
  args: string[];
}

export function buildCommand(
  tool: string,
  cwd: string,
  model?: string,
  mode: PermissionMode = DEFAULT_PERMISSION_MODE,
  platform: NodeJS.Platform = process.platform,
  opts: { userTools?: ToolSpec[]; prompt?: string } = {}
): ToolCommand | null {
  const spec = findTool(tool, opts.userTools);
  if (!spec || spec.kind !== "dispatch" || !spec.args?.length) return null;

  const m = safeModel(model);
  const { argv, promptDelivery } = expandArgs(spec, {
    cwd,
    model: m ?? undefined,
    prompt: opts.prompt ?? "",
    mode,
  });
  const [bin, ...rest] = argv;

  // Codex ships a real .exe we can spawn directly, and knows non-PATH install locations.
  if (spec.bin === "codex") {
    const exe = findCodex();
    return exe ? { command: exe, args: rest } : null;
  }
  // On posix, spawn(bin) surfaces a missing tool as an async ENOENT 'error' event, which
  // spawnAgent turns into a logged failure - so no PATH precheck is needed here.
  if (platform !== "win32") return { command: bin, args: rest };

  // On Windows these are npm .cmd shims. Resolve the tool on PATH first: without this the
  // stdin branch handed back a live `powershell -Command "gemini ..."` for a tool that
  // isn't installed - the run "launched", died with "'gemini' is not recognized", and
  // booked a false routing loss for a tool that never executed.
  const exe = resolveOnPath(spec.bin ?? bin);
  if (!exe) return null;

  // A joined shell string is only safe while every token is a fixed flag or a
  // safeModel-validated id; the moment the prompt rides in argv it must go through cmd.exe
  // as a real array or quoting will corrupt it.
  if (promptDelivery === "arg") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/c", exe, ...rest] };
  }
  return { command: "powershell", args: ["-NoProfile", "-Command", argv.join(" ")] };
}

export function spawnAgent(opts: SpawnOptions): ChildProcess | null {
  const model = safeModel(opts.model);
  const mode = opts.mode ?? DEFAULT_PERMISSION_MODE;
  const header =
    `\n=== connectr dispatch ${opts.tool}${model ? `:${model}` : ""} mode=${mode} @ ${new Date().toISOString()} ===\n` +
    (opts.model && !model ? `ignoring invalid model '${opts.model}'\n` : "");
  const cmd = buildCommand(opts.tool, opts.cwd, model ?? undefined, mode, process.platform, {
    userTools: opts.userTools,
    prompt: opts.prompt,
  });
  if (!cmd) {
    const hint =
      opts.tool === "codex"
        ? "codex not found: install codex CLI or fix CODEX_CLI_PATH"
        : `${opts.tool} not found on PATH: install it, or check 'connectr doctor'`;
    fs.appendFileSync(opts.logFile, header + hint + "\n");
    return null;
  }
  const env = {
    ...process.env,
    ...opts.env,
    CONNECTR_TOOL: opts.tool,
    ...(model ? { CONNECTR_MODEL: model } : {}),
  };
  let child: ChildProcess;
  if (opts.detach) {
    const fd = fs.openSync(opts.logFile, "a");
    fs.writeSync(fd, header);
    child = spawn(cmd.command, cmd.args, { cwd: opts.cwd, env, stdio: ["pipe", fd, fd], detached: true });
    fs.closeSync(fd);
    child.stdin?.write(opts.prompt);
    child.stdin?.end();
    child.unref();
  } else {
    const logStream = fs.createWriteStream(opts.logFile, { flags: "a" });
    logStream.write(header);
    child = spawn(cmd.command, cmd.args, { cwd: opts.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.stdin?.write(opts.prompt);
    child.stdin?.end();
    child.on("close", () => logStream.end());
  }
  // A spawn failure (missing binary on posix, EACCES) fires an async 'error' event; without
  // a listener Node throws it and takes the whole host process down. Log it and let it
  // surface as a normal non-zero exit that the caller reconciles.
  child.on("error", (e) => {
    try {
      fs.appendFileSync(opts.logFile, `connectr: failed to start ${opts.tool} - ${(e as Error).message}\n`);
    } catch {
      /* nothing more we can do */
    }
  });
  return child;
}

export function launchTicket(
  ticket: Ticket,
  cwd: string,
  runsDir: string,
  opts: { detach?: boolean; mode?: PermissionMode; planFile?: string; userTools?: ToolSpec[]; env?: Record<string, string> } = {}
): { child: ChildProcess | null; logFile: string } {
  fs.mkdirSync(runsDir, { recursive: true });
  const tool = ticket.routedTo?.tool ?? "claude-code";
  const logFile = path.join(runsDir, `${ticket.id}-${Date.now()}.log`);
  const child = spawnAgent({
    tool,
    model: ticket.routedTo?.model,
    cwd,
    prompt: harnessPrompt(ticket, tool, cwd, opts.planFile),
    logFile,
    mode: opts.mode,
    detach: opts.detach,
    userTools: opts.userTools,
    env: opts.env,
  });
  return { child, logFile };
}

export function harnessPrompt(
  ticket: { id: string; title: string; desc: string; contract?: string },
  tool: string,
  cwd: string,
  planFile?: string
): string {
  const lines = [
    `You are agent '${tool}' dispatched by ConnectR to work on ticket ${ticket.id}: ${ticket.title}`,
    `Working directory: ${cwd}`,
  ];
  if (planFile) lines.push(`Project brief: read ${planFile} first - it defines the goal, features and constraints.`);
  if (ticket.desc) lines.push(`Description: ${ticket.desc}`);
  if (ticket.contract) lines.push(`Contract (build against this exactly): ${ticket.contract}`);
  lines.push(
    "",
    "Follow the ConnectR shared-brain protocol using the connectr MCP tools:",
    `1. whoami tool='${tool}'`,
    `2. ticket_claim '${ticket.id}'`,
    "3. board_view and recall for context",
    "4. claim_files for the paths you will edit",
    "5. Do the work. Verify by running tests or commands.",
    "6. ticket_update with evidence, then ticket_close resolution='completed' (or duplicate/wontfix if not done)",
    "Work autonomously until done. Be concise."
  );
  return lines.join("\n");
}
