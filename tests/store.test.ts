import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { AGENT_LIVE_MS, CLAIM_TTL_MS, Store, claimConflicts, liveAgentIds, resolveStoreDir } from "../src/store.js";
import type { StoreData } from "../src/types.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "connectr-test-"));
}

function makeAgent(id: string, seenAgoMs = 0): StoreData["agents"][string] {
  return {
    id,
    tool: id.split("-")[0],
    model: "",
    pid: 123,
    cwd: ".",
    lastSeen: new Date(Date.now() - seenAgoMs).toISOString(),
  };
}

describe("Store basics", () => {
  it("explicit root beats CONNECTR_STORE env", () => {
    const prev = process.env.CONNECTR_STORE;
    process.env.CONNECTR_STORE = "Z:\\leaked";
    try {
      expect(resolveStoreDir("E:\\proj")).toBe(path.join("E:\\proj", ".connectr"));
      expect(resolveStoreDir()).toBe(path.resolve("Z:\\leaked"));
    } finally {
      if (prev === undefined) delete process.env.CONNECTR_STORE;
      else process.env.CONNECTR_STORE = prev;
    }
  });

  it("returns empty data for a fresh store", () => {
    const s = new Store(tmpRoot());
    const d = s.read();
    expect(d.version).toBe(1);
    expect(d.facts).toEqual([]);
    expect(d.tickets).toEqual([]);
    expect(d.claims).toEqual([]);
  });

  it("persists mutations visible to a second instance", async () => {
    const root = tmpRoot();
    await new Store(root).mutate((d) => {
      d.facts.push({ id: "f1", text: "uses pnpm", tags: ["build"], agent: "a", ts: new Date().toISOString() });
    });
    const d = new Store(root).read();
    expect(d.facts).toHaveLength(1);
    expect(d.facts[0].text).toBe("uses pnpm");
  });

  it("serializes concurrent in-process mutations", async () => {
    const s = new Store(tmpRoot());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        s.mutate((d) => {
          d.facts.push({ id: `f${i}`, text: `fact ${i}`, tags: [], agent: "x", ts: new Date().toISOString() });
        })
      )
    );
    expect(s.read().facts).toHaveLength(20);
  });
});

describe("Claims", () => {
  it("hides expired claims on read and drops them on next mutation", async () => {
    const root = tmpRoot();
    const s = new Store(root);
    await s.mutate((d) => {
      d.claims.push({
        agent: "old",
        tool: "t",
        paths: ["src/a.ts"],
        expiresAt: Date.now() - 1000,
      });
      d.claims.push({
        agent: "live",
        tool: "t",
        paths: ["src/b.ts"],
        expiresAt: Date.now() + CLAIM_TTL_MS,
      });
    });
    expect(s.read().claims.map((c) => c.agent)).toEqual(["live"]);
    await s.mutate(() => {});
    expect(new Store(root).read().claims.map((c) => c.agent)).toEqual(["live"]);
  });

  it("detects path conflicts case-insensitively across separators", async () => {
    const s = new Store(tmpRoot());
    await s.mutate((d) => {
      d.agents["other"] = makeAgent("other");
      d.claims.push({ agent: "other", tool: "t", paths: ["SRC\\Foo.ts"], expiresAt: Date.now() + CLAIM_TTL_MS });
    });
    const d = s.read();
    expect(Object.keys(claimConflicts(d, "me", ["src/foo.ts"]))).toEqual(["other"]);
  });
});

describe("Tickets", () => {
  it("full lifecycle create -> claim -> update -> close", async () => {
    const s = new Store(tmpRoot());
    const id = await s.mutate((d) => {
      const t = {
        id: "t1",
        title: "add login",
        desc: "",
        status: "open" as const,
        notes: [],
        createdBy: "a",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      d.tickets.push(t);
      return t.id;
    });
    expect(id).toBe("t1");

    await s.mutate((d) => {
      const t = d.tickets[0];
      t.owner = "agentA";
      t.status = "in_progress";
      t.notes.push({ agent: "agentA", text: "claimed", ts: new Date().toISOString() });
    });

    await s.mutate((d) => {
      const t = d.tickets[0];
      t.status = "closed";
      t.resolution = "completed";
    });

    const t = s.read().tickets[0];
    expect(t.status).toBe("closed");
    expect(t.resolution).toBe("completed");
    expect(t.owner).toBe("agentA");
  });
});

describe("Liveness", () => {
  it("only recent agents are live", () => {
    const d: StoreData = {
      version: 1,
      agents: {
        fresh: makeAgent("fresh", 1000),
        stale: makeAgent("stale", AGENT_LIVE_MS * 2),
      },
      facts: [],
      tickets: [],
      claims: [],
    };
    expect(liveAgentIds(d)).toEqual(["fresh"]);
  });
});

describe("Cross-process locking", () => {
  it("survives two processes appending concurrently", async () => {
    const root = tmpRoot();
    const worker = path.resolve("scripts/race-worker.mjs");
    const runs = [1, 2].map((n) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [worker], {
          env: { ...process.env, CONNECTR_STORE: path.join(root, ".connectr") },
        });
        let err = "";
        child.stderr.on("data", (d) => (err += String(d)));
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker${n} exited ${code}: ${err}`))));
        child.on("error", reject);
      })
    );
    await Promise.all(runs);
    const d = new Store(root).read();
    expect(d.facts).toHaveLength(50);
  }, 30_000);
});
