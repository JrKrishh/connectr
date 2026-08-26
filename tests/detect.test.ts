import { describe, expect, it } from "vitest";
import { detectTools, suggestOrchestra, type DetectedTool } from "../src/detect.js";

function tool(name: string, kind: "dispatch" | "participant", installed: boolean): DetectedTool {
  return { tool: name, kind, installed, via: "test", targetSlugs: [] };
}

const ALL_INSTALLED = [
  tool("claude-code", "dispatch", true),
  tool("codex", "dispatch", true),
  tool("gemini", "dispatch", true),
  tool("cursor", "participant", true),
  tool("kiro", "participant", false),
];

describe("suggestOrchestra", () => {
  const plan = "# Notes app\n\nBuild a backend API with auth. Write user docs and a README.";

  it("suggests dispatch tools whose routing rules match the plan", () => {
    const byTool = Object.fromEntries(suggestOrchestra(plan, ALL_INSTALLED).map((s) => [s.tool, s]));
    expect(byTool["claude-code"].suggested).toBe(true); // backend/api/auth
    expect(byTool["claude-code"].reason).toContain("plan mentions");
    expect(byTool["gemini"].suggested).toBe(true); // docs/readme
    expect(byTool["codex"].suggested).toBe(false); // no cli/script work in the plan
    expect(byTool["codex"].reason).toContain("no matching work");
  });

  it("suggests codex when the plan has script/pipeline work", () => {
    const s = suggestOrchestra("automate a data pipeline with CLI scripts", ALL_INSTALLED);
    expect(s.find((x) => x.tool === "codex")!.suggested).toBe(true);
  });

  it("keeps the default tool in even when nothing matches", () => {
    const s = suggestOrchestra("make something nice", ALL_INSTALLED);
    const claude = s.find((x) => x.tool === "claude-code")!;
    expect(claude.suggested).toBe(true);
    expect(claude.reason).toBe("default tool");
  });

  it("never suggests tools that are not installed", () => {
    const s = suggestOrchestra("backend api docs cli", [tool("claude-code", "dispatch", false), tool("kiro", "participant", false)]);
    expect(s.every((x) => !x.suggested)).toBe(true);
    expect(s[0].reason).toBe("not installed");
  });

  it("suggests installed participant tools regardless of plan text", () => {
    const byTool = Object.fromEntries(suggestOrchestra(plan, ALL_INSTALLED).map((s) => [s.tool, s]));
    expect(byTool["cursor"].suggested).toBe(true);
    expect(byTool["cursor"].reason).toContain("joins the brain");
    expect(byTool["kiro"].suggested).toBe(false);
  });
});

describe("detectTools", () => {
  it("reports all six known tools with kinds and wiring targets", () => {
    const d = detectTools();
    expect(d.map((x) => x.tool)).toEqual(["claude-code", "codex", "gemini", "cursor", "kiro", "antigravity"]);
    expect(d.filter((x) => x.kind === "dispatch")).toHaveLength(3);
    expect(d.filter((x) => x.kind === "participant")).toHaveLength(3);
    for (const x of d) expect(typeof x.installed).toBe("boolean");
    expect(d.find((x) => x.tool === "cursor")!.targetSlugs).toContain("cursor-rules");
  });
});
