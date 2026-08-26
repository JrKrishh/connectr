import type { Fact, FactKind } from "./types.js";

export function factKind(f: Fact): FactKind {
  return f.kind ?? "fact";
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3);
}

export interface ScoredFact {
  f: Fact;
  score: number;
}

export function searchFacts(facts: Fact[], query: string, kind?: FactKind, limit = 8): ScoredFact[] {
  const tokens = tokenize(query);
  const terms = tokens.length > 0 ? tokens : [query.toLowerCase()];
  return facts
    .filter((f) => !kind || factKind(f) === kind)
    .map((f) => {
      const hay = `${f.text} ${f.fix ?? ""} ${f.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (hay.includes(term)) score++;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.f.ts) - Date.parse(a.f.ts))
    .slice(0, limit);
}

const NEAR_DUP_OVERLAP = 0.8;
const NEAR_DUP_MIN_TOKENS = 5;

export function findDuplicate(facts: Fact[], text: string): Fact | null {
  const norm = (s: string) => s.toLowerCase().replace(/\W+/g, " ").trim();
  const target = norm(text);
  const targetTokens = new Set(tokenize(text));
  for (const f of facts) {
    if (norm(f.text) === target) return f;
    if (targetTokens.size < NEAR_DUP_MIN_TOKENS) continue;
    const ft = new Set(tokenize(f.text));
    if (ft.size < NEAR_DUP_MIN_TOKENS) continue;
    let overlap = 0;
    for (const t of targetTokens) if (ft.has(t)) overlap++;
    if (overlap / targetTokens.size >= NEAR_DUP_OVERLAP && overlap / ft.size >= NEAR_DUP_OVERLAP) return f;
  }
  return null;
}

export function recentLessons(facts: Fact[], limit = 3): Fact[] {
  return facts
    .filter((f) => factKind(f) === "lesson")
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, limit);
}
