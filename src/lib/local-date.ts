/**
 * The architect's LOCAL calendar date — pure, no I/O.
 *
 * Why this exists: the day plan (Rule 27) needs "which day is it for the person
 * looking at the screen". A Server Component can't know that — `new Date()` on the
 * server is the Vercel clock (UTC), which is the known bug in `/`'s resume pins
 * (`(app)/page.tsx`). So the BROWSER supplies the date, as `YYYY-MM-DD`, and the
 * server only stores it. Everything here takes dates as arguments so it is
 * testable without a clock.
 *
 * (`localDateKey` also exists in `(app)/log/page.tsx`. That file is a route, and a
 * component importing from a route file is the wrong dependency direction; this is
 * its own small module rather than a reach into a page.)
 */

/** `YYYY-MM-DD` in the date's own LOCAL time, never UTC. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A plan is STALE when it was opened on a day strictly before `today`.
 *
 * Zero-padded ISO dates sort the same as calendar dates, so this is a string
 * comparison — no `Date` parsing, and so no timezone to get wrong.
 *
 * - `null` on either side is "can't tell" and answers `false`. Before the browser
 *   has reported its date there is nothing to compare, and a plan must not flash
 *   as stale during hydration.
 * - A plan dated in the FUTURE (the architect travelled west, or changed the
 *   clock) is not stale: it is simply still the open plan.
 */
export function isStalePlan(planDate: string | null, today: string | null): boolean {
  if (planDate === null || today === null) return false;
  return planDate < today;
}

/**
 * `Fri 13 Nov` for a `YYYY-MM-DD`, built from its parts so the label can't shift
 * a day with the viewer's timezone (`new Date("2026-11-13")` parses as UTC).
 */
export function planDateLabel(planDate: string): string {
  const [y, m, d] = planDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${date.getDate()} ${month}`;
}
