import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_SCRIPT = path.resolve(__dirname, "../server/index.js");

export function serverCommand(): { command: string; args: string[] } {
  return { command: process.execPath, args: [SERVER_SCRIPT] };
}

export const MARK_START = "<!-- CONNECTR:START -->";
export const MARK_END = "<!-- CONNECTR:END -->";

export const INSTRUCTIONS = `## ConnectR shared-agent protocol (managed by connectr init)

This project is worked on by multiple AI agents sharing one brain via the "connectr" MCP server.
Before starting any task: call board_view to see open work, and recall for prior decisions.
Claim before build: ticket_create then ticket_claim before writing any code - this prevents duplicate work.
Remember durable decisions and facts with remember; search shared memory with recall before assuming.
Before editing files other agents might touch, claim_files them; call release_files when done.
Post evidence (test output, commit SHAs) with ticket_update; finish with ticket_close + resolution.
When something fails (command error, broken test, wrong assumption), store it with remember kind='lesson':
what happened + root cause in text, the corrective action in fix. Before retrying a failure or starting
risky work, recall kind='lesson' so you never repeat a mistake another agent already paid for.`;

export type EditKind = "json-mcp" | "toml-mcp" | "md-block" | "md-file";

export interface Edit {
  file: string;
  kind: EditKind;
  label: string;
}

export interface ToolTarget {
  slug: string;
  label: string;
  scope: "project" | "global";
  edits(): Edit[];
}

function project(...p: string[]): string {
  return path.resolve(path.join(...p));
}

function jsonMcpEntry(): Record<string, unknown> {
  const { command, args } = serverCommand();
  return { command, args, env: {} };
}

function readJson(file: string): any {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function applyJsonMcp(file: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = readJson(file);
  data.mcpServers = data.mcpServers ?? {};
  const entry = jsonMcpEntry();
  const prev = JSON.stringify(data.mcpServers.connectr ?? null);
  if (prev === JSON.stringify(entry)) return false;
  data.mcpServers.connectr = entry;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return true;
}

function applyTomlMcp(file: string): boolean {
  const { command, args } = serverCommand();
  const section = [
    "[mcp_servers.connectr]",
    `command = '${command.replace(/'/g, "''")}'`,
    `args = [${args.map((a) => `'${a.replace(/'/g, "''")}'`).join(", ")}]`,
    "",
  ].join("\n");
  let content = "";
  if (fs.existsSync(file)) content = fs.readFileSync(file, "utf8");
  const re = /\[mcp_servers\.connectr\][\s\S]*?(?=\n\[|\n*$)/;
  if (re.test(content)) {
    const next = content.replace(re, section.trimEnd());
    if (next === content) return false;
    fs.writeFileSync(file, next);
    return true;
  }
  const sep = content.endsWith("\n") || content === "" ? "" : "\n";
  fs.writeFileSync(file, `${content}${sep}\n${section}`);
  return true;
}

function applyMdBlock(file: string): boolean {
  const block = `${MARK_START}\n${INSTRUCTIONS}\n${MARK_END}`;
  let content = "";
  if (fs.existsSync(file)) content = fs.readFileSync(file, "utf8");
  const startIdx = content.indexOf(MARK_START);
  const endIdx = content.indexOf(MARK_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const next = content.slice(0, startIdx) + block + content.slice(endIdx + MARK_END.length);
    if (next === content) return false;
    fs.writeFileSync(file, next);
    return true;
  }
  if (content.includes("ConnectR shared-agent protocol")) {
    // stale fragment without full markers - append canonical block anyway
  }
  const sep = content.trimEnd().length === 0 ? "" : "\n\n";
  fs.writeFileSync(file, `${content.trimEnd()}${sep}${block}\n`);
  return true;
}

const MDC_FRONTMATTER = `---
description: ConnectR multi-agent coordination protocol
alwaysApply: true
---\n`;

function applyMdFile(file: string, content: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.writeFileSync(file, content);
  return true;
}

