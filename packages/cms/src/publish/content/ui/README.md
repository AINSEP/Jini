# publish/content/ui

The publish dialog's *semantics* — pure TypeScript, no React, no `node:*`, no repo, no planner — so
one copy serves both a browser dialog and a server-side publish chat tool and cannot drift from the
planner's real behaviour. This is the single owner (the earlier `dialog/` twin was removed).

- `contract.ts` — dialog wire shapes (plan/confirm/execute results, `PublishScope`) over the neutral
  report DTO in `@jini-ai/core/contracts/site/cms-publish-content`. The destination/peer read model
  is core's `PublishContentPeerView`; it is not redeclared here.
- `report-rows.ts` — report → table rows, dispositions and counts; also owns `friendlyPublishReason`
  (raw planner/handler skip reason → owner-facing sentence) driven by an injected `PublishReportPolicy`.
- `sections.ts` — `definePublishSection` and the label lookups over host-registered sections.
- `publish-order.ts` — the table's display order.
- `criteria.ts` — chat-tool / deep-link publish criteria (parse, encode, apply); query limits and
  entity-type aliases are injected.
- `phase.ts` — which ceremony phase may advance; `replan.ts` — selection re-plan + drift check.
- `index.ts` — the barrel (`@jini-ai/cms/publish/content/ui`).

## Wiring

The host injects all product wording and tables (reason rewrites, section table, type aliases,
drift message, capability copy). No module state.
