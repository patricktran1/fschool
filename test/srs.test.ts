import { describe, it, expect } from "vitest";
import { sm2, isDue, cardKey, GRADE } from "../src/lib/srs";

describe("sm2 scheduling", () => {
  it("schedules a new card 1 day out on first success", () => {
    const s = sm2(null, GRADE.good);
    expect(s.reps).toBe(1);
    expect(s.interval).toBe(1);
  });

  it("grows intervals on a streak of successes (1 → 6 → ~15 days)", () => {
    const a = sm2(null, GRADE.good);                 // interval 1, reps 1
    const b = sm2(a, GRADE.good);                     // interval 6, reps 2
    const c = sm2(b, GRADE.good);                     // round(6 * 2.5) = 15
    expect(b.interval).toBe(6);
    expect(c.interval).toBe(15);
    expect(c.reps).toBe(3);
  });

  it("resets reps/interval and counts a lapse on failure", () => {
    const c = { ease: 2.5, interval: 15, reps: 3, lapses: 0, dueAt: new Date().toISOString() };
    const f = sm2(c, GRADE.again);
    expect(f.reps).toBe(0);
    expect(f.interval).toBe(1);
    expect(f.lapses).toBe(1);
    expect(f.ease).toBeLessThan(2.5); // failing lowers ease (adapts to struggle)
  });

  it("raises ease on easy, lowers on hard, floors at 1.3", () => {
    expect(sm2(null, GRADE.easy).ease).toBeGreaterThan(2.5);
    expect(sm2(null, GRADE.hard).ease).toBeLessThan(2.5);
    let s: any = { ease: 1.4, interval: 1, reps: 0, lapses: 0 };
    for (let i = 0; i < 5; i++) s = sm2(s, GRADE.again);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe("isDue", () => {
  it("treats a never-seen card as due", () => {
    expect(isDue(null)).toBe(true);
    expect(isDue(undefined)).toBe(true);
  });
  it("is due when dueAt has passed, not before", () => {
    expect(isDue({ dueAt: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(isDue({ dueAt: new Date(Date.now() + 86_400_000).toISOString() })).toBe(false);
  });
});

describe("cardKey", () => {
  it("is stable + normalized per course+question", () => {
    expect(cardKey("c1", "  What Is Mitosis? ")).toBe(cardKey("c1", "what is mitosis?"));
    expect(cardKey("c1", "q")).not.toBe(cardKey("c2", "q"));
  });
});
