import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Isolation for parallel agents. claim_files only *warns* another agent off a path; two
// agents in one working tree can still clobber each other. A git worktree per ticket gives
// each agent a real private checkout on its own branch, and `connectr merge` brings it back.

export const BRANCH_PREFIX = "connectr/";

/**
 * A worktree is a fresh checkout, so anything git does not track is missing from it -
 * including the files `connectr init` writes. Without these copied across, a dispatched
 * agent has no MCP registration and no protocol, which quietly defeats the shared brain.
 */
export const WIRING_FILES = [
  ".mcp.json",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  path.join(".claude", "settings.json"),
  path.join(".cursor", "mcp.json"),
  path.join(".cursor", "rules", "connectr.mdc"),
  path.join(".kiro", "settings", "mcp.json"),
  path.join(".kiro", "steering", "connectr.md"),
];

export interface Worktree {
  ticket: string;
  path: string;
  branch: string;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitQuiet(root: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(root, args) };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return { ok: false, out: String(err.stderr ?? err.message ?? "") };
  }
}

export function isGitRepo(root: string): boolean {
  return gitQuiet(root, ["rev-parse", "--is-inside-work-tree"]).out.trim() === "true";
}

/**
 * Changes that are actually someone's work. ConnectR's own scaffolding is excluded: the
 * store holds the worktrees themselves, and the wiring files are copied into every tree
 * on purpose. Counting either would make a fresh worktree look dirty and block merges in
 * any repo that has not gitignored `.connectr/`.
 */
export function realChanges(dir: string): string[] {
  const ours = new Set(WIRING_FILES.map((f) => f.replace(/\\/g, "/")));
  // git reports an untracked *directory* as ".cursor/", never its contents, so matching
  // wiring files by exact path alone left those blocking every merge.
  const ourDirs = [".connectr/", ...new Set(WIRING_FILES.map((f) => f.replace(/\\/g, "/")).filter((f) => f.includes("/")).map((f) => f.slice(0, f.indexOf("/") + 1)))];

  return gitQuiet(dir, ["status", "--porcelain"]).out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3).replace(/^"|"$/g, "").replace(/\\/g, "/") }))
    .filter(({ code, path: p }) => {
      if (ours.has(p)) return false; // a wiring file we copied in
      // Only *untracked* things under our directories are ours; a tracked file the agent
      // actually modified in there is real work and must still block a merge.
      if (code === "??" && ourDirs.some((d) => p === d || p.startsWith(d))) return false;
      return true;
    })
    .map(({ path: p }) => p);
}

function isDirty(dir: string): boolean {
  return realChanges(dir).length > 0;
}

export function branchFor(ticket: string): string {
  return BRANCH_PREFIX + ticket;
}

export function treesDir(storeDir: string): string {
  return path.join(storeDir, "trees");
}

export function worktreePath(storeDir: string, ticket: string): string {
  return path.join(treesDir(storeDir), ticket);
}

/** Copy the untracked wiring files so the agent in the worktree still has the brain. */
export function copyWiring(root: string, dest: string): string[] {
  const copied: string[] = [];
  for (const rel of WIRING_FILES) {
    const from = path.join(root, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rel);
  }
  return copied;
}

export interface CreateResult {
  worktree: Worktree | null;
  reason?: string;
  wiring?: string[];
}

/**
 * Create (or reuse) the worktree for a ticket. Returns reason instead of throwing when
 * isolation is impossible, so dispatch can fall back to the shared tree and say why.
 */
export function createWorktree(root: string, storeDir: string, ticket: string): CreateResult {
  if (!isGitRepo(root)) return { worktree: null, reason: "not a git repository" };
  const dir = worktreePath(storeDir, ticket);
  const branch = branchFor(ticket);

  if (fs.existsSync(dir)) {
    // Reuse: a retried ticket should land back in the tree it already had.
    return { worktree: { ticket, path: dir, branch }, wiring: copyWiring(root, dir) };
  }
  fs.mkdirSync(treesDir(storeDir), { recursive: true });

  const branchExists = gitQuiet(root, ["rev-parse", "--verify", branch]).ok;
  const args = branchExists
    ? ["worktree", "add", dir, branch]
    : ["worktree", "add", "-b", branch, dir];
  const made = gitQuiet(root, args);
  if (!made.ok) return { worktree: null, reason: made.out.trim().split("\n")[0] || "git worktree add failed" };

  return { worktree: { ticket, path: dir, branch }, wiring: copyWiring(root, dir) };
}

export function removeWorktree(root: string, storeDir: string, ticket: string, force = false): boolean {
  const dir = worktreePath(storeDir, ticket);
  if (!fs.existsSync(dir)) return false;
  const args = ["worktree", "remove", dir];
  if (force) args.push("--force");
  return gitQuiet(root, args).ok;
}

