import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/routing.js";
import { buildCommand, toolKnown } from "../src/spawn.js";
import { BUILTIN_TOOLS, expandArgs, findTool, normalizeToolSpec, toolRegistry } from "../src/tools.js";

// A user adding OpenCode without touching ConnectR's source.
const OPENCODE = {
  id: "opencode",
  kind: "dispatch",
  bin: "opencode",
  args: ["opencode", "run", "{mode}", "{prompt}"],
  modelArgs: ["--model", "{model}"],
  modes: { safe: [], auto: [], yolo: ["--yolo"] },
  prompt: "arg",
};

describe("normalizeToolSpec", () => {
  it("accepts a declaration and marks it user-defined", () => {
    const spec = normalizeToolSpec(OPENCODE)!;
    expect(spec).toMatchObject({ id: "opencode", kind: "dispatch", bin: "opencode", prompt: "arg", userDefined: true });
    expect(spec.modes!.yolo).toEqual(["--yolo"]);
  });

  it("defaults sensibly and rejects junk", () => {
    const spec = normalizeToolSpec({ id: "minimal" })!;
    expect(spec.kind).toBe("dispatch");
    expect(spec.prompt).toBe("stdin");
    for (const bad of [null, "opencode", {}, { id: "  " }, { kind: "dispatch" }]) {
      expect(normalizeToolSpec(bad)).toBeNull();
    }
  });
});

describe("toolRegistry", () => {
  it("adds user tools alongside the built-ins", () => {
    const reg = toolRegistry([normalizeToolSpec(OPENCODE)!]);
    expect(reg.map((t) => t.id)).toContain("opencode");
    expect(reg.length).toBe(BUILTIN_TOOLS.length + 1);
    expect(toolKnown("opencode", [normalizeToolSpec(OPENCODE)!])).toBe(true);
    expect(toolKnown("opencode")).toBe(false);
  });

  it("lets a user declaration replace a built-in of the same id", () => {
    const override = normalizeToolSpec({ id: "gemini", bin: "gemini", args: ["gemini", "--custom"] })!;
    expect(findTool("gemini", [override])!.args).toEqual(["gemini", "--custom"]);
    expect(toolRegistry([override]).length).toBe(BUILTIN_TOOLS.length);
  });

  it("does not treat participant tools as dispatchable", () => {
    expect(toolKnown("cursor")).toBe(false);
    expect(buildCommand("cursor", ".")).toBeNull();
  });
});

describe("expandArgs", () => {
  const spec = normalizeToolSpec(OPENCODE)!;

  it("substitutes mode, model and prompt in place", () => {
    const { argv, promptDelivery } = expandArgs(spec, { cwd: "/repo", model: "sonnet", prompt: "do the thing", mode: "yolo" });
    expect(argv).toEqual(["opencode", "run", "--yolo", "--model", "sonnet", "do the thing"]);
    expect(promptDelivery).toBe("arg");
  });

  it("drops model args when no model is set", () => {
    const { argv } = expandArgs(spec, { cwd: "/repo", prompt: "hi", mode: "auto" });
    expect(argv).toEqual(["opencode", "run", "hi"]);
  });

  it("appends flags when the template has no {mode} slot", () => {
    const noSlot = normalizeToolSpec({ id: "x", bin: "x", args: ["x", "go"], modes: { safe: [], auto: ["--auto"], yolo: [] } })!;
    expect(expandArgs(noSlot, { cwd: ".", prompt: "", mode: "auto" }).argv).toEqual(["x", "go", "--auto"]);
  });
});

describe("buildCommand with a user-defined tool", () => {
  const userTools = [normalizeToolSpec(OPENCODE)!];

  it("spawns argv directly on POSIX", () => {
    const cmd = buildCommand("opencode", "/repo", "sonnet", "yolo", "linux", { userTools, prompt: "build it" })!;
    expect(cmd.command).toBe("opencode");
    expect(cmd.args).toEqual(["run", "--yolo", "--model", "sonnet", "build it"]);
  });

  it("returns null for an unknown tool", () => {
    expect(buildCommand("opencode", "/repo", undefined, "auto", "linux")).toBeNull();
  });

  it("never joins an arg-delivered prompt into a shell string on Windows", () => {
    // Resolution can fail on a machine without the tool; either way the powershell
    // string path (which would corrupt quoted free text) must not be used.
    const cmd = buildCommand("opencode", "C:\\repo", undefined, "auto", "win32", { userTools, prompt: 'a "quoted" prompt' });
    if (cmd) {
      expect(cmd.command.toLowerCase()).toContain("cmd");
      expect(cmd.args.slice(0, 2)).toEqual(["/d", "/c"]);
      expect(cmd.args).toContain('a "quoted" prompt');
    } else {
      expect(cmd).toBeNull(); // opencode not installed here
    }
  });
});

describe("config-declared tools", () => {
  it("loads tool objects from .connectr/config.json while keeping selected ids", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-tools-"));
    fs.mkdirSync(path.join(dir, ".connectr"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".connectr", "config.json"),
      JSON.stringify({ tools: ["claude-code", OPENCODE] })
    );
    const config = loadConfig(dir);
    expect(config.tools).toEqual(["claude-code"]); // selected ids
    expect(config.toolSpecs!.map((t) => t.id)).toEqual(["opencode"]); // declarations
    expect(toolKnown("opencode", config.toolSpecs)).toBe(true);
  });
});
