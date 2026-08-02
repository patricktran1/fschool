// srs.ts — adaptive spaced repetition (SM-2). Each card carries an ease factor,
// interval, and repetition count; grading a card adapts its next interval, so cards
// you struggle with come back sooner and cards you know space out. Pure functions
// (no I/O) so they're unit-testable and reusable on client or server.

export type SrsState = {
  ease: number;      // ease factor (how fast intervals grow); SM-2 starts at 2.5
  interval: number;  // days until next review
  reps: number;      // consecutive successful reviews
  lapses: number;    // times forgotten
  dueAt: string;     // ISO timestamp of next review
};

// Quality grades (SM-2 scale 0–5). The flashcard UI maps got-it → good, missed → again.
export const GRADE = { again: 2, hard: 3, good: 4, easy: 5 } as const;

/** Stable identity for a flashcard (cards live in JSON without ids). */
export function cardKey(courseId: any, question: any): string {
  return `${courseId ?? "none"}::${String(question || "").trim().toLowerCase().slice(0, 240)}`;
}

/** Apply one SM-2 review. Returns the new scheduling state. */
export function sm2(state: Partial<SrsState> | null | undefined, grade: number): SrsState {
  let ease     = state?.ease ?? 2.5;
  let interval = state?.interval ?? 0;
  let reps     = state?.reps ?? 0;
  let lapses   = state?.lapses ?? 0;

  const q = Math.max(0, Math.min(5, Math.round(grade)));

  // Always update the ease factor — failing lowers it (struggling cards adapt to
  // shorter intervals), succeeding well raises it.
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < 1.3) ease = 1.3;
  ease = Math.round(ease * 100) / 100;

  if (q < 3) {
    reps = 0;
    interval = 1;        // relearn tomorrow
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
  }

  const dueAt = new Date(Date.now() + interval * 86_400_000).toISOString();
  return { ease, interval, reps, lapses, dueAt };
}

/** A card with no state (never reviewed) or whose due time has passed is due. */
export function isDue(state: Partial<SrsState> | null | undefined, now: number = Date.now()): boolean {
  if (!state || !state.dueAt) return true;
  return new Date(state.dueAt).getTime() <= now;
}
