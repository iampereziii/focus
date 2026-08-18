/**
 * `lib/time/` — THE APP'S ONE CLOCK.
 *
 * Every date key, day boundary, week boundary and wall-clock label in the app is
 * computed in a SINGLE fixed zone: **GMT+8**. Not the server's zone, not the
 * browser's — one zone, so `/log` reads the same number wherever it is rendered.
 *
 * Why fixed rather than "local": the log is rendered in two places with two
 * different clocks. `groupByWeek` runs on the server (Vercel is UTC) while the
 * day grouping and the `09:14 – 10:52` range run in the browser. A session
 * started at 00:30 GMT+8 is 16:30 the PREVIOUS day in UTC, so the server filed it
 * under one week while the browser labelled it under another — the log showed a
 * date the session did not happen on. Pinning both to one zone removes the split.
 *
 * GMT+8 has no DST anywhere it is observed, so a fixed offset is exact — no
 * `Intl` lookup, no host-zone dependency, and the whole module stays pure and
 * unit-testable, which is what `lib/facts/` requires of anything it imports.
 *
 * TO CHANGE THE ZONE, change `APP_UTC_OFFSET_MINUTES` — it is the only knob, and
 * nothing else in the app may read the host clock's zone. If a future zone needs
 * DST, this module grows an `Intl.DateTimeFormat` implementation behind the same
 * function signatures rather than the callers growing date math.
 */

/** GMT+8. The single source of truth for the app's zone. */
export const APP_UTC_OFFSET_MINUTES = 8 * 60;

/** `GMT+8` / `GMT-5:30` — for labelling a timestamp when the zone matters. */
export const APP_TIME_ZONE_LABEL = formatOffsetLabel(APP_UTC_OFFSET_MINUTES);

function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`}`;
}

const OFFSET_MS = APP_UTC_OFFSET_MINUTES * 60_000;

/**
 * A `Date` shifted so its `getUTC*` accessors read as app-zone wall clock.
 *
 * The shifted value is NOT a real instant and must never be formatted, stored or
 * compared as one — it exists only so the accessors below can read calendar
 * fields without touching the host's zone. That is why it is private.
 */
function zoned(at: Date | string): Date {
  const ms = typeof at === "string" ? Date.parse(at) : at.getTime();
  return new Date(ms + OFFSET_MS);
}

/** `YYYY-MM-DD` for an instant, in the app zone. The day-grouping key. */
export function dateKey(at: Date | string): string {
  const d = zoned(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** The instant at which an app-zone `YYYY-MM-DD` begins. */
export function startOfDay(key: string): Date {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) - OFFSET_MS);
}

/** Calendar arithmetic on a `YYYY-MM-DD` key — no zone shift, no DST to skip. */
export function addDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of the MONDAY starting the app-zone week an instant falls in. */
export function mondayOf(at: Date | string): string {
  const key = dateKey(at);
  const weekday = (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -weekday);
}

/** `09:14` — 24-hour wall clock for an instant, in the app zone. */
export function clockHhMm(at: Date | string): string {
  const d = zoned(at);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Calendar fields of a `YYYY-MM-DD` key, for labels. Zone-free by construction. */
export function dayParts(key: string): { weekday: string; month: string; dayOfMonth: number } {
  const d = new Date(`${key}T00:00:00.000Z`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    dayOfMonth: d.getUTCDate(),
  };
}