export function applyEdit(edit: Edit): boolean {
  switch (edit.kind) {
    case "json-mcp":
      return applyJsonMcp(edit.file);
    case "toml-mcp":
      return applyTomlMcp(edit.file);
    case "md-block":
      return applyMdBlock(edit.file);
    case "md-file": {
      const body = edit.file.endsWith(".mdc") ? MDC_FRONTMATTER + INSTRUCTIONS + "\n" : INSTRUCTIONS + "\n";
      return applyMdFile(edit.file, body);
    }
  }
}

export function hasConnectr(edit: Edit): boolean {
  try {
    if (edit.kind === "json-mcp") {
      return !!readJson(edit.file)?.mcpServers?.connectr;
    }
    if (!fs.existsSync(edit.file)) return false;
    const c = fs.readFileSync(edit.file, "utf8");
    if (edit.kind === "toml-mcp") return /\[mcp_servers\.connectr\]/.test(c);
    return c.includes(MARK_START) || c.includes("ConnectR shared-agent protocol");
  } catch {
    return false;
  }
}

const home = os.homedir();

export const PROJECT_TARGETS: ToolTarget[] = [
  {
    slug: "claude",
    label: "Claude Code (.mcp.json)",
    scope: "project",
    edits: () => [{ file: project(".mcp.json"), kind: "json-mcp", label: "Claude Code MCP registration" }],
  },
  {
    slug: "claude-md",
    label: "CLAUDE.md protocol block",
    scope: "project",
    edits: () => [{ file: project("CLAUDE.md"), kind: "md-block", label: "Claude Code instructions" }],
  },
  {
    slug: "cursor",
    label: "Cursor (.cursor/mcp.json)",
    scope: "project",
    edits: () => [{ file: project(".cursor", "mcp.json"), kind: "json-mcp", label: "Cursor MCP registration" }],
  },
  {
    slug: "cursor-rules",
    label: "Cursor rules file",
    scope: "project",
    edits: () => [
      { file: project(".cursor", "rules", "connectr.mdc"), kind: "md-file", label: "Cursor agent rules" },
    ],
  },
  {
    slug: "kiro",
    label: "Kiro (.kiro/settings/mcp.json)",
    scope: "project",
    edits: () => [
      { file: project(".kiro", "settings", "mcp.json"), kind: "json-mcp", label: "Kiro MCP registration" },
    ],
  },
  {
    slug: "kiro-steering",
    label: "Kiro steering doc",
    scope: "project",
    edits: () => [
      { file: project(".kiro", "steering", "connectr.md"), kind: "md-file", label: "Kiro steering protocol" },
    ],
  },
  {
    slug: "agents-md",
    label: "AGENTS.md protocol block",
    scope: "project",
    edits: () => [{ file: project("AGENTS.md"), kind: "md-block", label: "AGENTS.md instructions" }],
  },
  {
    slug: "gemini-md",
    label: "GEMINI.md protocol block",
    scope: "project",
    edits: () => [{ file: project("GEMINI.md"), kind: "md-block", label: "Gemini CLI instructions" }],
  },
];

export const GLOBAL_TARGETS: ToolTarget[] = [
  {
    slug: "codex",
    label: "Codex (~/.codex/config.toml)",
    scope: "global",
    edits: () => [
      {
        file: path.join(home, ".codex", "config.toml"),
        kind: "toml-mcp",
        label: "Codex MCP registration",
      },
    ],
  },
  {
    slug: "gemini",
    label: "Gemini CLI (~/.gemini/settings.json)",
    scope: "global",
    edits: () => [
      {
        file: path.join(home, ".gemini", "settings.json"),
        kind: "json-mcp",
        label: "Gemini CLI MCP registration",
      },
    ],
  },
  {
    slug: "antigravity",
    label: "Antigravity (~/.gemini/antigravity-ide/mcp_config.json)",
    scope: "global",
    edits: () => [
      {
        file: path.join(home, ".gemini", "antigravity-ide", "mcp_config.json"),
        kind: "json-mcp",
        label: "Antigravity MCP registration",
      },
    ],
  },
];

export const ALL_TARGETS: ToolTarget[] = [...PROJECT_TARGETS, ...GLOBAL_TARGETS];
