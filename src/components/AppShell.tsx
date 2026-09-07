"use client";

/**
 * The signed-in shell's INTERACTIVE half.
 *
 * `(app)/layout.tsx` is a Server Component now (feature-brief-cookie-session-ssr-
 * swap.md) — it resolves the active session once, server-side, and hands it down
 * here. This client component owns only what a Server Component can't: reading
 * the current pathname (to hide the active-session indicator on the session
 * screen itself) and `QuickCapture`'s open/close state.
 *
 * The gate lives HERE rather than on any page, so it is reachable from
 * everywhere by a keyboard shortcut and a persistent button. It is deliberately
 * not a route: a route would cost a navigation on the one path the whole
 * project is measured against.
 *
 * (That requirement used to be Rule 9's, phrased as "quick capture reachable
 * from every page." Rule 9 is retired by ADR-0004 and the reachability
 * requirement outlived it — what ⌘K opens changed; that it opens from anywhere
 * did not.)
 *
 * `active` is passed down to `QuickCapture` so ⌘K can decide what to do with
 * ZERO latency: with a session running it navigates there instead of opening a
 * gate that Rule 1 would only reject.
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { QuickCapture } from "@/components/capture/QuickCapture";
import { ActiveSessionLink } from "@/components/session/ActiveSessionLink";
import { sweepScratchDrafts } from "@/lib/scratch-draft";
import type { Session } from "@/types/db";

export function AppShell({
  active,
  children,
}: {
  active: Session | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // On the session screen the indicator would link to the current page.
  const onSessionScreen = pathname.startsWith("/session/");

  // SCRATCH-PAD SWEEP (feature-brief-session-scratch-pad.md, Risk 3). A genuine
  // side effect — not state derived from a prop — so this is an effect rather
  // than the render-time adjustment pattern used elsewhere in this app. Keyed on
  // `active`'s id rather than run truly once: harmless to re-run (there is only
  // ever one active session to keep, Rule 1), and re-running when a session
  // starts or ends catches a draft stranded by whatever just changed instead of
  // waiting for the next full app load.
  useEffect(() => {
    sweepScratchDrafts(active === null ? null : active.id);
  }, [active]);

  return (
    <>
      {/*
        THE NAV IS ALSO THE START AFFORDANCE (feature-brief-design-system-pass.md,
        2026-09-07). `QuickCapture` used to render a 56 px floating `+` fixed at
        `bottom-6 right-6` — the ONLY `position: fixed` control in the app outside
        the gate overlay — and in a small window it landed squarely on top of
        `Close out` on the session screen and `Load older weeks` on `/log`. A
        floating button cannot be laid out around; a nav one can, so it moved here.

        Moved at EVERY size, not only under `compact`. Keeping the circle above the
        breakpoint would leave two start affordances alive for one act, and the
        cheaper of the two would still be the one covering things.

        `showTrigger` hides it on the session screen, where it is a no-op: with a
        session running `openGate` navigates to that session (Rule 1 would reject a
        second start), i.e. to the page you are already on. ⌘K is untouched and
        still bound from every page — including this one, which is why
        `QuickCapture` stays mounted rather than being conditionally rendered.
      */}
      <nav className="flex items-center gap-4 border-b border-border px-6 py-3 text-sm compact:gap-3 compact:px-2.5 compact:py-1.5 compact:text-xs">
        {/* ADR-0004: `/` is not an inbox any more. See BacklogList for the copy. */}
        <Link href="/">Unfinished</Link>
        <Link href="/log">Log</Link>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {active !== null && !onSessionScreen && <ActiveSessionLink session={active} />}
          <QuickCapture
            active={active}
            showTrigger={!onSessionScreen}
            onCaptured={() => router.refresh()}
          />
        </div>
      </nav>
      {children}
    </>
  );
}