export interface TreeStatus extends Worktree {
  dirty: boolean;
  commits: number;
}

/** Every ConnectR worktree that currently exists, with whether it has work to bring back. */
export function listWorktrees(root: string, storeDir: string): TreeStatus[] {
  if (!isGitRepo(root)) return [];
  const dir = treesDir(storeDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((t) => fs.existsSync(path.join(dir, t, ".git")))
    .map((ticket) => {
      const p = path.join(dir, ticket);
      const branch = branchFor(ticket);
      const dirty = isDirty(p);
      const counted = gitQuiet(root, ["rev-list", "--count", `HEAD..${branch}`]).out.trim();
      return { ticket, path: p, branch, dirty, commits: Number(counted) || 0 };
    });
}

export interface DiffResult {
  ok: boolean;
  message?: string;
  stat?: string;
  patch?: string;
  truncated?: boolean;
}

const MAX_PATCH_BYTES = 200_000;

/**
 * What a ticket's branch would bring back. Three-dot diff (merge-base..branch), so it
 * shows only the agent's own changes even after main has moved on.
 */
export function diffWorktree(root: string, ticket: string): DiffResult {
  if (!isGitRepo(root)) return { ok: false, message: "not a git repository" };
  const branch = branchFor(ticket);
  if (!gitQuiet(root, ["rev-parse", "--verify", branch]).ok) {
    return { ok: false, message: `no branch ${branch} for ${ticket}` };
  }
  const stat = gitQuiet(root, ["diff", "--stat", `HEAD...${branch}`]).out.trim();
  const full = gitQuiet(root, ["diff", `HEAD...${branch}`]).out;
  const truncated = Buffer.byteLength(full, "utf8") > MAX_PATCH_BYTES;
  return {
    ok: true,
    stat,
    patch: truncated ? full.slice(0, MAX_PATCH_BYTES) : full,
    truncated,
  };
}

export interface MergeResult {
  ok: boolean;
  message: string;
}

/**
 * Bring a ticket's branch back. Refuses rather than risking work: a dirty worktree means
 * the agent left uncommitted changes, and a dirty main tree means the merge would mix with
 * whatever you have in progress.
 */
export function mergeWorktree(root: string, storeDir: string, ticket: string, opts: { remove?: boolean } = {}): MergeResult {
  if (!isGitRepo(root)) return { ok: false, message: "not a git repository" };
  // A conflicted merge leaves MERGE_HEAD behind. Say that plainly - otherwise the dirty
  // check below reports "uncommitted changes" and hides the real state.
  if (gitQuiet(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) {
    return {
      ok: false,
      message: "you are in the middle of a merge - resolve and commit it, or run: git merge --abort",
    };
  }
  const branch = branchFor(ticket);
  if (!gitQuiet(root, ["rev-parse", "--verify", branch]).ok) {
    return { ok: false, message: `no branch ${branch} - was this ticket ever dispatched with isolation on?` };
  }
  const dir = worktreePath(storeDir, ticket);
  if (fs.existsSync(dir) && isDirty(dir)) {
    return { ok: false, message: `${ticket} has uncommitted changes in its worktree - commit or discard them first` };
  }
  if (isDirty(root)) {
    return { ok: false, message: "your working tree has uncommitted changes - commit or stash them first" };
  }
  const ahead = Number(gitQuiet(root, ["rev-list", "--count", `HEAD..${branch}`]).out.trim()) || 0;
  if (ahead === 0) {
    if (opts.remove) {
      removeWorktree(root, storeDir, ticket, true);
      gitQuiet(root, ["branch", "-D", branch]);
    }
    return { ok: true, message: `${ticket} had no commits to merge${opts.remove ? " - worktree removed" : ""}` };
  }
  const merged = gitQuiet(root, ["merge", "--no-ff", branch, "-m", `Merge ${ticket} from ${branch}`]);
  if (!merged.ok) {
    // Two agents can legitimately change the same file. The isolation kept both sets of
    // work; git is now asking a human which wins. Name the files and leave the merge in
    // place - aborting for them would throw away a resolution they may want to make.
    const conflicts = gitQuiet(root, ["diff", "--name-only", "--diff-filter=U"]).out.trim().split("\n").filter(Boolean);
    if (conflicts.length) {
      return {
        ok: false,
        message:
          `${ticket} conflicts with your branch in ${conflicts.join(", ")} - ` +
          "both versions are safe; resolve and commit, or run: git merge --abort",
      };
    }
    return { ok: false, message: merged.out.trim().split("\n").slice(0, 3).join(" ") };
  }
  if (opts.remove) {
    removeWorktree(root, storeDir, ticket, true);
    gitQuiet(root, ["branch", "-d", branch]);
  }
  return { ok: true, message: `merged ${ahead} commit${ahead === 1 ? "" : "s"} from ${branch}` };
}
