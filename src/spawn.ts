import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PERMISSION_MODE, KNOWN_TOOLS, type PermissionMode } from "./routing.js";
import type { Ticket } from "./types.js";

export interface SpawnOptions {
  tool: string;
  cwd: string;
  prompt: string;
  logFile: string;
  model?: string;
  mode?: PermissionMode;
  detach?: boolean; // survive the parent exiting (dash host); logs go straight to the file fd
  env?: Record<string, string>;
}

// What each permission mode means per tool. safe = read/plan, writes blocked unless the
// project's own settings allow them; auto = edits allowed, approvals still gate the rest;
// yolo = no gates (the pre-P0 behavior, now opt-in per project).
const MODE_FLAGS: Record<string, Record<PermissionMode, string[]>> = {
  "claude-code": {
    // --allowedTools mcp__connectr keeps the shared-brain protocol working when everything
    // else stays gated; without it, headless -p silently denies ticket/memory calls.
    safe: ["--allowedTools", "mcp__connectr"],
    auto: ["--permission-mode", "acceptEdits", "--allowedTools", "mcp__connectr"],
    yolo: ["--dangerously-skip-permissions"],
  },
  codex: {
    safe: ["--sandbox", "read-only"],
    auto: ["--full-auto"],
    yolo: ["--dangerously-bypass-approvals-and-sandbox"],
  },
  gemini: {
    safe: ["--approval-mode", "default"],
    auto: ["--approval-mode", "auto_edit"],
    yolo: ["--approval-mode", "yolo"],
  },
};

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

export function toolKnown(tool: string): boolean {
  return KNOWN_TOOLS.includes(tool);
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
  platform: NodeJS.Platform = process.platform
): ToolCommand | null {
  const m = safeModel(model);
  const modeFlags = MODE_FLAGS[tool] ?? MODE_FLAGS.gemini;
  if (tool === "codex") {
    const exe = findCodex();
    if (!exe) return null;
    return {
      command: exe,
      args: ["exec", "--skip-git-repo-check", ...modeFlags[mode], ...(m ? ["--model", m] : []), "--cd", cwd],
    };
  }
  // claude/gemini are npm .cmd shims on Windows, so a shell wrapper is required there;
  // every interpolated token is a fixed flag or safeModel-validated, never free text.
  const argv =
    tool === "claude-code"
      ? ["claude", "-p", ...modeFlags[mode], ...(m ? ["--model", m] : [])]
      : ["gemini", ...modeFlags[mode], ...(m ? ["-m", m] : []), "-p"];
  if (platform === "win32") {
    return { command: "powershell", args: ["-NoProfile", "-Command", argv.join(" ")] };
  }
  return { command: argv[0], args: argv.slice(1) };
}

export function spawnAgent(opts: SpawnOptions): ChildProcess | null {
  const model = safeModel(opts.model);
  const mode = opts.mode ?? DEFAULT_PERMISSION_MODE;
  const header =
    `\n=== connectr dispatch ${opts.tool}${model ? `:${model}` : ""} mode=${mode} @ ${new Date().toISOString()} ===\n` +
    (opts.model && !model ? `ignoring invalid model '${opts.model}'\n` : "");
  const cmd = buildCommand(opts.tool, opts.cwd, model ?? undefined, mode);
  if (!cmd) {
    fs.appendFileSync(opts.logFile, header + "codex not found: install codex CLI or fix CODEX_CLI_PATH\n");
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
  return child;
}

export function launchTicket(
  ticket: Ticket,
  cwd: string,
  runsDir: string,
  opts: { detach?: boolean; mode?: PermissionMode; planFile?: string } = {}
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
