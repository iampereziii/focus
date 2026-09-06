import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { checklistItemsFor, createChecklistItem } from "@/lib/store/checklist-items";
import { createChecklistItemSchema } from "@/lib/validators";

/**
 * The in-session scratchpad (feature-brief-session-scratchpad-checklist.md).
 *
 * GET  — this session's items, oldest first (append order; there is no reordering).
 * POST — add one line.
 *
 * Both are scoped to ONE session by the path. Items are never surfaced on `/`, on
 * `/log`, or in a push notification: this is a working surface for the session
 * you are in, not another list to survey.
 *
 * A write against a CLOSED session is rejected by the DB trigger and comes back as
 * a 409, not a 500 — Rule 6 doing its job, scoped so that it governs the record of
 * work done rather than the surface used to do it.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  try {
    return apiOk(await checklistItemsFor(id));
  } catch (err) {
    return apiFailure(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = createChecklistItemSchema.safeParse(await req.json());
  if (!parsed.success) return invalidBody(parsed.error.issues);

  const { id } = await params;
  try {
    return apiOk(await createChecklistItem(id, parsed.data.text), 201);
  } catch (err) {
    return apiFailure(err);
  }
}
