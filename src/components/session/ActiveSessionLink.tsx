"use client";

/**
 * The shell's active-session indicator.
 *
 * Rule 12 collapses the backlog once work starts, and Rule 1 gives `/session/[id]`
 * the whole screen — but neither says the running session should become invisible
 * from `/log` and `/review`. It did, and the app read as though it had closed the
 * session behind your back. It hadn't; there was simply no door back.
 *
 * This is that door, and nothing more. It NAMES the session and LINKS to it. It
 * cannot close, classify, suspend or re-arm anything — the whole file has no write
 * path, which is what keeps a clock in the app shell compatible with Rule 7.
 *
 * Minute resolution deliberately: `formatDuration`, not `formatElapsed`. The
 * to-the-second clock is part of the session screen's job, and a seconds counter
 * ticking in the chrome of every page is exactly the kind of ambient urgency this
 * app is supposed to remove.
 */

import Link from "next/link";
import { formatDuration } from "@/components/ui";
import { useElapsed } from "@/components/ui/useElapsed";
import type { Session } from "@/types/db";

export function ActiveSessionLink({ session }: { session: Session }) {
  const elapsed = useElapsed(session.startedAt);

  return (
    <Link
      href={`/session/${session.id}`}
      className="ml-auto flex min-w-0 items-center gap-2 rounded-full border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      title="Back to the session that is still running"
    >
      <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
        ●
      </span>
      <span className="max-w-[16ch] truncate sm:max-w-[28ch]">{session.what}</span>
      <span className="font-mono tabular-nums opacity-60">{formatDuration(elapsed)}</span>
    </Link>
  );
}
