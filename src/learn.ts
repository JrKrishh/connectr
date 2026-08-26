import { effectiveRules, type ConnectrConfig } from "./routing.js";
import type { StoreData } from "./types.js";

// Outcome-learned routing: the board already records which tool completed, failed or lost
// which category of work. This turns that history into routing decisions - no new state,
// everything is computed live from the store.

export const MIN_EVIDENCE = 3;

export function categoryOf(text: string, config: ConnectrConfig): { category: string; ruleTool: string } {
  const hay = text.toLowerCase();
  for (const rule of effectiveRules(config)) {
    try {
      if (new RegExp(rule.match, "i").test(hay)) return { category: rule.match, ruleTool: rule.tool };
    } catch {
      /* bad user regex - skip */
    }
  }
  return { category: "default", ruleTool: config.routing.defaultTool };
}

export function agentTool(d: StoreData, agentId: string): string {
  const known = d.agents[agentId]?.tool;
  if (known && known !== "unknown") return known;
  const m = agentId.match(/^(.*?)-\d+$/);
  return m ? m[1] : agentId;
}

export interface ToolStats {
  wins: number;
  losses: number;
}

export interface CategoryLearning {
  category: string;
  ruleTool: string;
  stats: Record<string, ToolStats>;
  evidence: number;
  pick: string;
  learned: boolean;
  reason: string;
}

// Laplace-smoothed success rate: an unseen tool sits at 0.5, one win beats it, one loss drops it.
function rateOf(s: ToolStats | undefined): number {
  const w = s?.wins ?? 0;
  const l = s?.losses ?? 0;
  return (w + 1) / (w + l + 2);
}

export function learnRoutes(d: StoreData, config: ConnectrConfig): Map<string, CategoryLearning> {
  const table = new Map<string, CategoryLearning>();
  const bump = (category: string, ruleTool: string, tool: string, kind: "wins" | "losses"): void => {
    let c = table.get(category);
    if (!c) {
      c = { category, ruleTool, stats: {}, evidence: 0, pick: ruleTool, learned: false, reason: "" };
      table.set(category, c);
    }
    const s = (c.stats[tool] ??= { wins: 0, losses: 0 });
    s[kind]++;
    c.evidence++;
  };

  for (const t of d.tickets) {
    if (t.status !== "closed") continue;
    const { category, ruleTool } = categoryOf(`${t.title} ${t.desc}`, config);
    for (const n of t.notes) {
      const m = n.text.match(/^takeover from '([^']+)'/);
      if (m) bump(category, ruleTool, agentTool(d, m[1]), "losses");
    }
    if (t.resolution !== "completed" || !t.owner) continue;
    const winner = agentTool(d, t.owner);
    bump(category, ruleTool, winner, "wins");
    if (t.routedTo && t.routedTo.tool !== winner) bump(category, ruleTool, t.routedTo.tool, "losses");
  }

  for (const c of table.values()) {
    let best = c.ruleTool;
    let bestRate = rateOf(c.stats[c.ruleTool]);
    for (const [tool, s] of Object.entries(c.stats)) {
      if (rateOf(s) > bestRate) {
        best = tool;
        bestRate = rateOf(s);
      }
    }
    if (c.evidence >= MIN_EVIDENCE && best !== c.ruleTool) {
      c.pick = best;
      c.learned = true;
      const s = c.stats[best]!;
      c.reason = `${best} ${s.wins}w/${s.losses}l outperforms ${c.ruleTool} here (${c.evidence} outcomes)`;
    } else {
      c.pick = c.ruleTool;
      c.learned = false;
      c.reason = c.evidence > 0 ? `rule holds (${c.evidence} outcomes, no stronger tool yet)` : "no outcomes yet";
    }
  }
  return table;
}

export interface SmartRoute {
  tool: string;
  via: "learned" | "rule" | "default";
  category: string;
  reason: string;
}

export function resolveToolSmart(text: string, d: StoreData, config: ConnectrConfig): SmartRoute {
  const { category, ruleTool } = categoryOf(text, config);
  const learning = learnRoutes(d, config).get(category);
  if (learning?.learned) return { tool: learning.pick, via: "learned", category, reason: learning.reason };
  return {
    tool: ruleTool,
    via: category === "default" ? "default" : "rule",
    category,
    reason: learning?.reason ?? "no outcomes yet",
  };
}
