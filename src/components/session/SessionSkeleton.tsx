/**
 * A SHAPED skeleton, not the word "Loading…".
 *
 * `/log` has had one since the log-view brief, justified on disambiguation
 * grounds — a reader can tell "still arriving" from "there is nothing here". The
 * same argument applies with more force to the screen opened most (brief Gap,
 * resolved 2026-08-21).
 *
 * It matches the real layout's blocks — kind line, title, timer, why/finish-line
 * — so arrival does not reflow the page under a thumb already moving toward a
 * control. Deliberately shows no controls: an interrupt cell or a close button
 * that appears before the session it acts on would be a tap target aimed at
 * nothing.
 *
 * Two callers, one shape: `loading.tsx` (shown at once while the server reads the
 * session) and `SessionScreen` (shown for the one frame before hydration).
 */
export function SessionSkeleton() {
  return (
    <main aria-busy className="mx-auto max-w-xl space-y-6 p-6">
      <span className="sr-only">Loading this session</span>
      <header className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-7 w-3/5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-10 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <section className="space-y-2">
        <div className="h-4 w-4/5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </section>
    </main>
  );
}
