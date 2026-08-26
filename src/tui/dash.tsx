import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import fs from "node:fs";
import path from "node:path";
import { Store, liveAgentIds, nextId } from "../store.js";
import { factKind } from "../memory.js";
import { loadConfig, parseTaskInput, resolveTool, type PermissionMode } from "../routing.js";
import { launchTicket } from "../spawn.js";
import type { StoreData, Ticket } from "../types.js";

function useStoreData(): StoreData | null {
  const [data, setData] = useState<StoreData | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      try {
        const d = new Store().read();
        if (alive) setData(d);
      } catch {
        /* keep last good frame */
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return data;
}

interface LogTail {
  file: string;
  lines: string[];
}

function latestLogTail(runsDir: string, maxLines = 12): LogTail | null {
  try {
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".log"));
    if (files.length === 0) return null;
    let newest = files[0];
    let newestM = -1;
    for (const f of files) {
      const m = fs.statSync(path.join(runsDir, f)).mtimeMs;
      if (m >= newestM) {
        newestM = m;
        newest = f;
      }
    }
    const raw = fs.readFileSync(path.join(runsDir, newest), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .slice(-maxLines)
      .map((l) => (l.length > 110 ? l.slice(0, 110) + "…" : l));
    return { file: newest, lines };
  } catch {
    return null;
  }
}

