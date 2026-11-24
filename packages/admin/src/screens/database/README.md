# screens/database

Rules, dictionary and section hooks behind a Database panel: the ledger Timeline browser, the
schema-drift warning, and the gated plan/confirm/execute migrate-forward ceremony. The wire types
(`AdminLedgerRow`, `AdminSchemaState`, `MigrateForwardResult`, …) are owned by
`@jini-ai/admin/core` (`../../core/ports/database.ts`) and are not redeclared here.

- `hooks/timeline-section-port.hooks.ts` — `TimelineSectionPort`: one cursor-paged ledger read.
- `hooks/schema-state-section-port.hooks.ts` — `SchemaStateSectionPort`: the read-only drift status.
- `hooks/migrate-forward-section-port.hooks.ts` — `MigrateForwardSectionPort`: plan, confirm, execute.
- `hooks/use-timeline-section.hooks.ts` — `useTimelineSection({ port, host })`: draft vs applied
  filters, cursor-appended pages, error wording; plus `navigateToRecoveryWithDeepLink`, which stashes
  the deep-link envelope a Recovery panel (`../../recovery`) re-resolves on arrival.
- `hooks/use-schema-state-section.hooks.ts` — `useSchemaStateSection({ port, host })`: feeds
  `resolveSchemaStateWarning`; a failed or unrecognised check always warns.
- `hooks/use-migrate-forward-section.hooks.ts` — `useMigrateForwardSection({ port, host })`: the
  ceremony state machine; a successful or rejected execute re-reads the drift and Timeline keys.
- `rules.ts` — pure query `KEYS`, the drift-warning decision, the "View in Recovery" accessible name.
- `database-i18n.tsx` — the screen's dictionary (`t`, composed over `ADMIN_COMMON_I18N`) and the
  markup-bearing plan-ready sentence; the per-locale blocks live in `database-i18n/` (size ratchet).

## Wiring

- The host implements the three ports against its own admin HTTP client and keeps a zero-argument
  `useWiredX()` binding next to each implementation (the `useX(dependencies)` / `useWiredX()` pair).
- Every section hook takes a REQUIRED `host`: `useSchemaStateSection` — `useLocale` (hook);
  `useMigrateForwardSection` — `useLocale` and `describeError`; `useTimelineSection` — `useLocale`,
  `describeError` and `useCursorPages` (hook; normally `@jini-ai/ui/fetch-query`'s, bound to the same
  fetch-query provider the admin kit uses). Pass module-level host objects: the hook fields are
  called every render.
- `navigateToRecoveryWithDeepLink` takes `{ row, navigate }` — `navigate` is the admin router's.
- `viewInRecoveryAccessibleName` takes the viewer's `viewerTimeZone`. The screen markup itself stays in
  the host, which owns its stylesheet.
