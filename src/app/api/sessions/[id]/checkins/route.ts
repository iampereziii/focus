import { apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { checkInsForSessions, recordPrompt } from "@/lib/store/checkins";

/**
 * Rule 26e — EVERY PROMPT IS RECORDED, ANSWERED OR NOT.
 *
 * ⚠️ ADDED 2026-08-17 — the second writer FOCUS-0 identified as missing. The
 * `CheckIn` table, its mapper and `answerCheckInSchema` all existed; no route
 * created a row or accepted an answer.
 *
 * POST creates the row at the moment the prompt fires — BEFORE any answer exists.
 * That ordering is the whole mechanism: an unanswered row is what marks
 * `promptedAt` → the next answer (or session close) as an `unaccounted` window
 * that Rule 22 subtracts and Rule 24 buckets.
 *
 * This does NOT contradict 26b. Silence still changes nothing about the SESSION —
 * no close, no status change, no classification forced on you. It changes a
 * DERIVED figure at review, displayed as a bare fact and carrying the same
 * optional, never-forced reclassification as Rules 21 and 24. The distinction to
 * hold onto: the app never acts on silence, but it does stop crediting it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  try {
    return apiOk(await recordPrompt(id), 201);
  } catch (err) {
    return apiFailure(err);
  }
}

/** GET — this session's prompts, answered and not. Feeds the review split. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  try {
    return apiOk(await checkInsForSessions([id]));
  } catch (err) {
    return apiFailure(err);
  }
}
