# `components/capture/` — QuickCapture

**The friction-critical path.** The whole project exists because a
higher-friction version of this protocol was abandoned the day it was written.

- Not a route — a global sheet/modal, reachable by keyboard shortcut **from every
  page** and by a persistent button.
- Opens in **under 150 ms** from keypress.
- Requires **only** `what` + `topicId` (Rule 9). Do not add required fields.
- The topic picker accepts a **new name** and creates the Topic inline —
  one field, not a board (Gap 14). It must not open a screen or add a step.
