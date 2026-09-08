import { useEffect, useRef } from "react";

/**
 * Grows a `<textarea>` to fit its content, and never leaves it taller than it
 * needs to be.
 *
 * Extracted from `SessionView`'s scratch pad (where this was written first) so
 * the gate can use it too — one implementation, the same rule as the push path.
 * It is what lets WHY and FINISH LINE open at ONE row in a short window without
 * costing anything: the box is a single line while it holds a single line, and
 * it is two rows the moment a second one is typed. Nothing is hidden and nothing
 * scrolls inside the field; the floor is set in CSS (`min-h-writing`), which is
 * itself fluid — one row at 337 px of viewport, two by ~800 — so a tall window
 * still opens at the two rows `feature-brief-gate-sheet-short-viewport.md`
 * insisted on ("the space to write a sentence in is the gate, not decoration").
 *
 * DOM styling only — no state is touched, so this is a plain effect rather than
 * the render-time adjustment pattern used for props elsewhere in this app.
 * `height: auto` first, so the measurement shrinks as well as grows.
 *
 * ── WHY IT ALSO LISTENS TO `resize` (2026-09-07) ────────────────────────────
 *
 * It used to key on `value` alone, which was correct while type was a fixed
 * size: nothing but typing could change how tall the content was. The fluid ramp
 * makes font-size a function of viewport HEIGHT, so dragging the window now
 * changes the content height with the value untouched — and this window is
 * "randomly resized" between 337 px and 815 px, which is the whole reason the
 * ramp is fluid.
 *
 * Without this the inline height set by the last run simply persists: shrink the
 * window and the text is CLIPPED (the box keeps a height its smaller font no
 * longer fills, then the grown text overflows it); grow the window and a gap
 * opens under the last line. Both are silent. `min-h-writing` is a floor, not a
 * fix — it cannot pull an over-tall inline height back down.
 *
 * Coalesced onto an animation frame because a drag fires `resize` continuously,
 * and each run forces layout twice (`height: auto`, then read `scrollHeight`).
 */
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };

    fit();

    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [value]);

  return ref;
}
