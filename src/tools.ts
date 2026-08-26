import type { PermissionMode } from "./routing.js";

// Every coding tool ConnectR can drive is a record, not a branch. Built-ins live here;
// users add their own in .connectr/config.json under "tools", so a new CLI needs no code.

export type ToolKind = "dispatch" | "participant";
export type PromptDelivery = "stdin" | "arg";

export interface ToolSpec {
  id: string;
  kind: ToolKind;
  /** Executable to look for on PATH. Omitted for participant tools. */
  bin?: string;
  /** Args template. Placeholders: {cwd} {model} {prompt} {mode}. */
  args?: string[];
  /** Extra args when a model is set; {model} is substituted. Dropped when no model. */
  modelArgs?: string[];
  /** Per-mode flags spliced in where {mode} appears (or appended if it doesn't). */
  modes?: Record<PermissionMode, string[]>;
  /** stdin (default) writes the prompt to the child; arg substitutes {prompt}. */
  prompt?: PromptDelivery;
  /** Home-relative directory whose presence means the tool is installed (participants). */
  homeDir?: string[];
  /**
   * Home-relative path to the file this tool writes when you sign in. ConnectR only ever
   * checks that it exists - it never reads it. Omit when a tool keeps credentials
   * somewhere we cannot check (an OS keychain), so readiness reports "unknown" instead of
   * claiming a sign-in state we do not actually know.
   */
  authFile?: string[];
  /** What to run to sign in, shown when credentials are missing. */
  signInHint?: string;
  /** `connectr init` targets to wire when this tool is selected. */
  targetSlugs?: string[];
  /** Set by loadConfig for tools declared by the user rather than shipped. */
  userDefined?: boolean;
}

const NO_MODES: Record<PermissionMode, string[]> = { safe: [], auto: [], yolo: [] };

// Verified against real installs on Windows. Anything not listed here can still be added
// by the user - see "Add another coding tool" in the README.
export const BUILTIN_TOOLS: ToolSpec[] = [
  {
    id: "claude-code",
    kind: "dispatch",
    bin: "claude",
    args: ["claude", "-p", "{mode}"],
    modelArgs: ["--model", "{model}"],
    modes: {
      // --allowedTools keeps the shared-brain protocol working when everything else is
      // gated; without it a headless -p run silently denies ticket and memory calls.
      safe: ["--allowedTools", "mcp__connectr"],
      auto: ["--permission-mode", "acceptEdits", "--allowedTools", "mcp__connectr"],
      yolo: ["--dangerously-skip-permissions"],
    },
    authFile: [".claude", ".credentials.json"],
    signInHint: "claude",
    targetSlugs: ["claude", "claude-md"],
  },
  {
    id: "codex",
    kind: "dispatch",
    bin: "codex",
    args: ["codex", "exec", "--skip-git-repo-check", "{mode}", "--cd", "{cwd}"],
    modelArgs: ["--model", "{model}"],
    modes: {
      safe: ["--sandbox", "read-only"],
      auto: ["--full-auto"],
      yolo: ["--dangerously-bypass-approvals-and-sandbox"],
    },
    authFile: [".codex", "auth.json"],
    signInHint: "codex login",
    targetSlugs: ["codex"],
  },
  {
    id: "gemini",
    kind: "dispatch",
    bin: "gemini",
    args: ["gemini", "{mode}", "-p"],
    modelArgs: ["-m", "{model}"],
    modes: {
      safe: ["--approval-mode", "default"],
      auto: ["--approval-mode", "auto_edit"],
      yolo: ["--approval-mode", "yolo"],
    },
    authFile: [".gemini", "oauth_creds.json"],
    signInHint: "gemini",
    targetSlugs: ["gemini-md", "gemini"],
  },
  { id: "cursor", kind: "participant", homeDir: [".cursor"], targetSlugs: ["cursor", "cursor-rules"] },
  { id: "kiro", kind: "participant", homeDir: [".kiro"], targetSlugs: ["kiro", "kiro-steering"] },
  {
    id: "antigravity",
    kind: "participant",
    homeDir: [".gemini", "antigravity-ide"],
    targetSlugs: ["antigravity"],
  },
];

export function normalizeToolSpec(raw: unknown): ToolSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return null;
  const kind: ToolKind = r.kind === "participant" ? "participant" : "dispatch";
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  const modes = ((): Record<PermissionMode, string[]> | undefined => {
    if (!r.modes || typeof r.modes !== "object") return undefined;
    const m = r.modes as Record<string, unknown>;
    return {
      safe: strings(m.safe) ?? [],
      auto: strings(m.auto) ?? [],
      yolo: strings(m.yolo) ?? [],
    };
  })();
  return {
    id: r.id.trim(),
    kind,
    bin: typeof r.bin === "string" ? r.bin : undefined,
    args: strings(r.args),
    modelArgs: strings(r.modelArgs),
    modes,
    prompt: r.prompt === "arg" ? "arg" : "stdin",
    homeDir: strings(r.homeDir),
    authFile: strings(r.authFile),
    signInHint: typeof r.signInHint === "string" ? r.signInHint : undefined,
    targetSlugs: strings(r.targetSlugs),
    userDefined: true,
  };
}

/** Built-ins plus user-declared tools; a user tool with a built-in id replaces it. */
export function toolRegistry(userTools: ToolSpec[] = []): ToolSpec[] {
  const byId = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]));
  for (const t of userTools) byId.set(t.id, t);
  return [...byId.values()];
}

export function findTool(id: string, userTools: ToolSpec[] = []): ToolSpec | null {
  return toolRegistry(userTools).find((t) => t.id === id) ?? null;
}

export interface ResolvedArgs {
  argv: string[];
  promptDelivery: PromptDelivery;
}

/** Expand a spec's template into a concrete argv. Unfilled placeholders are dropped. */
export function expandArgs(
  spec: ToolSpec,
  vars: { cwd: string; model?: string; prompt: string; mode: PermissionMode }
): ResolvedArgs {
  const modeFlags = spec.modes?.[vars.mode] ?? [];
  const modelArgs = vars.model ? (spec.modelArgs ?? []).map((a) => a.replace("{model}", vars.model!)) : [];
  const out: string[] = [];
  let sawMode = false;
  for (const token of spec.args ?? []) {
    if (token === "{mode}") {
      sawMode = true;
      out.push(...modeFlags, ...modelArgs);
      continue;
    }
    if (token === "{model}") {
      if (vars.model) out.push(vars.model);
      continue;
    }
    out.push(token.replace("{cwd}", vars.cwd).replace("{prompt}", vars.prompt));
  }
  // A spec with no {mode} slot still gets its flags - appended after the fixed args.
  if (!sawMode) out.push(...modeFlags, ...modelArgs);
  return { argv: out, promptDelivery: spec.prompt ?? "stdin" };
}
