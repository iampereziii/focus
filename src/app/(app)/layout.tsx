"use client";

/**
 * The signed-in shell.
 *
 * Quick capture lives HERE rather than on any page, because Rule 9 requires it
 * reachable from everywhere by a keyboard shortcut and a persistent button. It is
 * deliberately not a route: a route would cost a navigation on the one path the
 * whole project is measured against.
 *
 * The ACTIVE-SESSION INDICATOR lives here for the same reason — "everywhere" is a
 * property of the shell, not of any one page. It is shown on every route except
 * the session screen itself, where it would be a link to the page you are on.
 *
 * NOTE ON RENDERING (build deviation, 2026-08-17): the spec's Routes table marks
 * `/`, `/log` and `/review` as SSR. They are client-rendered here, because the
 * scaffold authenticates with a bearer token held by the browser
 * (`lib/store/auth.ts`) rather than a server-readable cookie session. Real SSR
 * needs `@supabase/ssr` and a cookie-based client — a contained swap, since every
 * page already reads through `lib/api.ts`. Flagged rather than silently changed;
 * it affects rendering strategy, not behaviour.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { QuickCapture } from "@/components/capture/QuickCapture";
import { ActiveSessionLink } from "@/components/session/ActiveSessionLink";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@/types/db";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState<Session | null>(null);

  useEffect(() => {
    // Protected surface is everything except `/login`. This doubles as the
    // active-session probe: one row, one request, re-run on every navigation so
    // the indicator appears and clears without polling and without a timer.
    api
      .get<Session | null>("/api/sessions/active")
      .then((session) => {
        setActive(session);
        setChecked(true);
      })
      .catch((err: unknown) => {
        // Only a 401 means "not signed in". A transient failure must not throw the
        // architect out to /login mid-session — this runs on every navigation now.
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setChecked(true);
      });
  }, [router, pathname]);

  if (!checked) return null;

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
