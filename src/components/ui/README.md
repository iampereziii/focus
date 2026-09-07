# `components/ui/` — primitives

Button, Input, Textarea, Field, Badge, Sheet, SegmentedControl, ElapsedClock.
Nothing app-specific.

`ElapsedClock` renders elapsed time **derived from `startedAt`**, never from a
client-side running clock — a backgrounded PWA has no guaranteed timer
(ADR-0002).

`SegmentedControl` is the one-row, equal-column control that replaced four
hand-rolled `flex gap-2` button rows, all of which wrapped their labels in a
narrow window. It serves both a choice (the gate's check-in interval, which
passes `value`) and an action row (filler waits, close-out statuses, check-in
answers, which do not).

Density is carried by the `compact` variant declared in `globals.css`, never by
per-component breakpoints — see the comment there for the two axes it keys on.
