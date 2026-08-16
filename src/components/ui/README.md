# `components/ui/` — primitives

Button, Input, Sheet, Timer. Nothing app-specific.

The Timer primitive renders elapsed time **derived from `startedAt`**, never from
a client-side running clock — a backgrounded PWA has no guaranteed timer
(ADR-0002).
