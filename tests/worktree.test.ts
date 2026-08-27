import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BRANCH_PREFIX,
  branchFor,
  copyWiring,
  createWorktree,
  isGitRepo,
  listWorktrees,
  mergeWorktree,
  realChanges,
  removeWorktree,
  worktreePath,
} from "../src/worktree.js";

const made: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A real repo - worktrees are the one thing that cannot be faked. */
function repo(): { root: string; store: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-wt-"));
  made.push(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "app.js"), "console.log(1)\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);
  const store = path.join(root, ".connectr");
  fs.mkdirSync(store, { recursive: true });
  return { root, store };
}

afterAll(() => {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* windows sometimes holds a handle; the temp dir will be cleaned up anyway */
    }
  }
});

describe("isolation preconditions", () => {
  it("detects a git repo and refuses to pretend elsewhere", () => {
    const { root } = repo();
    expect(isGitRepo(root)).toBe(true);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-plain-"));
    made.push(plain);
    expect(isGitRepo(plain)).toBe(false);
    // dispatch must be able to fall back rather than crash
    expect(createWorktree(plain, path.join(plain, ".connectr"), "t1")).toEqual({
      worktree: null,
      reason: "not a git repository",
    });
  });
});

describe("createWorktree", () => {
  it("gives the ticket a private checkout on its own branch", () => {
    const { root, store } = repo();
    const { worktree } = createWorktree(root, store, "t1");
    expect(worktree).not.toBeNull();
    expect(worktree!.branch).toBe(BRANCH_PREFIX + "t1");
    expect(fs.existsSync(path.join(worktree!.path, "app.js"))).toBe(true);
    // edits in the worktree must not touch the main tree
    fs.writeFileSync(path.join(worktree!.path, "app.js"), "console.log(2)\n");
    expect(fs.readFileSync(path.join(root, "app.js"), "utf8")).toBe("console.log(1)\n");
  });

  it("carries the gitignored wiring across, or the agent loses the shared brain", () => {
    const { root, store } = repo();
    // exactly the files `connectr init` writes that git never tracks
    fs.writeFileSync(path.join(root, ".mcp.json"), '{"mcpServers":{"connectr":{}}}');
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "protocol");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{}");

    const { worktree, wiring } = createWorktree(root, store, "t2");
    expect(wiring).toContain(".mcp.json");
    expect(fs.existsSync(path.join(worktree!.path, ".mcp.json"))).toBe(true);
    expect(fs.readFileSync(path.join(worktree!.path, "CLAUDE.md"), "utf8")).toBe("protocol");
    expect(fs.existsSync(path.join(worktree!.path, ".claude", "settings.json"))).toBe(true);
  });

  it("reuses the existing tree when a ticket is dispatched again", () => {
    const { root, store } = repo();
    const first = createWorktree(root, store, "t3").worktree!;
    fs.writeFileSync(path.join(first.path, "scratch.txt"), "in progress");
    const again = createWorktree(root, store, "t3").worktree!;
    expect(again.path).toBe(first.path);
    expect(fs.readFileSync(path.join(again.path, "scratch.txt"), "utf8")).toBe("in progress");
  });

  it("copyWiring skips what is not there", () => {
    const { root, store } = repo();
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-dest-"));
    made.push(dest);
    expect(copyWiring(root, dest)).toEqual([]);
    expect(worktreePath(store, "t9").endsWith(path.join("trees", "t9"))).toBe(true);
    expect(branchFor("t9")).toBe("connectr/t9");
  });
});

describe("listWorktrees", () => {
  it("reports what is waiting in each tree", () => {
    const { root, store } = repo();
    const a = createWorktree(root, store, "t1").worktree!;
    createWorktree(root, store, "t2");

    // t1: one commit, clean. t2: nothing.
    fs.writeFileSync(path.join(a.path, "app.js"), "console.log('a')\n");
    git(a.path, ["add", "-A"]);
    git(a.path, ["commit", "-m", "work"]);

    const byTicket = Object.fromEntries(listWorktrees(root, store).map((t) => [t.ticket, t]));
    expect(byTicket["t1"].commits).toBe(1);
    expect(byTicket["t1"].dirty).toBe(false);
    expect(byTicket["t2"].commits).toBe(0);

    // uncommitted work is visible, so nothing gets silently thrown away
    fs.writeFileSync(path.join(a.path, "app.js"), "console.log('dirty')\n");
    expect(listWorktrees(root, store).find((t) => t.ticket === "t1")!.dirty).toBe(true);
  });
});

