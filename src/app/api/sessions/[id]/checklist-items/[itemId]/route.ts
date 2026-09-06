import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { deleteChecklistItem, updateChecklistItem } from "@/lib/store/checklist-items";
import { updateChecklistItemSchema } from "@/lib/validators";

/**
 * One checklist item — tick it, retitle it, or remove it.
 *
 * PATCH accepts `text`, `done`, or both; an empty body is a 422 rather than a
 * silent no-op.
 *
 * DELETE is the app's SECOND delete path, after `push_subscriptions`, and the
 * reason it exists is narrow: a line you typed by mistake never represented
 * completed work, so removing it while the session is open erases nothing from the
 * record. **Sessions still have no delete path and must never gain one** — a wrong
 * close is corrected by the next row, not by editing.
 *
 * Both verbs hit the DB trigger first: once the parent session has an `ended_at`,
 * its checklist is frozen and the write comes back 409 (Rule 6).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = updateChecklistItemSchema.safeParse(await req.json());
  if (!parsed.success) return invalidBody(parsed.error.issues);

  const { itemId } = await params;
  try {
    return apiOk(await updateChecklistItem(itemId, parsed.data));
  } catch (err) {
    return apiFailure(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { itemId } = await params;
  try {
    await deleteChecklistItem(itemId);
    return apiOk({ deleted: itemId });
  } catch (err) {
    return apiFailure(err);
  }
}
