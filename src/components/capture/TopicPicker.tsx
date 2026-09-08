"use client";

/**
 * Hand-rolled combobox for Quick Capture's Topic field, local to `capture/`
 * on purpose (feature-brief-capture-topic-picker-dropdown.md — no second
 * consumer exists yet, so this doesn't belong in the shared `ui/` primitives).
 *
 * Replaces a native `<input list> + <datalist>` that showed no suggestions
 * at all in desktop Chrome/Edge — a functional failure, not a discoverability
 * one. Renders its own option list instead of depending on the browser's
 * native popup, which is what broke.
 *
 * Confirmed interaction contract (same brief):
 *  - Focusing the field opens the list unfiltered; typing narrows it.
 *  - Arrow keys / hover highlight an option; click or Enter-on-highlighted
 *    selects it and fills the field WITHOUT submitting.
 *  - Enter with nothing highlighted submits the whole capture, unchanged
 *    from the native version's behavior.
 *  - An unmatched name is still valid — the parent's resolve-or-create call
 *    handles creating it on submit. This component never talks to the API.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui";
import type { Topic } from "@/types/db";

export function TopicPicker({
  topics,
  value,
  onChange,
  onSubmit,
  disabled = false,
}: {
  topics: Topic[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // `null` = not actively filtering, so opening the list always shows every
  // topic; typing sets this to the live query so results narrow. Reset on
  // close so the next open starts unfiltered again.
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const visible = useMemo(() => {
    if (query === null || query.trim() === "") return topics;
    const q = query.trim().toLowerCase();
    return topics.filter((t) => t.name.toLowerCase().includes(q));
  }, [topics, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery(null);
    setHighlighted(null);
  }

  function select(name: string) {
    onChange(name);
    close();
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted !== null ? `${listboxId}-${highlighted}` : undefined}
          value={value}
          disabled={disabled}
          maxLength={80}
          className="pr-7"
          onFocus={(e) => {
            setOpen(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) {
                setOpen(true);
                return;
              }
              setHighlighted((i) =>
                visible.length === 0 ? null : i === null ? 0 : Math.min(i + 1, visible.length - 1)
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((i) =>
                visible.length === 0 ? null : i === null ? visible.length - 1 : Math.max(i - 1, 0)
              );
            } else if (e.key === "Enter") {
              if (open && highlighted !== null && visible[highlighted] !== undefined) {
                e.preventDefault();
                select(visible[highlighted].name);
              } else {
                onSubmit();
              }
            } else if (e.key === "Escape" && open) {
              // Stop propagation so QuickCapture's window-level Escape
              // handler doesn't also close the whole sheet on the same
              // keypress — this Escape closes only the list.
              e.stopPropagation();
              close();
            }
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-label opacity-50"
        >
          ▾
        </span>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-neutral-300 bg-white py-1 text-body shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {visible.length === 0 ? (
            <li className="px-3 py-control-y text-label opacity-60">No matching topics — this will create a new one</li>
          ) : (
            visible.map((t, i) => (
              <li
                key={t.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === highlighted}
                className={`cursor-pointer px-3 py-1.5 ${
                  i === highlighted ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
                onMouseDown={(e) => {
                  // Fires before the input's blur, so selecting a suggestion
                  // doesn't first collapse the list via the blur/pointerdown
                  // handler above.
                  e.preventDefault();
                  select(t.name);
                }}
                onMouseEnter={() => setHighlighted(i)}
              >
                {t.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
