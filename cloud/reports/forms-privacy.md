# forms-privacy

Status: in progress.

Branch in both repos: `cloud/forms-privacy`. Bases: Jini `e0dab177afd45fccca44fef82b0a36b37b1c87f5`; Tovu `64aae82d7683805c29dbb07aeb08e06f96d3bbdb`.

Implemented reference delivery payloads with legacy compatibility, token-only attempt deduplication, and rich answer/tool contracts. Placement IDs remain in progress. Focused checks and final SHA inventory will follow.

Current checks: Jini delivery tests 41 passed; Admin answer formatting 27 passed; Tovu tools 11 passed; Tovu composition 5 passed. Regression tests reproduced the defects before production edits. Initial recursive build overlapped newly added red tests and failed on those expected type errors; clean baseline is not claimed.

Files in this checkpoint:
- `packages/admin/src/core/ports/forms.ts`
- `packages/admin/src/forms/__tests__/answer-format.unit.test.ts`
- `packages/admin/src/forms/models.ts`
- `packages/cms/src/forms/__tests__/submit-service.host-options.test.ts`
- `packages/cms/src/forms/delivery/__tests__/deliver-job.unit.test.ts`
- `packages/cms/src/forms/delivery/__tests__/planner.unit.test.ts`
- `packages/cms/src/forms/delivery/__tests__/subscriptions.unit.test.ts`
- `packages/cms/src/forms/delivery/deliver-job.ts`
- `packages/cms/src/forms/delivery/index.ts`
- `packages/cms/src/forms/delivery/planner.ts`
- `packages/cms/src/forms/delivery/subscriptions.ts`
- `packages/cms/src/forms/delivery/types.ts`
- `packages/cms/src/forms/submission-attempts.ts`
- `packages/cms/src/forms/submit-service.ts`

Open: placement IDs, final affected checks/typechecks/complexity lint, legacy copy inventory, exact Cloudflare republish requirements. No deployment or publish performed.
