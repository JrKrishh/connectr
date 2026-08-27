export interface AgentInfo {
  id: string;
  tool: string;
  model: string;
  pid: number;
  cwd: string;
  lastSeen: string;
}

export type FactKind = "fact" | "decision" | "lesson";

export interface Fact {
  id: string;
  kind?: FactKind; // absent in pre-0.2 stores = "fact"
  text: string;
  fix?: string; // lessons only: the corrective action
  tags: string[];
  agent: string;
  ts: string;
}

export type TicketStatus = "open" | "in_progress" | "done" | "closed";
export type Resolution = "completed" | "duplicate" | "wontfix" | "already_done";

export interface TicketNote {
  agent: string;
  text: string;
  ts: string;
}

/**
 * One dispatch of a ticket and how it ended. A run that dies without closing its ticket
 * used to leave no trace at all, so the router only ever learned from successes - which is
 * why its tables read like nothing has ever gone wrong.
 */
export interface RunAttempt {
  /** tool or tool:model, the same key routing scores. */
  target: string;
  at: string;
  outcome: "completed" | "failed";
  detail?: string;
}

export interface Ticket {
  id: string;
  title: string;
  desc: string;
  contract?: string;
  status: TicketStatus;
  owner?: string;
  notes: TicketNote[];
  resolution?: Resolution;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  routedTo?: RoutedTo;
  attempts?: RunAttempt[];
}

export interface RoutedTo {
  tool: string;
  model?: string;
  auto: boolean;
  via?: "manual" | "rule" | "learned" | "default";
  reason?: string; // why this tool: matched rule / learned override evidence
}

export interface FileClaim {
  agent: string;
  tool: string;
  paths: string[];
  expiresAt: number;
}

export interface StoreData {
  version: 1;
  agents: Record<string, AgentInfo>;
  facts: Fact[];
  tickets: Ticket[];
  claims: FileClaim[];
}
