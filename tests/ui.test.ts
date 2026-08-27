import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startUi } from "../src/ui/server.js";
import { UI_HTML } from "../src/ui/page.js";
import { Store } from "../src/store.js";
import { createWorktree } from "../src/worktree.js";

let server: http.Server;
let base = "";
let root = "";
let prevStore: string | undefined;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  prevStore = process.env.CONNECTR_STORE;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-ui-"));
  process.env.CONNECTR_STORE = path.join(root, ".connectr");
  // This suite's tickets point at real tools; park the auto-continue tick far away so a
  // momentary autoContinue=true in the settings test can never launch one.
  process.env.CONNECTR_AUTO_TICK = "3600000";
  // The review endpoints work against git, so the fixture project is a real repo.
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "init");
  server = startUi(0); // ephemeral port
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (prevStore === undefined) delete process.env.CONNECTR_STORE;
  else process.env.CONNECTR_STORE = prevStore;
  delete process.env.CONNECTR_AUTO_TICK;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("embedded page", () => {
  // page.ts is one big template literal, so a single backslash is eaten before the browser
  // sees it. That silently ships a broken regex and kills the whole script - these two
  // checks are what catch it.
  const script = UI_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

  it("has a script that actually parses", () => {
    expect(script.length).toBeGreaterThan(1000);
    expect(() => new Function(script)).not.toThrow();
  });

  it("keeps regex escapes intact through the template literal", () => {
    expect(script).toContain(String.raw`https?:\/\/`); // not https?://
    expect(script).toContain(String.raw`\s`); // not a bare "s"
    expect(script).not.toMatch(/https\?:\/\/\[\^s/); // the exact shape of the bug
  });

  it("wires notifications as an opt-in that never fires while you watch", () => {
    // opt-in and permission-gated, off by default
    expect(script).toContain('localStorage.getItem("connectr-notify")==="1"');
    expect(script).toContain('Notification.permission==="granted"');
    expect(script).toContain("Notification.requestPermission");
    // silent while the window has focus; title badge as the no-permission fallback
    expect(script).toContain("document.hasFocus()");
    expect(script).toContain('") connectr"');
    // the three moments that matter: finished, agent gone, commits to review
    expect(script).toContain("finished");
    expect(script).toContain("its agent is gone");
    expect(script).toContain("to review");
  });
});

describe("connectr ui server", () => {
  it("serves the dashboard page", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>connectr</title>");
    expect(html).toContain("Working now"); // sidebar task groups
    expect(html).toContain("/api/events"); // live updates wired
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // no external assets: works offline
  });

  it("creates tasks via POST /api/task and shows them in /api/state", async () => {
    const create = await fetch(base + "/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "write api docs @gemini" }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.ticket.routedTo.tool).toBe("gemini");

    const state = await (await fetch(base + "/api/state")).json();
    expect(state.mode).toBe("auto");
    const mine = state.tickets.find((t: { id: string }) => t.id === created.ticket.id);
    expect(mine).toBeDefined();
    expect(Array.isArray(mine.notes)).toBe(true); // thread data
    expect(Array.isArray(mine.runs)).toBe(true);
  });

  it("rejects bad task input with a 400", async () => {
    const res = await fetch(base + "/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "x @notepad" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown tool");
  });

  it("returns the dispatch plan on a dry run without launching", async () => {
    const res = await fetch(base + "/api/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dry: true }),
    });
    const plan = await res.json();
    expect(plan.mode).toBe("auto");
    expect(plan.plan.length).toBeGreaterThan(0);
    expect(plan.plan[0].tool).toBe("gemini");
  });

  it("rejects an empty plan request", async () => {
    const res = await fetch(base + "/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "  " }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("empty");
  });

  it("creates a planner ticket carrying the intent", async () => {
    const res = await fetch(base + "/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "add a settings page" }),
    });
    expect(res.status).toBe(200);
    const { ticket } = await res.json();
    expect(ticket.title).toBe("Plan: add a settings page");
    expect(ticket.desc).toContain("add a settings page");
    expect(ticket.routedTo.via).toBe("default");
  });

  it("streams a log tail and then pushes what gets appended", async () => {
    const runs = path.join(process.env.CONNECTR_STORE!, "runs");
    fs.mkdirSync(runs, { recursive: true });
    const log = path.join(runs, "t1-stream.log");
    fs.writeFileSync(log, "first line\n");

    const ctrl = new AbortController();
    const res = await fetch(base + "/api/log/stream?file=t1-stream.log", { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readChunk = async (): Promise<string> => {
      const deadline = Date.now() + 8000;
      let seen = "";
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
        const line = seen.split("\n").find((l) => l.startsWith("data: "));
        if (line) return JSON.parse(line.slice(6)).chunk;
      }
      return "";
    };

    expect(await readChunk()).toContain("first line"); // initial tail

    // the agent writes more; the stream should carry only the new bytes
    fs.appendFileSync(log, "second line\n");
    const next = await readChunk();
    expect(next).toContain("second line");
    expect(next).not.toContain("first line");
    ctrl.abort();
  }, 20_000);

  it("refuses to stream a log that does not exist", async () => {
    const res = await fetch(base + "/api/log/stream?file=nope.log");
    expect(res.status).toBe(404);
  });

  it("reports the mode and exactly what each tool gets in it", async () => {
    const s = await (await fetch(base + "/api/settings")).json();
    expect(s.permissionMode).toBe("auto");
    expect(s.modes.map((m: { id: string }) => m.id)).toEqual(["safe", "auto", "yolo"]);
    for (const m of s.modes) expect(m.blurb.length).toBeGreaterThan(20);

    const byTool = Object.fromEntries(s.tools.map((t: { tool: string }) => [t.tool, t]));
    // participants are not dispatched, so a mode says nothing about them
    expect(byTool["cursor"]).toBeUndefined();
    // the whole point: one mode, each tool launched in its own equivalent
    expect(byTool["claude-code"].flags.auto).toContain("acceptEdits");
    expect(byTool["codex"].flags.auto).toContain("--full-auto");
    expect(byTool["gemini"].flags.auto).toContain("auto_edit");
    expect(byTool["codex"].flags.safe).toContain("read-only");
    expect(byTool["claude-code"].flags.yolo).toContain("--dangerously-skip-permissions");
  });

  it("changes the mode and persists it to the project config", async () => {
    const res = await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionMode: "safe" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).permissionMode).toBe("safe");

    // it must survive on disk, not just in memory
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.CONNECTR_STORE!, "config.json"), "utf8"));
    expect(cfg.permissionMode).toBe("safe");
    // and every later dispatch must see it
    expect((await (await fetch(base + "/api/state")).json()).mode).toBe("safe");

    await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionMode: "auto" }),
    });
  });

  it("stores auto-continue separately from the mode", async () => {
    const on = await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoContinue: true }),
    });
    expect((await on.json()).autoContinue).toBe(true);
    expect((await (await fetch(base + "/api/state")).json()).autoContinue).toBe(true);

    // changing only the mode must not clobber it
    await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionMode: "auto" }),
    });
    expect((await (await fetch(base + "/api/settings")).json()).autoContinue).toBe(true);

    const off = await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoContinue: false }),
    });
    expect((await off.json()).autoContinue).toBe(false);
  });

  it("refuses a mode it does not know", async () => {
    const res = await fetch(base + "/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionMode: "rampage" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown mode");
  });

  it("blocks log path traversal", async () => {
    const res = await fetch(base + "/api/log?file=..%2F..%2Fstore.json");
    expect(res.status).toBe(404);
  });
});

