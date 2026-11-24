# publish/content/dialog

The publish dialog's *semantics* — pure TypeScript, no React, no `node:*`, no repo, no planner — so
one copy serves both a browser dialog and a server-side publish chat tool and cannot drift from the
planner's real behaviour.

- `contract.ts` — dialog wire shapes (plan/confirm/execute results, `PublishScope`) over the neutral
  `../report-contract.ts` report DTO.
- `report-rows.ts` — report → table rows, dispositions and counts.
- `report-reasons.ts` — raw planner/handler skip reason → owner-facing sentence.
- `publish-order.ts` — the table's display order.
- `criteria.ts` — chat-tool / deep-link publish criteria (parse, encode, apply).
- `phase.ts` — which ceremony phase may advance; `replan.ts` — selection re-plan + drift check.
- `index.ts` — the barrel (`@jini-ai/cms/publish/content/dialog`).

## Wiring

- The host owns the publish **section table** (button labels, per-type names — product copy) and
  injects its labeler as `entityTypeLabel: PublishEntityTypeLabeler` into
  `toPublishReportRows({ report, entityTypeLabel }, { completed })` and
  `preparePublishConfirmation({ plan, deselectedKeys, entityTypeLabel, planPublish })`. An unlisted
  type should label as its raw id (degraded, never blank).
- `preparePublishConfirmation` also takes the host's `planPublish` (re-stage a narrowed bundle).
- No module state; nothing else is injected.
