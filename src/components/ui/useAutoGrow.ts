import { useEffect, useRef } from "react";

/**
 * Grows a `<textarea>` to fit its content, and never leaves it taller than it
 * needs to be.
 *
 * Extracted from `SessionView`'s scratch pad (where this was written first) so
 * the gate can use it too — one implementation, the same rule as the push path.
 * It is what lets WHY and FINISH LINE open at ONE row under `compact` without
 * costing anything: the box is a single line while it holds a single line, and
 * it is two rows the moment a second one is typed. Nothing is hidden and nothing
 * scrolls inside the field; the floor is set in CSS (`min-h-*`), so a comfortable
 * viewport still opens at the two rows `feature-brief-gate-sheet-short-viewport.md`
 * insisted on ("the space to write a sentence in is the gate, not decoration").
 *
 * DOM styling only — no state is touched, so this is a plain effect rather than
 * the render-time adjustment pattern used for props elsewhere in this app.
 * `height: auto` first, so the measurement shrinks as well as grows.
 */
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return ref;
}
