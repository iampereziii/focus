"use client";

/**
 * THE SCRATCH PAD'S DRAFT — client-side only, and deliberately NOT a write.
 *
 * Nothing here ever reaches the server. It exists so a thought survives a
 * refresh or a trip to `/log` while a session is open; it does not survive a
 * close. See feature-brief-session-scratch-pad.md — the pad went through a
 * revision that cut a `scratch_note` column, a migration and three RPC
 * changes down to exactly this: unsent input, wiped on close, no precedent
 * for storing anything real on the client (ADR-0002 stays untouched — there
 * is no write queue here, because there is no write).
 *
 * Every access is wrapped: a private window, cleared site data, or storage
 * the OS evicted under pressure all make `localStorage` throw or return
 * nothing. That degrades this to in-memory-for-the-page-view, SILENTLY — the
 * brief's Risk 6 is explicit that no warning is shown for it, unlike the
 * notification-permission surface, because there is nothing the architect
 * could do about it and a caveat here is the ceremony the pad exists to avoid.
 */

const PREFIX = "focus:scratch:";

function keyFor(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function readScratchDraft(sessionId: string): string {
  try {
    return window.localStorage.getItem(keyFor(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function writeScratchDraft(sessionId: string, text: string): void {
  try {
    if (text === "") {
      window.localStorage.removeItem(keyFor(sessionId));
    } else {
      window.localStorage.setItem(keyFor(sessionId), text);
    }
  } catch {
    // Storage unavailable — the pad still works for this page view, it just
    // won't survive a refresh. Nothing to surface (brief Risk 6).
  }
}

/** Called on every successful close, on the id that was actually closed. */
export function clearScratchDraft(sessionId: string): void {
  try {
    window.localStorage.removeItem(keyFor(sessionId));
  } catch {
    // Nothing to clear if nothing could be stored in the first place.
  }
}

/**
 * PROMOTION carries the draft forward (brief Risk 2) — the filler's entry
 * moves to the promoted session's id, so the new pad opens with the thought
 * already in it. The filler's own row keeps no scratch note; it never had a
 * close-out form to write one through, and nothing is written to it here.
 */
export function moveScratchDraft(fromSessionId: string, toSessionId: string): void {
  try {
    const text = window.localStorage.getItem(keyFor(fromSessionId));
    window.localStorage.removeItem(keyFor(fromSessionId));
    if (text !== null && text !== "") {
      window.localStorage.setItem(keyFor(toSessionId), text);
    }
  } catch {
    // Best-effort — losing an in-flight draft on a storage failure here is no
    // worse than losing it on any other storage failure (brief Risk 6).
  }
}

/**
 * MOUNT SWEEP — drops every scratch draft that is not the active session's.
 *
 * There is only ever one active session (Rule 1), so this needs no
 * timestamps or TTL: anything else left behind is litter — a tab closed
 * mid-session, a retry that already succeeded elsewhere, a session that
 * closed while this tab was backgrounded. Run once, at app mount.
 */
export function sweepScratchDrafts(activeSessionId: string | null): void {
  try {
    const keep = activeSessionId === null ? null : keyFor(activeSessionId);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(PREFIX) && key !== keep) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  } catch {
    // No sweep possible if storage itself is unavailable — nothing to do.
  }
}
