/**
 * PUSH-ONLY SERVICE WORKER.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT CONTAINS A `push` HANDLER AND A `notificationclick` HANDLER. THAT IS ALL
 * IT MAY EVER CONTAIN.
 *
 * IT MUST NEVER GAIN A `fetch` HANDLER.
 *
 * A `fetch` handler is not an optimisation, a caching win, or a performance fix
 * — it is a REVERSAL OF ADR-0002 (online-only PWA), and it needs a new ADR
 * rather than a commit. Same for `caches`: no precache, no offline shell, no
 * offline read cache. That includes making the day-review screen readable
 * offline, which was asked and answered (ADR-0002 Gap 4: no — the review happens
 * at the desk).
 *
 * This is LINT-ENFORCED and fails the build. See eslint.config.mjs, guardrail
 * (b). Never `eslint-disable` it to unblock a task.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS AT ALL: it fires BOTH prompt rules.
 *
 *   Rule 18 — the `filler` return prompt ("still waiting?"), which ADR-0003
 *             calls "the entire protection" for that category. Without a return
 *             prompt, `filler` is parallel work wearing a tag.
 *   Rule 26 — the check-in probe ("still on this?"), the more frequent of the two.
 *
 * ONE IMPLEMENTATION SERVES BOTH. A second push code path is a bug (Rule 26c).
 *
 * PHRASING DISCIPLINE — ALWAYS A QUESTION, NEVER A CLAIM. The app asks "still
 * waiting?"; it never says "your build finished," which it cannot verify and
 * which spends credibility it depends on.
 *
 * AND: an ignored prompt changes NOTHING about the session — no close, no status
 * change, no classification (Rule 26b). Rule 7 has no exceptions. The app never
 * acts on silence; it only stops crediting it (Rule 26e).
 */

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};

  // `kind` is 'filler-return' (Rule 18) or 'check-in' (Rule 26). Same code path,
  // same options shape — the difference is the copy and the actions, nothing more.
  const title = payload.title || "Focus";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "focus-prompt",
    // Renotify on the same tag: a re-armed prompt should be noticed, not merged
    // silently into the previous one.
    renotify: true,
    requireInteraction: false,
    data: {
      url: payload.url || "/",
      sessionId: payload.sessionId || null,
      kind: payload.kind || null,
    },
    actions: payload.actions || [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/";

  // Focus an existing window if one is open; otherwise open the target. The
  // answer itself is recorded by the app (a CheckIn row, Rule 26e) — the worker
  // never writes, never closes a session, and never classifies anything.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