const GREEN = "green";
const GRAY = "gray";
const CYAN = "cyan";

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={CYAN}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Dashboard(): React.JSX.Element {
  const { exit } = useApp();
  const data = useStoreData();
  const [mode, setMode] = useState<"view" | "add">("view");
  const [buffer, setBuffer] = useState("");
  const [message, setMessage] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logTail, setLogTail] = useState<LogTail | null>(null);
  const [pending, setPending] = useState<{ plan: Ticket[]; mode: PermissionMode; planFile?: string } | null>(null);
  const dispatchedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!showLog) return;
    const runsDir = path.join(new Store().dir, "runs");
    const tick = () => setLogTail(latestLogTail(runsDir));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [showLog]);

  const addTask = async (raw: string): Promise<void> => {
    const parsed = parseTaskInput(raw);
    if (parsed.error) {
      setMessage(parsed.error);
      return;
    }
    if (!parsed.title) {
      setMessage("empty title - nothing created");
      return;
    }
    const config = loadConfig(process.cwd());
    const tool = parsed.tool ?? resolveTool(parsed.title, config);
    const ticket = await new Store().mutate((d): Ticket => {
      const t: Ticket = {
        id: nextId("t", d.tickets),
        title: parsed.title,
        desc: "",
        status: "open",
        notes: [],
        createdBy: "dash-host",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        routedTo: { tool, model: parsed.model, auto: !parsed.tool },
      };
      d.tickets.push(t);
      return t;
    });
    setMessage(
      `created ${ticket.id} → ${tool}${parsed.model ? `:${parsed.model}` : ""} [${parsed.tool ? "manual" : "auto-routed"}] · r to dispatch`
    );
  };

  const armDispatch = async (): Promise<void> => {
    const store = new Store();
    const config = loadConfig(process.cwd());
    const plan = await store.mutate((d): Ticket[] => {
      const open = d.tickets.filter((t) => t.status === "open" && !dispatchedRef.current.has(t.id));
      for (const t of open) {
        if (!t.routedTo) t.routedTo = { tool: resolveTool(`${t.title} ${t.desc}`, config), auto: true };
      }
      return open.map((t) => ({ ...t }));
    });
    if (plan.length === 0) {
      setMessage("no open tickets to dispatch");
      return;
    }
    setPending({ plan, mode: config.permissionMode, planFile: config.planFile });
    const summary = plan.map((t) => `${t.id}→${t.routedTo!.tool}${t.routedTo!.model ? `:${t.routedTo!.model}` : ""}`).join(" · ");
    setMessage(`will dispatch [mode ${config.permissionMode}]: ${summary} — r again to confirm, any other key cancels`);
  };

  const confirmDispatch = (p: { plan: Ticket[]; mode: PermissionMode; planFile?: string }): void => {
    setPending(null);
    const runsDir = path.join(new Store().dir, "runs");
    const parts: string[] = [];
    for (const t of p.plan) {
      const { child } = launchTicket(t, process.cwd(), runsDir, { detach: true, mode: p.mode, planFile: p.planFile });
      if (child) {
        dispatchedRef.current.add(t.id);
        parts.push(`${t.id}→${t.routedTo!.tool}${t.routedTo!.model ? `:${t.routedTo!.model}` : ""} pid ${child.pid}`);
      } else {
        parts.push(`${t.id}: ${t.routedTo!.tool} NOT FOUND`);
      }
    }
    setMessage(`dispatched ${parts.join(" · ")}`);
    setShowLog(true);
  };

  useInput((input, key) => {
    if (mode === "add") {
      if (key.escape) {
        setMode("view");
        setBuffer("");
        setMessage("add cancelled");
        return;
      }
      if (key.return) {
        const raw = buffer.trim();
        setMode("view");
        setBuffer("");
        if (raw) void addTask(raw);
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer((b) => b.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (input) setBuffer((b) => b + input);
      return;
    }
    if (input === "r") {
      if (pending) confirmDispatch(pending);
      else void armDispatch();
      return;
    }
    if (pending) {
      setPending(null);
      setMessage("dispatch cancelled");
    }
    if (input === "q") exit();
    else if (input === "a") {
      setMode("add");
      setMessage("");
    } else if (input === "l") setShowLog((s) => !s);
  });

  if (!data) {
    return (
      <Text>
        <Text color={CYAN}>connectr</Text> reading store...
      </Text>
    );
  }

  const now = Date.now();
  const live = new Set(liveAgentIds(data));
  const agents = Object.values(data.agents).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const tickets = data.tickets.filter((t) => t.status !== "closed");
  const closedCount = data.tickets.length - tickets.length;
  const claims = data.claims.filter((c) => c.expiresAt > now);
  const facts = [...data.facts].slice(-5).reverse();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={CYAN}>
          connectr
        </Text>
        <Text dimColor>
          {" "}
          shared brain · {live.size} live · a add · r run · l logs · q quit
        </Text>
      </Box>

      <Section title={`AGENTS (${agents.length})`}>
        {agents.length === 0 ? (
          <Text dimColor>none yet - agents appear here when they call whoami</Text>
        ) : (
          agents.map((a) => (
            <Text key={a.id} color={live.has(a.id) ? GREEN : GRAY}>
              {live.has(a.id) ? "● " : "○ "}
              {a.id.padEnd(24)} {a.tool}
              {a.model ? ` · ${a.model}` : ""} · seen {Math.max(0, Math.round((now - Date.parse(a.lastSeen)) / 1000))}s ago
            </Text>
          ))
        )}
      </Section>

      <Section title={`TICKETS (${tickets.length} open · ${closedCount} closed)`}>
        {tickets.length === 0 ? (
          <Text dimColor>no open tickets - press a to add one</Text>
        ) : (
          tickets.map((t) => (
            <Text key={t.id}>
              <Text bold>{t.id.padEnd(5)}</Text>
              <Text color={t.status === "in_progress" ? GREEN : "yellow"}>[{t.status}]</Text>{" "}
              {t.owner ? `@${t.owner} ` : ""}
              {t.routedTo ? (
                <Text color={CYAN}>
                  → {t.routedTo.tool}
                  {t.routedTo.model ? `:${t.routedTo.model}` : ""}{" "}
                </Text>
              ) : null}
              {t.title}
            </Text>
          ))
        )}
      </Section>

      <Section title={`FILE CLAIMS (${claims.length})`}>
        {claims.length === 0 ? (
          <Text dimColor>none</Text>
        ) : (
          claims.map((c) => (
            <Text key={c.agent}>
              @{c.agent}: {c.paths.join(", ")}
            </Text>
          ))
        )}
      </Section>

      <Section title={`RECENT MEMORY (${data.facts.length} facts)`}>
        {facts.length === 0 ? (
          <Text dimColor>nothing remembered yet</Text>
        ) : (
          facts.map((f) => (
            <Text key={f.id} dimColor={factKind(f) !== "lesson"}>
              {factKind(f) === "lesson" ? <Text color="yellow">⚠ lesson </Text> : null}
              [{f.tags.join(",") || "-"}] {f.text}
              {f.fix ? ` → fix: ${f.fix}` : ""} — {f.agent}
            </Text>
          ))
        )}
      </Section>

      {showLog ? (
        <Section title={`LATEST RUN LOG${logTail ? ` · ${logTail.file}` : ""}`}>
          {logTail && logTail.lines.length > 0 ? (
            logTail.lines.map((l, i) => (
              <Text key={i} dimColor>
                {l}
              </Text>
            ))
          ) : (
            <Text dimColor>no run logs yet - r dispatches open tickets</Text>
          )}
        </Section>
      ) : null}

      {mode === "add" ? (
        <Box flexDirection="column">
          <Text>
            <Text color={GREEN}>add task ▸ </Text>
            {buffer}
            <Text color={GRAY}>▌</Text>
          </Text>
          <Text dimColor>title [@claude-code|@codex|@gemini[:model]] · enter=create · esc=cancel</Text>
        </Box>
      ) : null}

      {message ? <Text color="magenta">{message}</Text> : null}
    </Box>
  );
}

export function runDash(): void {
  render(<Dashboard />);
}
