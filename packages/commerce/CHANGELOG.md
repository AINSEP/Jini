# @jini-ai/commerce

## Unreleased — Phase 1 (2026-10-29)

- Compose one-time orders with the payment kernel through a reserved-before-dispatch association,
  scoped price references and evidence-verified, idempotent paid projection. Hosts must migrate
  the two new catalog tables before opting in; the payments ledger schema is unchanged.
- Add the browser checkout client, cancel URL, validated intent line, ignored-webhook response,
  rejection replay, site/mode credential adapter and plugin-host lease guard. Retire commerce's
  second provider attachment path; LiPay remains test-only and refuses live mode.
- Integrate the `payments-stripe` provider artifact for hosted Checkout, retrieval and signed
  webhooks. Retain Open SaaS MIT attribution in both distributions. Lost responses remain unknown
  without redispatch and settle through operator resolution or late evidence.
- Add 16 cross-package E2E cases (P34–P35) for payment/fulfillment, redelivery, scope/mode fences,
  lease retirement, lost responses, bind crashes and concurrent checkout. Execution and coverage
  measurement are pending; no tests, builds or typechecks ran in this dispatch.

## 0.6.13

### Patch Changes

- 0728914: Engine guard clean-up (`pnpm guard` 106 -> 0): layer, subpath-isolation and module-state findings fixed by moving
  shared contracts to their owners instead of reaching across domains. Additive public API: `@jini-ai/core/filesystem`
  (guarded-reader contracts), `useFetchQueryScope` from `@jini-ai/ui` fetch-query (per-provider query scope),
  `@jini-ai/chat/react` re-exports of the accepted-input, run-state and agent-plugin chat-state helpers. The Claude
  filesystem probe cache in `@jini-ai/agent-runtime` is instance-owned. No behaviour change intended; host-facing
  breaks are listed in `owner-store-to-server` and `guard-host-ports`.
- Updated dependencies [7479159]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.1.2 — 2026-10-22

- 2026-10-22: Payments kernel: ledger and worker fixes, reconcile lost capture/void attempts, provider-plugin registration; BREAKING: legacy LiPay import (migration 0005) dropped.

## 0.1.1 — 2026-10-13

- Accept UI ^0.5.0 for the chart contract extraction.

## 0.1.0 — 2026-10-08

- First release: commerce domain moved from Tovu into Jini (10d0ca36).
