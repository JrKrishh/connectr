import { matchRule, type ConnectrConfig } from "./routing.js";
import type { StoreData } from "./types.js";

// Outcome-learned routing: the board already records which tool completed, failed or lost
// which category of work. This turns that history into routing decisions - no new state,
// everything is computed live from the store.

export const MIN_EVIDENCE = 3;

// A title is a deliberate signal about the kind of work; a description is prose that
// usually name-drops several domains. Match the title first so an explicit keyword there
// is not diluted, and only widen to the description when the title says nothing.
export function categoryOf(title: string, desc: string, config: ConnectrConfig): { category: string; ruleTool: string } {
  const rule = matchRule(title, config) ?? matchRule(`${title} ${desc}`, config);
  if (rule) return { category: rule.match, ruleTool: rule.tool };
  return { category: "default", ruleTool: config.routing.defaultTool };
}

export function agentTool(d: StoreData, agentId: string): string {
  const known = d.agents[agentId]?.tool;
  if (known && known !== "unknown") return known;
  const m = agentId.match(/^(.*?)-\d+$/);
  return m ? m[1] : agentId;
}

// Outcomes are scored per "target": the tool, plus the model when we know which one ran.
// Agents report their model through whoami, so a completion can credit claude-code:opus
// rather than just claude-code - which is what lets routing learn models, not only tools.
export function targetKey(tool: string, model?: string): string {
  return model ? `${tool}:${model}` : tool;
}

export function parseTarget(key: string): { tool: string; model?: string } {
  const i = key.indexOf(":");
  return i === -1 ? { tool: key } : { tool: key.slice(0, i), model: key.slice(i + 1) };
}

export function agentTarget(d: StoreData, agentId: string): string {
  return targetKey(agentTool(d, agentId), d.agents[agentId]?.model || undefined);
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
    const { category, ruleTool } = categoryOf(t.title, t.desc, config);
    for (const n of t.notes) {
      const m = n.text.match(/^takeover from '([^']+)'/);
      if (m) bump(category, ruleTool, agentTarget(d, m[1]), "losses");
    }
    if (t.resolution !== "completed" || !t.owner) continue;
    const winner = agentTarget(d, t.owner);
    bump(category, ruleTool, winner, "wins");
    const intended = t.routedTo ? targetKey(t.routedTo.tool, t.routedTo.model) : null;
    if (intended && intended !== winner) bump(category, ruleTool, intended, "losses");
  }

  for (const c of table.values()) {
    // The rule names a tool with no model, so its own baseline is every target that runs
    // that tool - otherwise a rule tool that always runs with a model looks untried.
    const ruleEntries = Object.entries(c.stats).filter(([k]) => parseTarget(k).tool === c.ruleTool);
    // Baseline is the rule's tool at its best showing (or an unseen 0.5 if it never ran),
    // then anything strictly better takes the category - including another model of the
    // same tool.
    let best = c.ruleTool;
    let bestRate = rateOf(undefined);
    for (const [target, s] of ruleEntries) {
      if (rateOf(s) > bestRate) {
        best = target;
        bestRate = rateOf(s);
      }
    }
    for (const [target, s] of Object.entries(c.stats)) {
      if (rateOf(s) > bestRate) {
        best = target;
        bestRate = rateOf(s);
      }
    }
    // Only override a rule once its own tool has actually been tried here. Without this the
    // router locks onto whoever happened to run first and never lets the rule's tool prove
    // itself - "never tried" would read as "worse than the incumbent".
    const ruleToolTried = ruleEntries.length > 0;
    if (c.evidence >= MIN_EVIDENCE && parseTarget(best).tool !== c.ruleTool && ruleToolTried) {
      c.pick = best;
      c.learned = true;
      const s = c.stats[best]!;
      const [rKey, r] = ruleEntries.sort((a, b) => rateOf(b[1]) - rateOf(a[1]))[0];
      c.reason = `${best} ${s.wins}w/${s.losses}l beats ${rKey} ${r.wins}w/${r.losses}l here (${c.evidence} outcomes)`;
    } else if (c.evidence >= MIN_EVIDENCE && best !== c.ruleTool && ruleToolTried) {
      // Same tool, better model: keep the tool but adopt the model the board favours.
      c.pick = best;
      c.learned = true;
      const s = c.stats[best]!;
      c.reason = `${best} ${s.wins}w/${s.losses}l is the strongest ${c.ruleTool} here (${c.evidence} outcomes)`;
    } else if (c.evidence >= MIN_EVIDENCE && best !== c.ruleTool) {
      c.pick = c.ruleTool;
      c.learned = false;
      c.reason = `${c.ruleTool} untried here - keeping the rule so it can prove itself (${c.evidence} outcomes for others)`;
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
  model?: string;
  via: "learned" | "rule" | "default";
  category: string;
  reason: string;
}

export function resolveToolSmart(title: string, desc: string, d: StoreData, config: ConnectrConfig): SmartRoute {
  const { category, ruleTool } = categoryOf(title, desc, config);
  const learning = learnRoutes(d, config).get(category);
  if (learning?.learned) {
    const { tool, model } = parseTarget(learning.pick);
    return { tool, model, via: "learned", category, reason: learning.reason };
  }
  return {
    tool: ruleTool,
    via: category === "default" ? "default" : "rule",
    category,
    reason: learning?.reason ?? "no outcomes yet",
  };
}
