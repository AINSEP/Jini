# L5 ingest ledger — DONE
- [x] ingest/receive.ts + tests (17, 100%)
- [x] ingest/worker.ts + memory tests (25) + sqlite tests (2), 100%
- [x] ingest/outbox-relay.ts + tests (5 incl e2e 4 topics), 100%
- [x] http/payments-webhook.ts rewrite + vitest (13), 100%; legacy node:test http files deleted (11 tests); package.json test glob
- [x] kernel.ts exports; complexity max 8; tsc clean; full kernel suite 388 pass
Findings for report: outbox order within one tx follows newId (no seq col); Tovu route-async-guards.test.ts uses old deps; host-adapter-rationale.md:69 stale; lipay-fake webhookUrl old shape.
