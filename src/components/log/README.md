# `components/log/` — week group, session card

Sessions grouped by week, newest first. Interrupts render **nested under** the
session they interrupted — the tree is what makes a fragmented day legible
rather than an indictment.

Build gate: a week must be reconstructable here in **under 2 minutes**, without
memory. Paginate by week; never load the full history.

Append-only. No delete affordance (Rule 14).
