# ConnectR

**One shared brain for all your AI coding agents.**

ConnectR is a local MCP server that gives Claude Code, Codex, Cursor, Kiro, Gemini CLI and Antigravity a single place to coordinate: one task board, one memory, and advisory file claims — so multiple agents can work on the same repo at the same time without duplicating work or overwriting each other.

```
Claude Code ─┐                       ┌─ shared ticket board
   Codex ────┤──▶ connectr MCP server ─┼─ shared facts/decisions memory
  Cursor ────┤      (one JSON store)   └─ advisory file claims
Kiro/Gemini ─┘        Antigravity ──┘
```

## Why

Run two coding agents on the same repo and they collide: both edit the same files, both redo the same task, and neither knows what the other learned. ConnectR fixes this with **shared state instead of shared process** — every agent connects to the same tiny store through the MCP tools it already speaks.

The protocol (injected into each tool's instruction file by `connectr init`):

1. **Check before you start** — `board_view` + `recall` for open work and prior decisions
2. **Claim before build** — no code until `ticket_claim` succeeds; live owners block duplicate claims
3. **Remember what matters** — facts, decisions and *lessons* (mistake → root cause → fix) via `remember`, searchable with `recall`; near-duplicates are rejected, and every `whoami` surfaces the newest lessons so no agent repeats a mistake another already paid for
4. **Announce your edits** — `claim_files` warns other live agents off your paths
5. **Close with evidence** — test output / commit SHAs via `ticket_update`, then `ticket_close` + resolution

## Install & use

```bash
npm install -g connectr-mcp
```

Starting a brand-new project? Let ConnectR assemble the orchestra:

```bash
connectr new my-app --plan brief.md   # folder + PLAN.md + suggested tools, one brain
```

`new` reads your plan, detects what's installed, and suggests which tools this project
needs — dispatch CLIs matched per area (backend→claude-code, scripts→codex, docs→gemini)
and installed IDEs (Cursor/Kiro/Antigravity) joining as participants via MCP. Confirm or
override (`--tools claude-code,codex`), and it wires only those, saves the plan into every
dispatched agent's prompt, and seeds ticket #1: *"Decompose PLAN.md into tickets"* — run it
and the board fills itself.

In an existing project worked on by multiple agents:

```bash
connectr init          # wires project-scope configs: .mcp.json (Claude Code),
                       # .cursor/mcp.json, .kiro/settings/mcp.json,
                       # CLAUDE.md / AGENTS.md / GEMINI.md protocol blocks,
                       # Cursor rules + Kiro steering docs
connectr init --global # also wires Codex (~/.codex/config.toml),
                       # Gemini CLI (~/.gemini/settings.json),
                       # Antigravity (~/.gemini/antigravity-ide/mcp_config.json)
connectr doctor        # verify wiring
connectr plan "add JWT auth, tests for it, and update the docs"   # describe an outcome
connectr plan "..." --run                                # ...and dispatch what it plans
connectr task add "fix the auth flow"                    # auto-routed to the best tool
connectr task add "migrate db" --tool codex --model gpt-5-codex   # manual tool + model
connectr run           # dispatch open tasks to their routed tools, in parallel
connectr routes        # learned routing: how past outcomes reshape where tasks go
connectr dash          # live TUI host: a add task · r dispatch · l tail run log · q quit
connectr ui            # the same host as a local web dashboard (http://127.0.0.1:4270)
```

`connectr ui` serves a zero-dependency dashboard bound to localhost: the ticket board as
kanban columns, live agents, shared memory with lesson badges, file claims, and run-log
tails — updated live over SSE. Add tasks (same `@tool:model` syntax) and dispatch open
tickets from the browser; dispatch always shows the plan and permission mode first and
asks you to confirm.

`connectr plan` is the front door: you describe an outcome, and ConnectR parks it on the
board as a planner ticket and dispatches it. The agent that claims it reads your repo,
the board and the shared memory, then creates the real tickets — titled so they route
well, with contracts published for whichever ticket another one will build against. You
never write a ticket by hand. In the web dashboard the same thing is the **Plan it**
button (Enter); **Add as one task** (shift+Enter) is the escape hatch for when you already
know exactly what you want.

In the dash, `a` opens an input — `title` auto-routes, `title @codex:gpt-5-codex` assigns tool
and model manually. `r` shows the dispatch plan and permission mode; pressing `r` again confirms.
Agents launch detached, so they keep working after you quit the dash.

## Add another coding tool

ConnectR's tools are data, not code. The three below ship built in; anything else you run
is a JSON object in `.connectr/config.json` under `tools` — no fork, no PR, no rebuild:

```json
{
  "tools": [
    {
      "id": "opencode",
      "kind": "dispatch",
      "bin": "opencode",
      "args": ["opencode", "run", "{mode}", "{prompt}"],
      "modelArgs": ["--model", "{model}"],
      "modes": { "safe": [], "auto": [], "yolo": ["--yolo"] },
      "prompt": "arg"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | what you route to: `@opencode`, `--tool opencode` |
| `kind` | `dispatch` (ConnectR launches it) or `participant` (it joins the brain over MCP and a human drives it) |
| `bin` | executable to find on PATH |
| `args` | the command template. `{cwd}` `{model}` `{prompt}` `{mode}` are substituted; `{mode}` is where the permission flags land |
| `modelArgs` | added only when a model is set — this is what makes model-level routing work for your tool |
| `modes` | flags per permission profile; leave `safe`/`auto` empty if the tool has no gating |
| `prompt` | `stdin` (default) pipes the task to the process; `arg` puts it in `{prompt}` |

A `participant` entry needs only `id`, `kind` and `homeDir` (the folder whose presence
means it's installed) — it gets wired to the shared brain and shows up in the orchestra.

Giving an entry the `id` of a built-in **replaces** it, which is how you change flags for
a tool ConnectR already knows without waiting for a release.

Verify a new tool before trusting it with real work:

```bash
connectr task add "cli/script: hello world" --tool opencode
connectr run --dry-run          # confirm it routes
connectr run                    # then read .connectr/runs/*.log
```

The first line of every run log is the exact command ConnectR spawned, so a wrong flag is
one look away. Only `claude-code`, `codex` and `gemini` are verified against real installs
here — treat any preset you find (including the one above) as a starting point to check on
your own machine.

## Dispatch permission modes

Dispatched agents run under a per-project profile (default **auto** — never yolo unless you say so):

```bash
connectr init --mode safe|auto|yolo    # saved to .connectr/config.json
```

| Mode | Meaning | claude-code | codex | gemini |
|---|---|---|---|---|
| `safe` | read + plan + shared brain; writes blocked | `--allowedTools mcp__connectr` | `--sandbox read-only` | `--approval-mode default` |
| `auto` | edits allowed, everything else stays gated | `--permission-mode acceptEdits` + brain access | `--full-auto` | `--approval-mode auto_edit` |
| `yolo` | no gates (the old behavior, now opt-in) | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--approval-mode yolo` |

In `safe`/`auto`, actions a tool's own settings don't allow simply fail rather than prompt —
non-interactive agents can't answer prompts. Allowlist project-specific commands (test runners
etc.) in each tool's own settings if you want `auto` agents to verify their work.

