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
}

export interface RoutedTo {
  tool: string;
  model?: string;
  auto: boolean;
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
