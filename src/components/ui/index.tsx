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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide opacity-60">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** Renders a duration from milliseconds. No stored timer anywhere (ADR-0002). */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
