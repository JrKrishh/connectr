// The conversational front door. You describe an outcome; a planner agent turns it into
// routed tickets on the board. The instruction below is the whole feature - it encodes
// what the dogfood taught us about decomposition that actually dispatches well.

const MAX_TITLE = 72;

export function plannerTitle(intent: string): string {
  const oneLine = intent.trim().replace(/\s+/g, " ");
  const short = oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1)}…` : oneLine;
  return `Plan: ${short}`;
}

export interface PlannerTicket {
  title: string;
  desc: string;
}

// One source of truth, used by `connectr plan` and by the ticket `connectr new` seeds.
export function plannerTicket(intent: string, opts: { planFile?: string } = {}): PlannerTicket {
  const lines = [
    "Turn the request below into tickets on the shared board. Do NOT write code, create",
    "files, or change anything in the repo - this ticket only produces other tickets.",
    "",
    "REQUEST:",
    intent.trim(),
    "",
    "How to do it:",
    "1. recall for prior decisions and lessons, and board_view for work already tracked -",
    "   never create a ticket for something already closed or in progress.",
  ];
  if (opts.planFile) lines.push(`2. Read ${opts.planFile} for the project's goal and constraints.`);
  lines.push(
    `${opts.planFile ? "3" : "2"}. Look at the actual repo so the tickets match what is there, not what you assume.`,
    `${opts.planFile ? "4" : "3"}. For each concrete unit of work call ticket_create with:`,
    "   - a title that STARTS with the kind of work, because routing reads the title first:",
    '     "backend/api: ...", "cli/script: ...", "docs: ..." - pick the words that fit',
    "   - a description with acceptance criteria a building agent can verify",
    "   - contract: exact file paths, exported signatures and payload shapes, whenever",
    "     another ticket will build against this one",
    `${opts.planFile ? "5" : "4"}. Prefer tickets that can run in parallel without touching the same files. When one`,
    "   genuinely depends on another, say so in its description.",
    `${opts.planFile ? "6" : "5"}. remember any decision the building agents will need to share.`,
    "",
    "Then ticket_close this ticket with resolution='completed' and a note listing the",
    "ticket ids you created. Be concise."
  );
  return { title: plannerTitle(intent), desc: lines.join("\n") };
}
