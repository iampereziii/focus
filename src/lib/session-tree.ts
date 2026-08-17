/**
 * Flattening the log tree.
 *
 * `groupByWeek` returns a TREE, not a list: only ROOT sessions land in
 * `weeks[].nodes`, and every interrupt hangs off `node.children`
 * (`lib/facts/index.ts`). Any caller that wants "every session on this page" must
 * therefore RECURSE.
 *
 * This module exists because a caller that didn't cost a bug. `/` read
 *
 *     weeks.flatMap((w) => w.nodes.map((n) => n.session))
 *
 * — one level deep — and so could not see an active `pulled` or `filler` session
 * at all. Rule 1's redirect never fired, the backlog rendered as though nothing
 * was running, and the only apparent way back to live work was to start it again.
 * The session was never closed; the app had simply lost the door back to it.
 *
 * NOT in `lib/facts/` on purpose — keeping facts pure and side-effect-free is what
 * makes the v1.1 AI layer addable without rework. This is tree-shape plumbing,
 * not a derived number.
 */

import type { SessionNode, WeekGroup } from "@/lib/facts";
import type { Session } from "@/types/db";

/** Every session in a node list, parents and interrupts alike, depth-first. */
export function flattenNodes(nodes: readonly SessionNode[]): Session[] {
  return nodes.flatMap((node) => [node.session, ...flattenNodes(node.children)]);
}

/** Every session on a page of the log, at any depth. */
export function flattenWeeks(weeks: readonly WeekGroup[]): Session[] {
  return weeks.flatMap((week) => flattenNodes(week.nodes));
}
