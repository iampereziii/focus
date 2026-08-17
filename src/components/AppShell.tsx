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
 * Quick capture lives HERE rather than on any page, because Rule 9 requires it
 * reachable from everywhere by a keyboard shortcut and a persistent button. It is
 * deliberately not a route: a route would cost a navigation on the one path the
 * whole project is measured against.
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
      <nav className="flex items-center gap-4 border-b border-neutral-200 px-6 py-3 text-sm dark:border-neutral-800">
        <Link href="/">Backlog</Link>
        <Link href="/log">Log</Link>
        <Link href="/review">Review</Link>
        {active !== null && !onSessionScreen && <ActiveSessionLink session={active} />}
      </nav>
      {children}
      <QuickCapture onCaptured={() => router.refresh()} />
    </>
  );
}
