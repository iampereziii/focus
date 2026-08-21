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

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { QuickCapture } from "@/components/capture/QuickCapture";
import { ActiveSessionLink } from "@/components/session/ActiveSessionLink";
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

  return (
    <>
      <nav className="flex items-center gap-4 border-b border-border px-6 py-3 text-sm">
        {/* ADR-0004: `/` is not an inbox any more. See BacklogList for the copy. */}
        <Link href="/">Unfinished</Link>
        <Link href="/log">Log</Link>
        {active !== null && !onSessionScreen && <ActiveSessionLink session={active} />}
      </nav>
      {children}
      <QuickCapture active={active} onCaptured={() => router.refresh()} />
    </>
  );
}
