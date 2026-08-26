import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { startUi } from "../src/ui/server.js";

let server: http.Server;
let base = "";
let prevStore: string | undefined;

beforeAll(async () => {
  prevStore = process.env.CONNECTR_STORE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connectr-ui-"));
  process.env.CONNECTR_STORE = path.join(root, ".connectr");
  server = startUi(0); // ephemeral port
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (prevStore === undefined) delete process.env.CONNECTR_STORE;
  else process.env.CONNECTR_STORE = prevStore;
  await new Promise<void>((r) => server.close(() => r()));
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

  it("blocks log path traversal", async () => {
    const res = await fetch(base + "/api/log?file=..%2F..%2Fstore.json");
    expect(res.status).toBe(404);
  });
});
