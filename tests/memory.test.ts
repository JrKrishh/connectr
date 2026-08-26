import { describe, expect, it } from "vitest";
import { factKind, findDuplicate, recentLessons, searchFacts } from "../src/memory.js";
import type { Fact } from "../src/types.js";

function fact(id: string, text: string, extra: Partial<Fact> = {}): Fact {
  return { id, text, tags: [], agent: "a", ts: new Date().toISOString(), ...extra };
}

describe("factKind", () => {
  it("treats pre-0.2 facts without kind as plain facts", () => {
    expect(factKind(fact("f1", "uses pnpm"))).toBe("fact");
    expect(factKind(fact("f2", "x", { kind: "lesson" }))).toBe("lesson");
  });
});

describe("searchFacts", () => {
  const facts = [
    fact("f1", "auth uses refresh-token rotation", { kind: "decision", tags: ["auth"] }),
    fact("f2", "vitest needs the build first", { kind: "lesson", fix: "run npm test which builds then tests" }),
    fact("f3", "demo module exports getQuote"),
  ];

  it("matches text, tags and fix content", () => {
    expect(searchFacts(facts, "refresh token")[0].f.id).toBe("f1");
    expect(searchFacts(facts, "npm builds")[0].f.id).toBe("f2");
  });

  it("filters by kind, including default kind for legacy facts", () => {
    expect(searchFacts(facts, "auth vitest getQuote", "lesson").map((x) => x.f.id)).toEqual(["f2"]);
    expect(searchFacts(facts, "getQuote", "fact").map((x) => x.f.id)).toEqual(["f3"]);
  });

  it("returns nothing on zero-score queries", () => {
    expect(searchFacts(facts, "kubernetes")).toEqual([]);
  });
});

describe("findDuplicate", () => {
  const existing = [fact("f1", "The auth backend uses refresh-token rotation for every session.")];

  it("catches exact and case/punctuation-insensitive repeats", () => {
    expect(findDuplicate(existing, "the AUTH backend uses refresh-token rotation, for every session")?.id).toBe("f1");
  });

  it("catches near-duplicates with high token overlap", () => {
    expect(findDuplicate(existing, "auth backend uses refresh-token rotation for every session")?.id).toBe("f1");
  });

  it("lets genuinely different facts through", () => {
    expect(findDuplicate(existing, "the billing service uses stripe webhooks for invoices")).toBeNull();
    expect(findDuplicate(existing, "short note")).toBeNull();
  });
});

describe("recentLessons", () => {
  it("returns newest lessons only, capped", () => {
    const facts = [
      fact("f1", "plain fact"),
      fact("f2", "old lesson", { kind: "lesson", ts: "2026-01-01T00:00:00Z" }),
      fact("f3", "mid lesson", { kind: "lesson", ts: "2026-02-01T00:00:00Z" }),
      fact("f4", "new lesson", { kind: "lesson", ts: "2026-03-01T00:00:00Z" }),
      fact("f5", "newest lesson", { kind: "lesson", ts: "2026-04-01T00:00:00Z" }),
    ];
    expect(recentLessons(facts).map((f) => f.id)).toEqual(["f5", "f4", "f3"]);
  });
});
