import "server-only";

/**
 * Web push — ONE implementation serving BOTH prompt rules.
 *
 * Rule 18's `filler` return prompt and Rule 26's check-in probe use this module
 * and no other. 26c is explicit: DO NOT BUILD A SECOND PROMPT CLASS. If you are
 * writing a second push code path, stop.
 *
 * The phrasing discipline is a rule, not a style note: the prompt is ALWAYS A
 * QUESTION, NEVER A CLAIM. "Still waiting?" — never "your build finished," which
 * the app cannot verify and which spends credibility it depends on.
 *
 * An EMPTY subscriptions table is a UI state, not just an absence. Without a
 * subscription both rules degrade to foreground-only *silently*, which is the
 * state ADR-0003 says should cause `filler` to be cut — so the app must surface
 * whether the prompt can actually reach the user rather than assuming it can.
 * `hasSubscription()` is what the UI asks.
 */

import webpush from "web-push";
import { supabaseServer } from "@/lib/supabase/server";
import { toPushSubscription } from "./mappers";
import type { PushSubscriptionRecord } from "@/types/db";

let configured = false;

/**
 * VAPID needs a SUBJECT as well as the key pair — `web-push` requires
 * `setVapidDetails(subject, publicKey, privateKey)`. The spec's env table listed
 * only the two keys; the subject was added by the schema/build audit.
 */
function configure(): boolean {
  if (configured) return true;

  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function upsertSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<PushSubscriptionRecord> {
  const { data, error } = await supabaseServer()
    .from("push_subscriptions")
    .upsert(
      {
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return toPushSubscription(data);
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const { data, error } = await supabaseServer().from("push_subscriptions").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPushSubscription);
}

/** Whether a prompt can actually reach the user. Rule 18 requires surfacing this. */
export async function hasSubscription(): Promise<boolean> {
  const { count, error } = await supabaseServer()
    .from("push_subscriptions")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function dropStale(endpoint: string): Promise<void> {
  await supabaseServer().from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export interface Prompt {
  title: string;
  body: string;
  /** Where `notificationclick` should land. */
  url: string;
  tag: string;
}

/**
 * Sends one prompt to every registered device.
 *
 * Returns the number of devices reached, so a caller can tell "nobody was
 * subscribed" from "the send failed" — the distinction Rule 18 asks the UI to
 * surface. A 404/410 from the push service means the endpoint is dead; drop it
 * rather than retrying it forever.
 */
export async function sendPrompt(prompt: Prompt): Promise<number> {
  if (!configure()) return 0;

  const subs = await listSubscriptions();
  let delivered = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(prompt),
      );
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await dropStale(sub.endpoint);
    }
  }
  return delivered;
}
