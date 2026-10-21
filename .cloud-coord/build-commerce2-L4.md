# L4 ledger (commerce payments OPERATIONS)
Started ~16:56Z. Baseline src/payments kernel vitest: 271 passed, 1 skipped (14 files).
## Done
- read brief, report, contracts, accounting, ledger, testkit
## Next
1 L3 owner decisions (dispute amount change, over-withdrawn alert) 2 grants 3 ledger methods+0002 migration 4 service ops 5 reconciler 6 operator 7 registry/alerts tests 8 kernel exports 9 legacy deletion
## 17:04Z
- DONE step 5 (L3 owner rules): plan-evidence dispute `amountChanged` + reason `dispute-amount-changed`; apply-evidence over-withdrawn alert (WriterDeps.alerts, edge-triggered, failure swallowed); new writers recordIntentDispatchOutcome, settleUnknownRefund, settleUnknownIntent; EvidenceSource += "operator". Tests: accounting/__tests__/apply-evidence-ops.vitest.test.ts, plan test updated. 100% cov.
- DONE step 2 grants: ops/grants.ts + test; GRANT_INVALID code.
- DONE ledger: listUnknownPayments, listUnsettledRefunds, appendOperatorAction, listOperatorActions (port+sql+memory+contract), migration 0002 + checksum pinned, rows.ts table. 100% cov.
- NEXT: ops service (view/guards/intent/refund/capture-void/service), reconciler, operator, registry/alerts tests, kernel exports, legacy deletion.
## 17:20Z
- DONE ops modules written (deps, view, common, intent, refund, capture-void, service, reconciler, operator); tsc clean. NOT yet tested.
- DONE outbox seq (coordinator request from L5): 0002 adds commerce_outbox.seq + index; sql/memory order created_at, seq, id; contract test added; checksum re-pinned.
- NEXT: ops tests (harness in ops/__tests__/harness.ts), registry/alerts tests, kernel exports, legacy deletion.
## 17:17Z
- DONE ops tests: ops/__tests__/{harness,intent,refund,capture-void,service,reconciler,operator,grants}.vitest.test.ts — 118 pass, ops/*.ts 100%.
- NEXT: complexity check, registry/alerts tests, kernel exports, legacy deletion.
## 17:20Z
- DONE complexity (0 errors at 10/10), registry + alerts tests, kernel.ts exports appended. Full kernel vitest 545 pass/1 skip; tsc clean.
- NOW step 8 legacy deletion. Plan: delete lipay-plugin.ts, ports.ts, state-machine.ts, registry.ts, credentials.ts, payments/index.ts, payments/__tests__/*.test.ts + support/storage, store/**, catalog/webhook-inbox.ts + test + index line; reduce providers/lipay-gateway.ts to signLipayWebhook (it imported legacy ports.ts); package.json ./payments ./store entries + test globs.
