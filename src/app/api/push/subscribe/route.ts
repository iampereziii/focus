import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { hasSubscription, upsertSubscription } from "@/lib/store/push";
import { pushSubscribeSchema } from "@/lib/validators";

/**
 * POST — store the push subscription (Rule 18, Gap 17c).
 *
 * ⚠️ This route existed in the scaffold and in the Repo Scaffold tree, but had NO
 * ROW in the spec's API Routes table — so no auth level and no described
 * behaviour. Flagged by the 2026-08-16 review; add the row in FOCUS-0.
 *
 * Rows are DEVICES, not people — single user, no relationships. One subscription
 * serves BOTH prompt rules: Rule 18's `filler` return prompt and Rule 26's
 * check-in probe. A second push code path is a bug (26c).
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = pushSubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    const record = await upsertSubscription({
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return apiOk({ id: record.id, endpoint: record.endpoint }, 201);
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * GET — can a prompt actually reach this user?
 *
 * AN EMPTY TABLE IS A UI STATE, NOT JUST AN ABSENCE. Without a subscription, Rules
 * 18 and 26 degrade to foreground-only *silently* — which is the state ADR-0003
 * says should cause `filler` to be cut. Rule 18 requires the app to SURFACE that
 * rather than assume the prompt is working, so the UI asks this and says so.
 */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  try {
    const reachable = await hasSubscription();
    const configured =
      Boolean(process.env.VAPID_SUBJECT) &&
      Boolean(process.env.VAPID_PUBLIC_KEY) &&
      Boolean(process.env.VAPID_PRIVATE_KEY);
    return apiOk({ reachable, configured });
  } catch (err) {
    return apiFailure(err);
  }
}
