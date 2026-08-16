import { apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { sessionsBetween, suspendedSessions } from "@/lib/store/sessions";
import { checkInsForSessions } from "@/lib/store/checkins";
import { hasSubscription } from "@/lib/store/push";
import {
  coveredWallTimeMs,
  daySplit,
  dayWallTimeMs,
  driftCapturePaths,
  focusInterruptRatio,
  splitBalances,
} from "@/lib/facts";

/**
 * GET — everything `/review` needs, for one day.
 *
 * ALL COMPUTED IN `lib/facts/`, deterministically. NO AI (Rule 11). The AI layer
 * is cut from v1 entirely (Gaps 3 & 4) — the problem is flattening and protection,
 * not ranking, and there is no logged data to rank against yet.
 *
 * The five jobs this feeds, in the order the spec fixes them:
 *   1. stack disposal        — `suspended`, every one needs a disposition (Rule 23)
 *   2. kind correction       — write-once, day review only (Rule 21)
 *   3. unaccounted display   — bare facts; reclassification offered, never forced
 *   4. drift-capture         — the three paths + whether the probe was armed AND
 *                              answered, which is what A9's falsifier needs
 *   5. focus:interrupt ratio — two bare lines, no interpretation
 *
 * ⚠️ IF THIS SCREEN HAS TO BE CUT DOWN, CUT JOB 1 FIRST (stack disposal, the
 * newest) — never the review itself. ADR-0003 makes that ordering explicit, and
 * A12 says review is the bottleneck the whole design leans on.
 */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const url = new URL(req.url);
  const dayParam = url.searchParams.get("day");
  const dayStart = new Date(`${dayParam ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();

  try {
    // Sessions that OVERLAP the day, not only those that started in it — an
    // overnight tail belongs to the day it runs into (Rule 24 source (a)).
    const windowStart = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
    const sessions = (await sessionsBetween(windowStart.toISOString(), dayEnd.toISOString()))
      .filter((s) => {
        const end = s.endedAt === null ? now.getTime() : Date.parse(s.endedAt);
        return end > dayStart.getTime();
      });

    const checkIns = await checkInsForSessions(sessions.map((s) => s.id));
    const split = daySplit(sessions, checkIns, dayStart, now);
    // Clipped to the SAME window `daySplit` uses. An overnight session's hours in
    // yesterday belong to yesterday's denominator, not today's — otherwise the
    // buckets under-sum by exactly that tail and `balances` reads false on a day
    // where nothing is actually wrong.
    const covered = coveredWallTimeMs(sessions, now, {
      from: dayStart.getTime(),
      to: dayEnd.getTime(),
    });

    return apiOk({
      day: dayStart.toISOString().slice(0, 10),

      // Job 1. `/review` refuses to complete while any of these remain.
      suspended: await suspendedSessions(),

      // Job 2. Uncorrected interrupts — the pass is optional and one-time.
      uncorrected: sessions.filter(
        (s) => s.kind !== "focus" && s.kindCorrectedAt === null && s.endedAt !== null,
      ),

      // Job 3 + the arithmetic. `balances` is the Gap 21 guard, surfaced rather
      // than asserted: if it is ever false, something subtracted has no bucket.
      split,
      coveredWallTimeMs: covered,
      dayWallTimeMs: dayWallTimeMs(sessions, now),
      balances: splitBalances(split, covered),

      // Job 4. Both halves — the paths AND the probe state.
      drift: driftCapturePaths(sessions, checkIns),

      // Job 5. Two bare counts.
      ratio: focusInterruptRatio(sessions),

      // Rule 18 requires the app to surface whether a prompt can reach the user
      // at all, rather than degrading to foreground-only in silence.
      promptReachable: await hasSubscription(),
    });
  } catch (err) {
    return apiFailure(err);
  }
}
