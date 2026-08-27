import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve("dist/cli/index.js");

function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

describe("connectr tools --json", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-cli-"));

  it("emits parseable detection other programs can drive", () => {
    const out = JSON.parse(run(["tools", "--json"], cwd));
    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.permissionMode).toBe("auto");

    const byTool = Object.fromEntries(out.tools.map((t: { tool: string }) => [t.tool, t]));
    for (const id of ["claude-code", "codex", "gemini", "cursor", "kiro", "antigravity"]) {
      expect(byTool[id]).toBeDefined();
    }
    const claude = byTool["claude-code"];
    expect(claude.kind).toBe("dispatch");
    expect(typeof claude.installed).toBe("boolean");
    expect([true, false, null]).toContain(claude.signedIn);
    expect(claude.signInHint).toBe("claude");
    // participants sign in inside their own IDE, so we must not claim to know
    expect(byTool["cursor"].signedIn).toBeNull();
  });

  it("includes tools the project declared itself", () => {
    fs.mkdirSync(path.join(cwd, ".connectr"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".connectr", "config.json"),
      JSON.stringify({ tools: [{ id: "aider", bin: "aider", args: ["aider"], signInHint: "aider --login" }] })
    );
    const out = JSON.parse(run(["tools", "--json"], cwd));
    const aider = out.tools.find((t: { tool: string }) => t.tool === "aider");
    expect(aider).toBeDefined();
    expect(aider.signInHint).toBe("aider --login");
  });

  it("prints a readable table without --json", () => {
    const out = run(["tools"], cwd);
    expect(out).toContain("claude-code");
    expect(out).toContain("dispatch");
    expect(out).not.toContain("{");
  });
});
