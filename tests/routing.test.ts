import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL, effectiveRules, loadConfig, parseTaskInput, resolveTool, saveConfig } from "../src/routing.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("resolveTool", () => {
  it("routes backend/api work to claude-code", () => {
    expect(resolveTool("build the auth backend API")).toBe("claude-code");
    expect(resolveTool("refactor database schema")).toBe("claude-code");
  });

  it("routes cli/scripting/automation to codex", () => {
    expect(resolveTool("write a CLI migration script")).toBe("codex");
    expect(resolveTool("automate the test pipeline")).toBe("codex");
  });

  it("routes docs/research to gemini", () => {
    expect(resolveTool("write project docs and README")).toBe("gemini");
    expect(resolveTool("research the design landscape and summarize")).toBe("gemini");
  });

  it("falls back to the default tool", () => {
    expect(resolveTool("make the thing nicer")).toBe(DEFAULT_TOOL);
  });

  it("user rules take priority over defaults", () => {
    const config = {
      routing: {
        rules: [{ match: "make the thing", tool: "codex" }],
        defaultTool: "gemini",
      },
    };
    expect(resolveTool("make the thing nicer", config)).toBe("codex");
    expect(resolveTool("unrelated work", config)).toBe("gemini");
  });

  it("loadConfig tolerates missing and corrupt files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-cfg-"));
    expect(loadConfig(dir).routing.defaultTool).toBe(DEFAULT_TOOL);
    fs.mkdirSync(path.join(dir, ".connectr"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".connectr", "config.json"), "{corrupt");
    expect(loadConfig(dir).routing.defaultTool).toBe(DEFAULT_TOOL);
  });

  it("permission mode defaults to auto, persists via saveConfig, rejects junk values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-mode-"));
    const config = loadConfig(dir);
    expect(config.permissionMode).toBe("auto");
    config.permissionMode = "yolo";
    saveConfig(dir, config);
    expect(loadConfig(dir).permissionMode).toBe("yolo");
    fs.writeFileSync(path.join(dir, ".connectr", "config.json"), JSON.stringify({ permissionMode: "rampage" }));
    expect(loadConfig(dir).permissionMode).toBe("auto");
  });

  it("effectiveRules puts user rules first", () => {
    const config = { routing: { rules: [{ match: "x", tool: "codex" }], defaultTool: DEFAULT_TOOL } };
    const rules = effectiveRules(config);
    expect(rules[0].match).toBe("x");
    expect(rules.length).toBeGreaterThan(3);
  });
});

describe("parseTaskInput", () => {
  it("plain titles stay plain", () => {
    expect(parseTaskInput("  fix the auth flow ")).toEqual({ title: "fix the auth flow" });
  });

  it("parses @tool and @tool:model suffixes", () => {
    expect(parseTaskInput("write docs @gemini")).toEqual({ title: "write docs", tool: "gemini", model: undefined });
    expect(parseTaskInput("migrate db @codex:gpt-5-codex")).toEqual({
      title: "migrate db",
      tool: "codex",
      model: "gpt-5-codex",
    });
  });

  it("rejects unknown tools with a helpful error", () => {
    const parsed = parseTaskInput("do the thing @vscode");
    expect(parsed.error).toContain("unknown tool '@vscode'");
    expect(parsed.tool).toBeUndefined();
  });

  it("does not treat mid-word @ (emails, handles) as an assignment", () => {
    expect(parseTaskInput("email user@codex about the launch")).toEqual({
      title: "email user@codex about the launch",
    });
  });
});
