import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_RULES } from "./routing.js";
import { findCodex, whereOnPath } from "./spawn.js";

export type ToolKind = "dispatch" | "participant";

export interface DetectedTool {
  tool: string;
  kind: ToolKind;
  installed: boolean;
  via: string;
  targetSlugs: string[]; // init targets to wire when this tool is selected
}

export function detectTools(): DetectedTool[] {
  const home = os.homedir();
  const hasDir = (...p: string[]) => fs.existsSync(path.join(home, ...p));
  return [
    { tool: "claude-code", kind: "dispatch", installed: !!whereOnPath("claude"), via: "claude on PATH", targetSlugs: ["claude", "claude-md"] },
    { tool: "codex", kind: "dispatch", installed: !!findCodex(), via: "codex CLI", targetSlugs: ["codex"] },
    { tool: "gemini", kind: "dispatch", installed: !!whereOnPath("gemini"), via: "gemini on PATH", targetSlugs: ["gemini-md", "gemini"] },
    { tool: "cursor", kind: "participant", installed: hasDir(".cursor"), via: "~/.cursor", targetSlugs: ["cursor", "cursor-rules"] },
    { tool: "kiro", kind: "participant", installed: hasDir(".kiro"), via: "~/.kiro", targetSlugs: ["kiro", "kiro-steering"] },
    { tool: "antigravity", kind: "participant", installed: hasDir(".gemini", "antigravity-ide"), via: "~/.gemini/antigravity-ide", targetSlugs: ["antigravity"] },
  ];
}

export interface OrchestraSuggestion {
  tool: string;
  kind: ToolKind;
  installed: boolean;
  suggested: boolean;
  reason: string;
}

// Terms that are routing signal in a short task title but generic English in a plan
// document ("Build a notes app", "test it well") - ignored when scanning plans.
const GENERIC_IN_PLANS = new Set(["build", "test"]);

// Rank tools for a project brief: dispatch tools by routing-rule hits in the plan text
// (the default tool is always in when installed), participant tools whenever installed.
export function suggestOrchestra(planText: string, detected: DetectedTool[]): OrchestraSuggestion[] {
  const hay = planText.toLowerCase();
  const hitsByTool = new Map<string, string[]>();
  for (const rule of DEFAULT_RULES) {
    const terms = rule.match.split("|").filter((t) => {
      if (GENERIC_IN_PLANS.has(t)) return false;
      try {
        return new RegExp(t, "i").test(hay);
      } catch {
        return false;
      }
    });
    if (terms.length > 0 && !hitsByTool.has(rule.tool)) hitsByTool.set(rule.tool, terms);
  }
  return detected.map((d) => {
    if (d.kind === "participant") {
      return {
        tool: d.tool,
        kind: d.kind,
        installed: d.installed,
        suggested: d.installed,
        reason: d.installed ? `installed (${d.via}) - joins the brain via MCP` : "not detected",
      };
    }
    const hits = hitsByTool.get(d.tool) ?? [];
    const suggested = d.installed && (hits.length > 0 || d.tool === "claude-code");
    const reason = !d.installed
      ? "not installed"
      : hits.length > 0
        ? `plan mentions: ${hits.slice(0, 4).join(", ")}`
        : d.tool === "claude-code"
          ? "default tool"
          : "installed, but no matching work in the plan";
    return { tool: d.tool, kind: d.kind, installed: d.installed, suggested, reason };
  });
}

export const PLAN_TEMPLATE = `# Project plan

## Goal
<one paragraph: what this project is and who it is for>

## Features
- <feature 1>
- <feature 2>

## Constraints
- <stack, budget, deadline, platforms>

## Out of scope
- <what NOT to build>
`;
