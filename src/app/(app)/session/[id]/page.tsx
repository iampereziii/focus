import { notFound } from "next/navigation";
import { SessionScreen } from "@/components/session/SessionScreen";
import { sessionWithRelations } from "@/lib/store/sessions";
import { sessionIdSchema } from "@/lib/validators";

/**
 * `/session/[id]` — the workspace. One task, a derived timer, the interrupt tap,
 * and the close-out. Nothing else.
 *
 * A SERVER COMPONENT since FOCUS-16 (feature-brief-write-path-latency-and-in-
 * flight-feedback.md, Slice H, Finding 11). It used to be a client page that
 * arrived empty and then fetched `GET /api/sessions/[id]` — two requests in a
 * row, each through the proxy, on the screen every Start, interrupt and resume
 * lands on. It now reads the session while it renders and hands it to
 * `SessionScreen`, so the data comes in the same response as the page.
 *
 * What did NOT change: `SessionScreen` keeps the `useLive("sessions", …, id)`
 * subscription, so a write made from this screen or another still updates it, and
 * the read goes through `lib/store/` like every other (guardrail (a)). It also
 * still resolves the session's PARENT and its children — closing an interrupt
 * resumes that parent (Rules 16/17), and both the confirmation and the failure
 * message have to NAME it.
 *
 * NOT SIGNED IN? `src/proxy.ts` redirects every page load to `/login` before this
 * runs, so there is no auth check to repeat here.
 *
 * NO REDIRECT FOR A CLOSED SESSION HERE. `SessionView` leaves a closed row for `/`
 * itself, and suppresses that while a close or promote is mid-flight, because a
 * redirect at the wrong moment races the real destination (`Back to "<parent>"`
 * lands on a session, not `/`). A server-side `redirect()` could not know that.
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // A mistyped id is "no such session", not a database error.
  if (!sessionIdSchema.safeParse(id).success) notFound();

  const found = await sessionWithRelations(id);
  if (found === null) notFound();

  // `key` resets the client state when the URL moves between two sessions.
  return <SessionScreen key={id} id={id} initial={found} />;
}
