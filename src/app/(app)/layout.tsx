"use client";

/**
 * The signed-in shell.
 *
 * Quick capture lives HERE rather than on any page, because Rule 9 requires it
 * reachable from everywhere by a keyboard shortcut and a persistent button. It is
 * deliberately not a route: a route would cost a navigation on the one path the
 * whole project is measured against.
 *
 * NOTE ON RENDERING (build deviation, 2026-08-17): the spec's Routes table marks
 * `/`, `/log` and `/review` as SSR. They are client-rendered here, because the
 * scaffold authenticates with a bearer token held by the browser
 * (`lib/store/auth.ts`) rather than a server-readable cookie session. Real SSR
 * needs `@supabase/ssr` and a cookie-based client — a contained swap, since every
 * page already reads through `lib/api.ts`. Flagged rather than silently changed;
 * it affects rendering strategy, not behaviour.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { QuickCapture } from "@/components/capture/QuickCapture";
import { api } from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Protected surface is everything except `/login`.
    api
      .get("/api/topics")
      .then(() => setChecked(true))
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!checked) return null;

  return (
    <>
      <nav className="flex gap-4 border-b border-neutral-200 px-6 py-3 text-sm dark:border-neutral-800">
        <Link href="/">Backlog</Link>
        <Link href="/log">Log</Link>
        <Link href="/review">Review</Link>
      </nav>
      {children}
      <QuickCapture onCaptured={() => router.refresh()} />
    </>
  );
}
