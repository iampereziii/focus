"use client";

/**
 * Primitives. Deliberately small — this app has four screens and the design work
 * that matters is the seven-cell grid and the gate form, not a component library.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { clockHhMm } from "@/lib/time";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
  ghost: "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800",
  danger: "border border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

// React 19 passes `ref` as an ordinary prop to function components — no
// forwardRef needed. Quick capture focuses the `what` field on open, which is
// what keeps the 150 ms budget honest: the sheet is usable the moment it appears.
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300 ${className}`}
    />
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300 ${className}`}
    />
  );
}

/**
 * A labelled field with an INLINE error slot.
 *
 * The inline slot is not styling. The spec is explicit: a 422 for a missing WHY or
 * FINISH LINE is "surfaced inline on the gate form, never as a toast" — a toast
 * that disappears while you are mid-thought is exactly the wrong affordance for
 * the one moment the app is asking you to think.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint !== undefined && <span className="ml-2 text-xs opacity-60">{hint}</span>}
      <div className="mt-1">{children}</div>
      {error != null && error !== "" && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </label>
  );
}

/**
 * The `/log` kind vocabulary (feature-brief-log-view-information-architecture.md,
 * item D). EXACTLY four values — `kind`'s three members plus `drift`, which is a
 * status/correction, never a fourth `kind` (CLAUDE.md § 12). Colour is
 * preattentive and suits four values, but it is never the SOLE carrier (WCAG SC
 * 1.4.1) — the word renders too. Refuse a fifth colour: `status` (7 values) and
 * `interruptTag` (5) blow past the ~7–10 discriminability ceiling and stay text.
 */
export type BadgeVariant = "focus" | "pulled" | "filler" | "drift";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  focus: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  pulled: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  filler: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  drift: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function Badge({ variant }: { variant: BadgeVariant }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium ${BADGE_VARIANTS[variant]}`}
    >
      {variant}
    </span>
  );
}

/**
 * MOTION + TOKENS, added 2026-08-18 (feature-brief-backlog-ui-redesign.md).
 *
 * `Sheet` is shared with `QuickCapture`, so it is the ONE primitive this
 * backlog-scoped brief touches that is visible on every screen. Two deliberate
 * calls:
 *
 *   1. The token values were picked to RENDER IDENTICALLY to the neutrals they
 *      replace (`--surface` in dark = the old `neutral-900`), so quick capture
 *      does not visually change on `/log` or `/session/[id]` — screens this
 *      brief has no mandate over (Risk 6).
 *   2. The entrance is compositor-only (opacity + transform) and 130 ms. It does
 *      NOT delay the sheet existing or `whatRef.focus()` landing, both of which
 *      happen on the same render — so the ship-blocking "quick capture opens in
 *      under 150 ms" budget is measured against an unchanged code path. It is
 *      suppressed entirely under `prefers-reduced-motion`.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="focus-overlay-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="focus-sheet-in w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Renders a SETTLED duration from milliseconds — log rows, day-split buckets.
 *
 * Minute resolution on purpose. Seconds on a finished session are noise: nothing
 * on `/log` or `/review` is being read to the second, and the extra digits cost
 * scanning speed on the screen half the build gate is measured against.
 *
 * No stored timer anywhere (ADR-0002).
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Renders a RUNNING duration — `mm:ss`, rolling to `h:mm:ss` past the hour.
 *
 * A sibling of `formatDuration` rather than an option on it, because the two have
 * genuinely different jobs and three of the four call sites want the other one.
 * Seconds earn their place only here: a ticking display is the evidence that the
 * session is alive, which is precisely what went missing when `/` lost track of
 * an active interrupt.
 *
 * Still derived from `startedAt` on every render — this formats a number, it does
 * not count. Nothing accumulates, so backgrounding the tab cannot drift it.
 */
/**
 * A settled session's start/end as a 24-HOUR clock range — `09:14 – 10:52`, or
 * `09:14 – …` while open (item C). 24-hour was the weakest-evidenced call in the
 * brief that introduced this: no reading-speed study either way, just that a
 * 12-hour range repeats a meridiem twice per row for no information, and 24-hour
 * has no 12/24 ambiguity. APP-ZONE time (`lib/time`), matching every other
 * timestamp on `/log` — the browser's own zone is never read, so the clock cannot
 * disagree with the date heading the row sits under.
 */
export function formatTimeRange(startedAt: string, endedAt: string | null): string {
  return `${clockHhMm(startedAt)} – ${endedAt === null ? "…" : clockHhMm(endedAt)}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
