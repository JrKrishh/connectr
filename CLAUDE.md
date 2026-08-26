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

See AGENTS.md → "Codebase map" for the file-by-file index and the build/test/init ritual.