describe("mergeWorktree", () => {
  it("brings a ticket's commits back and cleans up after itself", () => {
    const { root, store } = repo();
    const wt = createWorktree(root, store, "t1").worktree!;
    fs.writeFileSync(path.join(wt.path, "feature.js"), "export const x = 1\n");
    git(wt.path, ["add", "-A"]);
    git(wt.path, ["commit", "-m", "add feature"]);

    const r = mergeWorktree(root, store, "t1", { remove: true });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("merged 1 commit");
    expect(fs.existsSync(path.join(root, "feature.js"))).toBe(true);
    expect(fs.existsSync(wt.path)).toBe(false);
    expect(listWorktrees(root, store)).toHaveLength(0);
  });

  it("refuses rather than risking uncommitted agent work", () => {
    const { root, store } = repo();
    const wt = createWorktree(root, store, "t1").worktree!;
    fs.writeFileSync(path.join(wt.path, "half-done.js"), "wip");

    const r = mergeWorktree(root, store, "t1");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("uncommitted changes in its worktree");
    expect(fs.existsSync(wt.path)).toBe(true); // nothing destroyed
  });

  it("refuses when your own tree is dirty, so a merge cannot mix with work in progress", () => {
    const { root, store } = repo();
    const wt = createWorktree(root, store, "t1").worktree!;
    fs.writeFileSync(path.join(wt.path, "f.js"), "1");
    git(wt.path, ["add", "-A"]);
    git(wt.path, ["commit", "-m", "w"]);
    fs.writeFileSync(path.join(root, "app.js"), "local edit\n");

    const r = mergeWorktree(root, store, "t1");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("your working tree has uncommitted changes");
  });

  it("says so plainly when there is nothing to merge, and when the branch never existed", () => {
    const { root, store } = repo();
    createWorktree(root, store, "t1");
    expect(mergeWorktree(root, store, "t1").message).toContain("no commits to merge");
    expect(mergeWorktree(root, store, "t99").ok).toBe(false);
    expect(mergeWorktree(root, store, "t99").message).toContain("no branch connectr/t99");
  });
});

describe("two agents that changed the same file", () => {
  it("keeps both versions and names the conflict instead of losing one", () => {
    const { root, store } = repo();
    for (const [ticket, line] of [["t1", "export const subtract = 1\n"], ["t2", "export const multiply = 2\n"]]) {
      const wt = createWorktree(root, store, ticket).worktree!;
      fs.writeFileSync(path.join(wt.path, "app.js"), line);
      git(wt.path, ["add", "-A"]);
      git(wt.path, ["commit", "-m", `${ticket} work`]);
    }
    expect(mergeWorktree(root, store, "t1", { remove: true }).ok).toBe(true);

    const second = mergeWorktree(root, store, "t2");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("app.js");
    expect(second.message).toContain("both versions are safe");

    // the mid-merge state must be reported honestly, not as "uncommitted changes"
    expect(mergeWorktree(root, store, "t2").message).toContain("middle of a merge");
    git(root, ["merge", "--abort"]);
    // t2's work still exists after aborting - nothing was destroyed
    expect(listWorktrees(root, store).find((t) => t.ticket === "t2")!.commits).toBe(1);
  });
});

describe("what counts as dirty", () => {
  it("ignores the wiring ConnectR copied in, including whole untracked dirs", () => {
    const { root, store } = repo();
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "protocol");
    fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "rules", "connectr.mdc"), "rules");
    const wt = createWorktree(root, store, "t1").worktree!;

    // git reports ".cursor/" as one untracked directory, not its contents - the exact
    // reason a naive path match left every merge blocked.
    expect(realChanges(wt.path)).toEqual([]);
    expect(listWorktrees(root, store)[0].dirty).toBe(false);
    expect(mergeWorktree(root, store, "t1").message).toContain("no commits to merge");
  });

  it("still counts real agent work in those directories", () => {
    const { root, store } = repo();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "tracked.txt"), "v1");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "track a cursor file"]);

    const wt = createWorktree(root, store, "t1").worktree!;
    fs.writeFileSync(path.join(wt.path, ".cursor", "tracked.txt"), "agent edited this");
    expect(realChanges(wt.path)).toContain(".cursor/tracked.txt");
    expect(listWorktrees(root, store)[0].dirty).toBe(true);
  });
});

describe("removeWorktree", () => {
  it("removes a tree it made and reports when there is nothing to remove", () => {
    const { root, store } = repo();
    createWorktree(root, store, "t1");
    expect(removeWorktree(root, store, "t1", true)).toBe(true);
    expect(removeWorktree(root, store, "t1", true)).toBe(false);
  });
});
