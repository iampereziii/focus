import { apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { activeSession } from "@/lib/store/sessions";

/**
 * GET — the one session Rule 1 permits, or `null`.
 *
 * A one-row question deserves a one-row answer. The callers that need this (`/`'s
 * redirect, the shell's active-session indicator, `/review`'s day-close question)
 * previously had to fetch a page of the log and walk the week tree to find it —
 * which is how the tree got walked only one level deep and an active interrupt
 * became invisible. See `lib/session-tree.ts`.
 *
 * READ ONLY, and pointedly so. Nothing here closes, suspends or reclassifies
 * anything: knowing a session is active is not a reason to act on it (Rules 6, 7).
 */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  try {
    return apiOk(await activeSession());
  } catch (err) {
    return apiFailure(err);
  }
}
