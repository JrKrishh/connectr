import fs from "node:fs";
import path from "node:path";

export interface RoutingRule {
  match: string;
  tool: string;
}

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

export const PERMISSION_MODES: PermissionMode[] = ["safe", "auto", "yolo"];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

export interface ConnectrConfig {
  routing: {
    rules: RoutingRule[];
    defaultTool: string;
  };
  permissionMode: PermissionMode;
  tools?: string[]; // orchestra selected at `connectr new` (informational)
  planFile?: string; // project brief injected into dispatched agents' prompts
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
        ...(Array.isArray(raw?.tools) ? { tools: raw.tools.filter((t: unknown) => typeof t === "string") } : {}),
        ...(typeof raw?.planFile === "string" ? { planFile: raw.planFile } : {}),
      };
    } catch {
      /* corrupt config falls through to defaults */
    }
  }
  return { routing: { rules: [], defaultTool: DEFAULT_TOOL }, permissionMode: DEFAULT_PERMISSION_MODE };
}

export function saveConfig(root: string, config: ConnectrConfig): void {
  fs.mkdirSync(path.join(root, ".connectr"), { recursive: true });
  fs.writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n");
}

export function effectiveRules(config: ConnectrConfig): RoutingRule[] {
  return [...config.routing.rules, ...DEFAULT_RULES];
}

export function resolveTool(
  text: string,
  config: ConnectrConfig = { routing: { rules: [], defaultTool: DEFAULT_TOOL }, permissionMode: DEFAULT_PERMISSION_MODE }
): string {
  const hay = text.toLowerCase();
  for (const rule of effectiveRules(config)) {
    try {
      if (new RegExp(rule.match, "i").test(hay)) return rule.tool;
    } catch {
      /* bad user regex - skip */
    }
  }
  return config.routing.defaultTool;
}
