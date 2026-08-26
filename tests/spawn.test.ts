import { describe, expect, it } from "vitest";
import { buildCommand, findCodex, harnessPrompt, safeModel } from "../src/spawn.js";

describe("harnessPrompt", () => {
  const ticket = { id: "t1", title: "add auth", desc: "jwt login" };

  it("points the agent at the project brief when one is configured", () => {
    expect(harnessPrompt(ticket, "codex", ".", "PLAN.md")).toContain("Project brief: read PLAN.md");
    expect(harnessPrompt(ticket, "codex", ".")).not.toContain("Project brief");
  });
});

describe("safeModel", () => {
  it("passes plain model ids through", () => {
    for (const m of ["claude-opus-4-5", "sonnet", "gpt-5-codex", "gemini-2.5-pro", "us.anthropic.claude-v2:1"]) {
      expect(safeModel(m)).toBe(m);
    }
  });

  it("rejects anything that could break the shell command string", () => {
    for (const m of ["bad model", "x; rm -rf /", "a`b", "$(hack)", "'quoted'", ""]) {
      expect(safeModel(m)).toBeNull();
    }
    expect(safeModel(undefined)).toBeNull();
  });
});

describe("buildCommand", () => {
  it("passes the model to claude-code via --model", () => {
    const cmd = buildCommand("claude-code", "E:\\proj", "opus")!;
    expect(cmd.command).toBe("powershell");
    expect(cmd.args.at(-1)).toContain("claude -p");
    expect(cmd.args.at(-1)).toContain("--model opus");
  });

  it("omits --model when no model is set or the model is invalid", () => {
    expect(buildCommand("claude-code", ".")!.args.at(-1)).not.toContain("--model");
    expect(buildCommand("claude-code", ".", "bad model")!.args.at(-1)).not.toContain("--model");
  });

  it("passes the model to gemini via -m, keeping -p last for the stdin prompt", () => {
    const cmd = buildCommand("gemini", ".", "gemini-2.5-pro")!;
    expect(cmd.args.at(-1)).toContain("-m gemini-2.5-pro");
    expect(cmd.args.at(-1)!.trimEnd().endsWith("-p")).toBe(true);
  });

  it("passes the model to codex via --model when codex is installed", () => {
    const cmd = buildCommand("codex", "E:\\proj", "gpt-5-codex");
    if (findCodex() === null) {
      expect(cmd).toBeNull();
    } else {
      expect(cmd!.args).toContain("--model");
      expect(cmd!.args).toContain("gpt-5-codex");
      expect(cmd!.args.indexOf("--cd")).toBeGreaterThan(cmd!.args.indexOf("--model"));
    }
  });
});

describe("permission modes", () => {
  const shellArg = (tool: string, mode: "safe" | "auto" | "yolo") =>
    buildCommand(tool, ".", undefined, mode, "win32")!.args.at(-1)!;

  it("defaults to auto - no bypass flags anywhere", () => {
    expect(buildCommand("claude-code", ".", undefined, undefined, "win32")!.args.at(-1)).toContain(
      "--permission-mode acceptEdits"
    );
    expect(shellArg("claude-code", "auto")).not.toContain("dangerously");
    expect(shellArg("gemini", "auto")).toContain("--approval-mode auto_edit");
  });

  it("safe blocks writes but keeps brain access, yolo restores the old bypass behavior", () => {
    expect(shellArg("claude-code", "safe")).toBe("claude -p --allowedTools mcp__connectr");
    expect(shellArg("claude-code", "yolo")).toContain("--dangerously-skip-permissions");
    expect(shellArg("claude-code", "yolo")).not.toContain("--allowedTools");
    expect(shellArg("gemini", "safe")).toContain("--approval-mode default");
    expect(shellArg("gemini", "yolo")).toContain("--approval-mode yolo");
  });

  it("maps codex modes to sandbox flags when codex is installed", () => {
    if (findCodex() === null) return;
    const args = (mode: "safe" | "auto" | "yolo") => buildCommand("codex", ".", undefined, mode)!.args;
    expect(args("safe")).toContain("read-only");
    expect(args("auto")).toContain("--full-auto");
    expect(args("auto")).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args("yolo")).toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});

describe("cross-platform command shape", () => {
  it("POSIX spawns claude/gemini directly with an argv array", () => {
    const claude = buildCommand("claude-code", "/repo", "opus", "auto", "linux")!;
    expect(claude.command).toBe("claude");
    expect(claude.args).toEqual(["-p", "--permission-mode", "acceptEdits", "--allowedTools", "mcp__connectr", "--model", "opus"]);
    const gemini = buildCommand("gemini", "/repo", undefined, "yolo", "darwin")!;
    expect(gemini.command).toBe("gemini");
    expect(gemini.args).toEqual(["--approval-mode", "yolo", "-p"]);
  });

  it("Windows wraps claude/gemini in powershell for the .cmd shims", () => {
    const cmd = buildCommand("claude-code", "C:\\repo", undefined, "auto", "win32")!;
    expect(cmd.command).toBe("powershell");
    expect(cmd.args[0]).toBe("-NoProfile");
  });
});
