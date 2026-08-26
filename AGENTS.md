<!-- CONNECTR:START -->
## ConnectR shared-agent protocol (managed by connectr init)

This project is worked on by multiple AI agents sharing one brain via the "connectr" MCP server.
Before starting any task: call board_view to see open work, and recall for prior decisions.
Claim before build: ticket_create then ticket_claim before writing any code - this prevents duplicate work.
Remember durable decisions and facts with remember; search shared memory with recall before assuming.
Before editing files other agents might touch, claim_files them; call release_files when done.
Post evidence (test output, commit SHAs) with ticket_update; finish with ticket_close + resolution.
When something fails (command error, broken test, wrong assumption), store it with remember kind='lesson':
what happened + root cause in text, the corrective action in fix. Before retrying a failure or starting
risky work, recall kind='lesson' so you never repeat a mistake another agent already paid for.
<!-- CONNECTR:END -->

## Codebase map (2026-08-26)

connectr-mcp v0.1.0 — TypeScript ESM, Node >=20. `npm test` = tsc build + vitest (incl. a two-process
race test); `npm run smoke` = two real MCP client sessions over stdio against the built server.

- `src/types.ts` — store schema: AgentInfo, Fact (`kind`: fact|decision|lesson, optional `fix`), Ticket (+`routedTo`), FileClaim
- `src/store.ts` — JSON store at `.connectr/store.json`; cross-process lockfile (O_EXCL, 10s stale-steal) + atomic temp-rename writes; claims auto-expire (2h)
- `src/memory.ts` — shared-brain helpers: `searchFacts` (kind-aware scoring), `findDuplicate` (near-dup rejection), `recentLessons`
- `src/detect.ts` — tool detection (dispatch CLIs on PATH, participant IDEs by config dir) + `suggestOrchestra` (rank tools for a plan via routing-rule hits; generic terms like "build" ignored at plan scale) + the PLAN.md template
- `src/host.ts` — shared host actions used by CLI run, TUI dash and web UI: `addTaskFromInput` (parse + route + create), `planOpenTickets` (route-and-copy open set, include/exclude), `launchPlanned`
- `src/learn.ts` — outcome-learned routing: `learnRoutes` scores tools per category from closed tickets (completions = wins, takeovers + routing-misses = losses, Laplace-smoothed), `resolveToolSmart` overrides the static rule at 3+ outcomes; surfaced via `connectr routes` and `routedTo.via/reason`
- `src/ui/server.ts` — `connectr ui` HTTP server (node:http, 127.0.0.1 only, zero deps): /api/state, /api/events (SSE, 1s change-push), /api/task, /api/dispatch (dry=plan preview), /api/log (basename-guarded tails)
- `src/ui/page.ts` — the whole dashboard as one embedded HTML page (no build step, no CDN); board columns, agents, memory, claims, run tails, add + confirm-dispatch
- `src/server/index.ts` — the MCP server (stdio): whoami, remember/recall, ticket_create/claim/update/close, board_view, claim_files/release_files
- `src/routing.ts` — task→tool routing: user regex rules in `.connectr/config.json` first, then DEFAULT_RULES (backend/auth→claude-code, cli/scripts/data→codex, docs/research→gemini); `parseTaskInput` handles the `title @tool[:model]` manual-assign syntax; `permissionMode` (safe|auto|yolo, default auto) lives in the same config
- `src/spawn.ts` — headless dispatch of routed tickets: `buildCommand(tool, cwd, model, mode, platform)` maps tool+model+permission mode to flags (`MODE_FLAGS` table; `safeModel` guards the shell string), POSIX spawns argv directly while win32 wraps claude/gemini in powershell for the .cmd shims, `launchTicket` wraps prompt+log, `detach` mode (fd-stdio + unref) lets children outlive the dash; logs to `.connectr/runs/*.log`
- `src/cli/index.ts` — `connectr` CLI: serve, init, new (project creation: folder + PLAN.md + suggested orchestra, scoped wiring, seeds the decompose ticket), task add (auto/manual route + model, validates --tool), run (parallel dispatch = the host loop, injects planFile), status, board, doctor, dash, ui
- `src/cli/targets.ts` — `init` wiring for 6 tools; only touches its own marker-wrapped blocks / `connectr` entries
- `src/tui/dash.tsx` — interactive host TUI, polls store 1×/s: `a` add task (auto-route or `@tool[:model]`), `r` dispatch open tickets detached, `l` tail newest run log, lesson badges in memory

Ritual: after changing protocol text in `src/cli/targets.ts` or `src/server/index.ts`, run
`npm run build` then `node dist/cli/index.js init` so every tool's instruction files pick it up.
