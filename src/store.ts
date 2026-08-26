import fs from "node:fs";
import path from "node:path";
import type { FileClaim, StoreData } from "./types.js";

export const AGENT_LIVE_MS = 10 * 60_000;
export const CLAIM_TTL_MS = 2 * 60 * 60_000;

const LOCK_STEAL_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_MAX_TRIES = 200;

const SAVE_RETRIES = 6;
const SAVE_RETRY_MS = 60;

export class LockError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LockError";
  }
}

export function resolveStoreDir(explicit?: string): string {
  if (explicit) return path.join(explicit, ".connectr");
  if (process.env.CONNECTR_STORE) return path.resolve(process.env.CONNECTR_STORE);
  return path.join(process.cwd(), ".connectr");
}

export function emptyData(): StoreData {
  return { version: 1, agents: {}, facts: [], tickets: [], claims: [] };
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function liveAgentIds(d: StoreData, now = Date.now()): string[] {
  return Object.values(d.agents)
    .filter((a) => now - Date.parse(a.lastSeen) < AGENT_LIVE_MS)
    .map((a) => a.id);
}

export function activeClaims(d: StoreData, now = Date.now()): FileClaim[] {
  return d.claims.filter((c) => c.expiresAt > now);
}

export function claimConflicts(
  d: StoreData,
  agent: string,
  paths: string[],
  now = Date.now()
): Record<string, string[]> {
  const wanted = new Set(paths.map(normalizePath));
  const out: Record<string, string[]> = {};
  for (const c of activeClaims(d, now)) {
    if (c.agent === agent) continue;
    const hit = c.paths.filter((p) => wanted.has(normalizePath(p)));
    if (hit.length > 0) out[c.agent] = (out[c.agent] ?? []).concat(hit);
  }
  return out;
}

export function nextId(prefix: string, items: { id: string }[]): string {
  let max = 0;
  for (const it of items) {
    const n = Number.parseInt(it.id.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return prefix + (max + 1);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class Store {
  readonly dir: string;
  private readonly file: string;
  private readonly lockFile: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dir?: string) {
    this.dir = resolveStoreDir(dir);
    this.file = path.join(this.dir, "store.json");
    this.lockFile = path.join(this.dir, ".lock");
  }

  read(): StoreData {
    const d = this.loadRaw();
    const now = Date.now();
    return {
      ...d,
      claims: d.claims.filter((c) => c.expiresAt > now),
    };
  }

  async mutate<T>(fn: (d: StoreData) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.acquireLock();
      try {
        const data = this.loadRaw();
        const result = await fn(data);
        const now = Date.now();
        data.claims = data.claims.filter((c) => c.expiresAt > now);
        this.atomicSave(data);
        return result;
      } finally {
        this.releaseLock();
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private loadRaw(): StoreData {
    if (!fs.existsSync(this.file)) return emptyData();
    const raw = fs.readFileSync(this.file, "utf8");
    if (raw.trim() === "") return emptyData();
    const d = JSON.parse(raw) as StoreData;
    if (d.version !== 1) throw new Error(`unsupported store version ${d.version}`);
    for (const key of ["facts", "tickets", "claims"] as const) {
      if (!Array.isArray(d[key])) d[key] = [];
    }
    if (!d.agents || typeof d.agents !== "object") d.agents = {};
    return d;
  }

  private acquireLock(): void {
    this.ensureDir();
    for (let i = 0; i < LOCK_MAX_TRIES; i++) {
      try {
        const fd = fs.openSync(this.lockFile, "wx");
        try {
          fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
        } finally {
          fs.closeSync(fd);
        }
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw e;
        try {
          const st = fs.statSync(this.lockFile);
          if (Date.now() - st.mtimeMs > LOCK_STEAL_MS) {
            fs.unlinkSync(this.lockFile);
            continue;
          }
        } catch {
          continue;
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }
    throw new LockError(`timed out acquiring connectr lock at ${this.lockFile}`);
  }

  private releaseLock(): void {
    try {
      fs.unlinkSync(this.lockFile);
    } catch {
      /* already gone */
    }
  }

  private atomicSave(d: StoreData): void {
    this.ensureDir();
    const tmp = path.join(this.dir, `.tmp-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    let lastErr: unknown;
    for (let i = 0; i < SAVE_RETRIES; i++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (e) {
        lastErr = e;
        sleepSync(SAVE_RETRY_MS);
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw lastErr;
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }
}
