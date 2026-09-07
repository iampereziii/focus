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

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
  ghost: "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800",
  danger: "border border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950",
};

/**
 * `pending` — THE IN-FLIGHT STATE, and the reason `disabled` stopped being the
 * whole vocabulary (feature-brief-write-path-latency-and-in-flight-feedback.md,
 * Slice A).
 *
 * Before this, a write control could only go grey. Grey says "you cannot press
 * this"; it does not say "the thing you pressed is happening", and on the
 * close-out — the slowest and most-tapped path in the app — it did not even do
 * that. The budget is 100 ms from tap to a visible change, which is a RENDERING
 * budget: it is met by this spinner appearing, not by the network answering.
 *
 * IT IS NOT OPTIMISM. ADR-0002 has writes fail loudly rather than optimistically,
 * and nothing here anticipates success — the label does not change, the row is
 * not removed, the screen does not advance. It reports that a request is in
 * flight, which is true for as long as it is shown and stops being shown either
 * way. `BacklogList.dropTask`'s animate-during-request-and-settle-back is the
 * same shape (brief Risk 7).
 *
 * `pending` implies `disabled`, so a caller never has to remember both — and
 * the disabled dimming is lifted while pending, because a spinner at 40% opacity
 * is a worse signal than no spinner.
 */
export function Button({
  variant = "primary",
  className = "",
  pending = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled === true || pending}
      aria-busy={pending || undefined}
      className={`tap inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition compact:rounded-md compact:px-3 compact:py-1.5 compact:text-xs ${
        pending ? "cursor-progress" : "disabled:opacity-40"
      } ${VARIANTS[variant]} ${className}`}
    >
      {pending && (
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

/**
 * A SEGMENTED CONTROL — one row, equal columns, and it CANNOT overflow.
 *
 * This exists because the same shape was hand-rolled four times as
 * `<div className="flex gap-2">` full of `Button`s, and all four broke the same
 * way in a narrow window: the gate's interval row (`30 min / 60 min / 90 min /
 * Off`) needs ~352 px of `px-4` buttons inside a ~288 px sheet at 360 px, so the
 * labels wrapped onto two lines. `flex` with intrinsic children has no answer to
 * that; `grid-template-columns: repeat(n, minmax(0, 1fr))` does — the row is
 * exactly as wide as its container and the labels truncate rather than reflow.
 *
 * ONE PRIMITIVE, TWO JOBS, and the difference is whether `value` is passed:
 *   · a CHOICE (the gate's interval) passes `value`, and the matching segment
 *     carries the primary fill — it is showing state.
 *   · an ACTION ROW (the filler waits, the close-out statuses, the check-in
 *     answers) passes none, so nothing is filled; every segment is a verb.
 * They are the same control because they are the same gesture — one row, one
 * tap, no wrapping — not because the states are alike.
 *
 * `pending` names WHICH segment is in flight, exactly as `Button.pending` does
 * and for the same reason (feature-brief-write-path-latency-and-in-flight-
 * feedback.md): the pressed one spins while its siblings go inert, so the
 * feedback says which choice is being recorded. It is not optimism — nothing
 * here anticipates the write succeeding.
 *
 * `tap` puts the 40 px touch floor on the group (`globals.css`), because the
 * two most tap-budgeted rows in the app — the filler waits and the check-in
 * answers — render through this.
 */
export function SegmentedControl<T extends string | number | null>({
  options,
  value,
  onChange,
  pending = null,
  disabled = false,
  label,
  className = "",
}: {
  options: readonly { value: T; label: string }[];
  /** Omit for an action row; pass to mark one segment as the current choice. */
  value?: T;
  onChange: (value: T) => void;
  /** The segment whose write is in flight, or null. */
  pending?: T | null;
  disabled?: boolean;
  /** Accessible name for the group — required whenever no visible label sits above it. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`tap grid overflow-hidden rounded-lg border border-border-strong compact:rounded-md ${className}`}
      // Column count is data, not a style choice, so it is inline rather than a
      // Tailwind class — `grid-cols-${n}` would need every arity present in the
      // source for the compiler to emit it.
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt, i) => {
        const selected = value !== undefined && opt.value === value;
        // `null` is a legitimate VALUE here (the interval's `Off`), so a busy
        // segment is only ever one whose value matches a non-null `pending`.
        const busy = pending !== null && pending === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={value === undefined ? undefined : selected}
            aria-busy={busy || undefined}
            disabled={disabled || pending !== null}
            onClick={() => onChange(opt.value)}
            className={`inline-flex min-w-0 items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground compact:py-1.5 compact:text-xs ${
              i > 0 ? "border-l border-border-strong" : ""
            } ${selected ? "bg-foreground text-background" : "hover:bg-surface-hover"} ${
              busy ? "cursor-progress" : "disabled:opacity-40"
            }`}
          >
            {busy && (
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
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
      className={`w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 compact:rounded-md compact:px-2.5 compact:py-1.5 compact:text-[0.8125rem] dark:border-neutral-700 dark:focus:border-neutral-300 ${className}`}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 compact:rounded-md compact:px-2.5 compact:py-1.5 compact:text-[0.8125rem] dark:border-neutral-700 dark:focus:border-neutral-300 ${className}`}
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
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  /**
   * For the caller to place the field in a layout — the pairing rows in
   * `GateForm` and `PromoteForm` need `compact:min-w-[13rem] compact:flex-1` on
   * the field itself, and wrapping every one in a spare `<div>` to carry it
   * would put a second element between the row and its label.
   */
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium compact:text-[0.6875rem]">{label}</span>
      {hint !== undefined && (
        <span className="ml-2 text-xs opacity-60 compact:text-[0.6875rem]">{hint}</span>
      )}
      <div className="mt-1 compact:mt-0.5">{children}</div>
      {error != null && error !== "" && (
        <p className="mt-1 text-xs text-red-600 compact:mt-0.5 compact:text-[0.6875rem] dark:text-red-400">
          {error}
        </p>
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
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium compact:px-1 compact:text-[0.625rem] ${BADGE_VARIANTS[variant]}`}
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
 *
 * ── SHORT VIEWPORTS, 2026-08-26 (feature-brief-gate-sheet-short-viewport.md) ──
 *
 * This is the ONLY container in the app that is `position: fixed`. Everything
 * else — `/`, `/session/[id]`, `/log` — is ordinary document flow, so content
 * taller than the window merely scrolls. Here it did not: it was CLIPPED, and a
 * fixed overlay does not move when the page behind it scrolls. Measured on a
 * 1366×768 laptop (681 px of viewport), the five-field gate rendered 732 px tall
 * and put `Cancel` past the fold; with the two inline errors the gate itself
 * raises for an empty WHY or FINISH LINE it rendered 772 px and put `START`
 * past the fold. Unreachable, by any gesture. The gate is the only door into
 * this app (ADR-0004) and rejecting an empty WHY is the gate WORKING — so the
 * failure landed exactly where the contract is being enforced.
 *
 * Two changes, in this order of importance:
 *
 *   1. `overflow-y-auto` — the GUARANTEE. Whatever the height, whatever the
 *      error state, whatever the browser zoom, the sheet's controls can always
 *      be reached. This is the part that must never be removed.
 *   2. The COMPACT PASS, so the guarantee is rarely needed. It reclaims the
 *      decorative top offset and the sheet's own padding on small viewports
 *      only. Above the threshold every rendered pixel is byte-identical.
 *
 * NOT the fix: cutting a field, or ADR-0004's "chunk the gate into two steps".
 * The field count is a decided contract, this is a rendering defect, and one is
 * not a licence to spend the other.
 *
 * ── FULL-BLEED, AND ONE SHARED THRESHOLD, 2026-09-07 ────────────────────────
 * (feature-brief-design-system-pass.md)
 *
 * The 800 px height threshold above was written here as a literal
 * `[@media(max-height:800px)]` and again in `GateForm`. It is now the `compact`
 * variant in `globals.css` — same number, declared once, and `short-viewport-
 * gate.test.ts` pins it there. That variant also gained a `max-width: 520px`
 * arm, which this file did not have and which the gate needs: at 360 px the
 * sheet interior is ~288 px and the interval row's four buttons wanted ~352 px.
 *
 * Under `compact` the sheet stops being a card and becomes the screen: no
 * overlay inset, no top offset, no max-width, no corner radius, no shadow. That
 * is ~90 px of vertical and ~72 px of horizontal room at 360 px, none of it
 * taken from the form. The overlay still scrolls — it simply no longer has to.
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
      className="focus-overlay-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 pt-24 compact:p-0"
      onClick={(e) => {
        // A click on the overlay's OWN SCROLLBAR reports the overlay as its
        // target, so the dismiss-on-backdrop handler would fire on it — and
        // dismissing the gate discards everything typed into it. The scrollbar
        // only exists now that the overlay scrolls, so the guard ships with the
        // scrolling rather than after someone loses a WHY to it.
        if (e.nativeEvent.offsetX > e.currentTarget.clientWidth) return;
        onClose();
      }}
    >
      <div
        className="focus-sheet-in w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl compact:min-h-full compact:max-w-none compact:rounded-none compact:border-0 compact:p-3 compact:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted compact:mb-2 compact:text-[0.6875rem]">
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
 * has no 12/24 ambiguity. Local time, matching every other timestamp on `/log`.
 */
export function formatTimeRange(startedAt: string, endedAt: string | null): string {
  const clock = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${clock(startedAt)} – ${endedAt === null ? "…" : clock(endedAt)}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