Restart your coding tools so they pick up the new MCP config. Then just tell any agent:

> "Use connectr: whoami, check the board, claim a ticket and start."

## The 10 MCP tools

| Tool | Purpose |
|---|---|
| `whoami` | register identity; see live peers + board summary |
| `remember` / `recall` | shared memory across all tools: `kind` = fact / decision / lesson (+`fix`), deduped |

Routing is **outcome-learned**, down to the model. Every closed ticket records which tool —
and which model, since agents report theirs — completed, failed, or lost which category of
work. With 3+ outcomes in a category, a target that outperforms the static rule takes it
over, and that can be another tool *or another model of the same tool*:

```
◆ docs|readme|research|…
    rule says gemini · outcomes: gemini:gemini-2.5-pro 3w/0l · gemini:gemini-2.5-flash 1w/1l
    pick: gemini:gemini-2.5-pro  << LEARNED override
```

Two guards keep it honest: an override needs 3+ outcomes, and it needs the rule's own tool
to have actually been tried — otherwise "never tried" would read as "worse than whoever ran
first" and the router would calcify. `connectr routes` shows the whole table with its
evidence. Your board history decides what's best at what, in *your* projects.
| `ticket_create` / `ticket_claim` / `ticket_update` / `ticket_close` | work coordination; claim-before-build |
| `board_view` | everything at a glance |
| `claim_files` / `release_files` | advisory locks, auto-expire after 2h |

Ticket close requires a resolution — `completed`, `duplicate`, `wontfix`, or `already_done` — so "shipped" stays distinguishable from "turned out unnecessary".

## How it works

- **Store**: `<project>/.connectr/store.json` — human-readable JSON, gitignored by default.
- **Concurrency**: cross-process lockfile (`O_EXCL`, stale-steal after 10s) + atomic temp-rename writes. Survives crashes; expired claims are swept automatically.
- **Identity**: `CONNECTR_AGENT` env var, else the MCP client's name, else `anon-<pid>`.
- **Transport**: stdio — the one transport every listed tool supports natively. No daemon, nothing to deploy.

## Verified matrix

Config targets verified against real installs on Windows:

| Tool | Config wired | Status |
|---|---|---|
| Claude Code | `.mcp.json` + `CLAUDE.md` block | tested end-to-end |
| Cursor | `.cursor/mcp.json` + rules `.mdc` | schema verified |
| Kiro | `.kiro/settings/mcp.json` + steering doc | schema verified |
| Gemini CLI | `~/.gemini/settings.json` + `GEMINI.md` | schema verified |
| Codex | `[mcp_servers.connectr]` TOML append | schema verified |
| Antigravity | `~/.gemini/antigravity-ide/mcp_config.json` | schema verified |

`init` is surgical and idempotent: it only adds/updates its own marker-wrapped blocks and its own `connectr` entry — never touches other servers' entries or secrets.

## Development

```bash
npm install
npm test        # vitest suite incl. two-process race test
npm run smoke   # drives two real MCP client sessions over stdio:
                # cross-process memory recall + live-ticket conflict refusal
npm run build && node dist/cli/index.js init --dry-run
```

## License

MIT