describe("localhost origin guard", () => {
  // Raw requests so we can forge Origin and Host the way a browser or an attacker would;
  // node's fetch sends neither, which is exactly why the normal tests pass unguarded.
  function raw(
    method: string,
    p: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{ status: number; body: string }> {
    const port = (server.address() as AddressInfo).port;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  it("refuses a cross-origin POST even as a text/plain body that skips preflight", async () => {
    const before = (await (await fetch(base + "/api/settings")).json()).permissionMode;
    const res = await raw(
      "POST",
      "/api/settings",
      { origin: "http://evil.example", "content-type": "text/plain" },
      JSON.stringify({ permissionMode: "yolo", autoContinue: true })
    );
    expect(res.status).toBe(403);
    // the drive-by must not have changed anything
    expect((await (await fetch(base + "/api/settings")).json()).permissionMode).toBe(before);
  });

  it("refuses a non-loopback Host (DNS rebinding)", async () => {
    const res = await raw("GET", "/api/state", { host: "evil.example" });
    expect(res.status).toBe(403);
  });

  it("allows a same-origin POST", async () => {
    const port = (server.address() as AddressInfo).port;
    const res = await raw(
      "POST",
      "/api/settings",
      { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
      JSON.stringify({ permissionMode: "auto" })
    );
    expect(res.status).toBe(200);
  });

  it("allows a POST with no Origin (desktop main process, curl, tests)", async () => {
    const res = await raw(
      "POST",
      "/api/settings",
      { "content-type": "application/json" },
      JSON.stringify({ permissionMode: "auto" })
    );
    expect(res.status).toBe(200);
  });
});

describe("review and merge over http", () => {
  let ticketId = "";

  it("rejects anything that is not a ticket id", async () => {
    const diff = await fetch(base + "/api/diff?ticket=..%2Ffoo");
    expect(diff.status).toBe(400);
    const merge = await fetch(base + "/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: "../foo" }),
    });
    expect(merge.status).toBe(400);
  });

  it("404s a diff for a ticket that never had a worktree", async () => {
    const res = await fetch(base + "/api/diff?ticket=t97");
    expect(res.status).toBe(404);
    expect((await res.json()).message).toContain("no branch");
  });

  it("diffs what a ticket's worktree would bring back", async () => {
    const create = await fetch(base + "/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "wire up the review flow" }),
    });
    ticketId = (await create.json()).ticket.id;

    // An "agent" does some work in the ticket's isolated tree and commits it.
    const made = createWorktree(root, process.env.CONNECTR_STORE!, ticketId);
    expect(made.worktree).not.toBeNull();
    const tree = made.worktree!.path;
    fs.writeFileSync(path.join(tree, "review-note.md"), "hello from the worktree\n");
    git(tree, "add", "review-note.md");
    git(tree, "commit", "-m", "agent work");

    const d = await (await fetch(base + "/api/diff?ticket=" + ticketId)).json();
    expect(d.ok).toBe(true);
    expect(d.stat).toContain("review-note.md");
    expect(d.patch).toContain("+hello from the worktree");
  });

  it("shows the commits waiting on the ticket in /api/state", async () => {
    // tree status is cached for 3s on the server; wait it out
    await new Promise((r) => setTimeout(r, 3200));
    const state = await (await fetch(base + "/api/state")).json();
    const mine = state.tickets.find((t: { id: string }) => t.id === ticketId);
    expect(mine.tree).toEqual({ commits: 1, dirty: false });
  }, 10_000);

  it("merges the branch back and clears the worktree", async () => {
    const res = await fetch(base + "/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: ticketId }),
    });
    expect(res.status).toBe(200);
    const merged = await res.json();
    expect(merged.ok).toBe(true);
    expect(merged.message).toContain("merged 1 commit");

    // the work landed on main, and the review surface is gone with it
    expect(fs.readFileSync(path.join(root, "review-note.md"), "utf8")).toContain("hello");
    expect(fs.existsSync(path.join(process.env.CONNECTR_STORE!, "trees", ticketId))).toBe(false);
    expect((await fetch(base + "/api/diff?ticket=" + ticketId)).status).toBe(404);
  });

  it("refuses to merge a ticket with nothing behind it", async () => {
    const res = await fetch(base + "/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: "t97" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("no branch");
  });

  it("sweeps a ticket whose agent died and reopens it", async () => {
    const create = await fetch(base + "/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "task the dead agent was holding" }),
    });
    const id = (await create.json()).ticket.id;
    const store = new Store();
    await store.mutate((d) => {
      const t = d.tickets.find((x) => x.id === id)!;
      t.status = "in_progress";
      t.owner = "ghost-agent"; // never heartbeated, so not live
    });

    const swept = await (await fetch(base + "/api/sweep", { method: "POST" })).json();
    expect(swept.swept.map((s: { id: string }) => s.id)).toContain(id);

    const state = await (await fetch(base + "/api/state")).json();
    const mine = state.tickets.find((t: { id: string }) => t.id === id);
    expect(mine.status).toBe("open"); // back on the board, ready to re-dispatch
    expect(mine.owner).toBeNull();
  });
});
