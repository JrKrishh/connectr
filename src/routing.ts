import fs from "node:fs";
import path from "node:path";
import { normalizeToolSpec, type ToolSpec } from "./tools.js";

export interface RoutingRule {
  match: string;
  tool: string;
}

/** Ids that always exist; the live list comes from the tool registry (see src/tools.ts). */
export const KNOWN_TOOLS = ["claude-code", "codex", "gemini"];

export interface ParsedTaskInput {
  title: string;
  tool?: string;
  model?: string;
  error?: string;
}

// "fix auth flow @codex:gpt-5-codex" -> manual assignment; no @suffix -> auto-route.
export function parseTaskInput(raw: string): ParsedTaskInput {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.*\S)\s+@([A-Za-z][\w-]*)(?::([\w.:/-]+))?$/);
  if (!m) return { title: trimmed };
  const [, title, tool, model] = m;
  if (!KNOWN_TOOLS.includes(tool)) {
    return { title: trimmed, error: `unknown tool '@${tool}' - use @claude-code, @codex or @gemini` };
  }
  return { title: title.trim(), tool, model };
}

export type PermissionMode = "safe" | "auto" | "yolo";
export type Isolation = "off" | "worktree";

export const ISOLATIONS: Isolation[] = ["off", "worktree"];
export const DEFAULT_ISOLATION: Isolation = "off";

export const PERMISSION_MODES: PermissionMode[] = ["safe", "auto", "yolo"];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

export interface ConnectrConfig {
  routing: {
    rules: RoutingRule[];
    defaultTool: string;
  };
  permissionMode: PermissionMode;
  /** "worktree" gives each dispatched ticket its own git worktree and branch. */
  isolation: Isolation;
  tools?: string[]; // orchestra selected at `connectr new` (informational)
  planFile?: string; // project brief injected into dispatched agents' prompts
  toolSpecs?: ToolSpec[]; // extra coding tools declared by the user (config "tools" array of objects)
}

export const DEFAULT_RULES: RoutingRule[] = [
  { match: "backend|api|database|schema|refactor|architect|logic|security|auth|server|optimiz", tool: "claude-code" },
  { match: "cli|script|automation|data|migrat|pipeline|tooling|build|test|scrape|crawl", tool: "codex" },
  { match: "docs|readme|research|explain|writing|content|article|blog|summari", tool: "gemini" },
];

export const DEFAULT_TOOL = "claude-code";

export function configPath(root: string): string {
  return path.join(root, ".connectr", "config.json");
}

export function loadConfig(root: string): ConnectrConfig {
  const p = configPath(root);
  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return {
        routing: {
          rules: Array.isArray(raw?.routing?.rules) ? raw.routing.rules : [],
          defaultTool: typeof raw?.routing?.defaultTool === "string" ? raw.routing.defaultTool : DEFAULT_TOOL,
        },
        permissionMode: PERMISSION_MODES.includes(raw?.permissionMode) ? raw.permissionMode : DEFAULT_PERMISSION_MODE,
        isolation: ISOLATIONS.includes(raw?.isolation) ? raw.isolation : DEFAULT_ISOLATION,
        // "tools" holds either selected ids (strings) or full tool declarations (objects),
        // so one key covers both "which tools this project uses" and "here's a new tool".
        ...(Array.isArray(raw?.tools) ? { tools: raw.tools.filter((t: unknown) => typeof t === "string") } : {}),
        ...(Array.isArray(raw?.tools)
          ? { toolSpecs: raw.tools.map(normalizeToolSpec).filter((t: ToolSpec | null): t is ToolSpec => t !== null) }
          : {}),
        ...(typeof raw?.planFile === "string" ? { planFile: raw.planFile } : {}),
      };
    } catch {
      /* corrupt config falls through to defaults */
    }
  }
  return { routing: { rules: [], defaultTool: DEFAULT_TOOL }, permissionMode: DEFAULT_PERMISSION_MODE, isolation: DEFAULT_ISOLATION };
}

export function saveConfig(root: string, config: ConnectrConfig): void {
  fs.mkdirSync(path.join(root, ".connectr"), { recursive: true });
  fs.writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n");
}

export function effectiveRules(config: ConnectrConfig): RoutingRule[] {
  return [...config.routing.rules, ...DEFAULT_RULES];
}

// How much of a rule the text actually supports: one point per distinct alternation term
// that appears. A rule written as a single grouped regex still scores 1 when it matches.
function scoreRule(rule: RoutingRule, hay: string): number {
  let hits = 0;
  for (const term of rule.match.split("|")) {
    if (!term) continue;
    try {
      if (new RegExp(term, "i").test(hay)) hits++;
    } catch {
      /* bad user regex - skip */
    }
  }
  if (hits === 0) {
    try {
      if (new RegExp(rule.match, "i").test(hay)) hits = 1;
    } catch {
      /* bad user regex - skip */
    }
  }
  return hits;
}

// User rules win outright when any of them matches; within a group the best-supported rule
// wins, so a passing mention ("build") cannot outvote the real subject ("docs", "readme").
export function matchRule(text: string, config: ConnectrConfig): RoutingRule | null {
  const hay = text.toLowerCase();
  for (const group of [config.routing.rules, DEFAULT_RULES]) {
    let best: RoutingRule | null = null;
    let bestScore = 0;
    for (const rule of group) {
      const score = scoreRule(rule, hay);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return null;
}

export function resolveTool(
  text: string,
  config: ConnectrConfig = { routing: { rules: [], defaultTool: DEFAULT_TOOL }, permissionMode: DEFAULT_PERMISSION_MODE, isolation: DEFAULT_ISOLATION }
): string {
  return matchRule(text, config)?.tool ?? config.routing.defaultTool;
}
