/**
 * The signed-in shell.
 *
 * SSR since 2026-08-18 (feature-brief-cookie-session-ssr-swap.md, resolving the
 * build deviation flagged here on 2026-08-17). Auth is now gated by
 * `src/proxy.ts` before this ever renders — everything under `(app)` is
 * guaranteed signed-in — and the ACTIVE-SESSION INDICATOR's data is read ONCE,
 * server-side, right here, instead of by a client `useEffect` racing `/`'s own
 * identical fetch. There is no more "return null until a fetch resolves" frame:
 * the check happens before the client ever mounts.
 *
 * "Everywhere" (nav, quick capture, the indicator) is a property of the shell,
 * not of any one page, which is why it's a layout and not per-page state. The
 * interactive parts (pathname-aware indicator visibility, quick capture) live in
 * the client child `AppShell`.
 *
 * REACTIVE UI (feature-brief-reactive-ui-writes-invalidate-reads.md, 2026-08-18):
 * `/log`, `/session/[id]` and `/review` are still client components (the SSR
 * swap's own follow-up-slice note above), so they still fetch client-side and
 * still need to go live rather than fetch-once. `<SWRConfig>` provides the four
 * mandatory opt-outs (Risk 1) for all of them, plus QuickCapture's topic list —
 * kept in this ONE place, same requirement as before the swap, just moved to
 * wrap `AppShell` instead of living inside it (this file doesn't need "use
 * client" to render a client component from the `swr` package). It does NOT
 * cover `/` or the active-session indicator any more: both read straight from
 * this Server Component now, with no client fetch for a `useLive` to subscribe
 * to — their liveness comes from `AppShell`'s `router.refresh()` on capture,
 * which is genuinely live post-swap instead of the pre-swap no-op.
 */

import { SWRConfig } from "swr";
import { activeSession } from "@/lib/store/sessions";
import { AppShell } from "@/components/AppShell";

/**
 * This layout wraps `/log` and `/review` too, and both still fetch client-side
 * (a follow-up slice, not this brief). Without forcing dynamic here, Next.js has
 * no signal that the indicator's `activeSession()` read needs to run per
 * request, and would bake one build-time snapshot into every route under
 * `(app)` — stale for exactly as long as the app stays deployed.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const active = await activeSession();

  return (
    <SWRConfig
      value={{
        // Four mandatory opt-outs (Risk 1) — kept in exactly this one place. A
        // per-hook override re-enabling any of these is the same class of change
        // as an eslint-disable on the ADR-0002 guardrails: stop and flag it.
        revalidateOnFocus: false, // Rule 7 — no re-read just because you tabbed back
        revalidateOnReconnect: false, // ADR-0002 — the network is assumed, not monitored
        dedupingInterval: 0, // no cache: every invalidate re-asks the server
        keepPreviousData: false, // no cache: nothing survives a key going stale
      }}
    >
      <AppShell active={active}>{children}</AppShell>
    </SWRConfig>
  );
}
