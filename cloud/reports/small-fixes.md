# Small fixes — in progress

Job: small-fixes. Started 2026-11-06 02:55 UTC; hard stop 04:55 UTC.
Branch in each changed repository: `cloud/small-fixes`.
Bases fetched from current `origin/cloud/combine`: Jini `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`; Tovu `5358aa594fb6e8c0ca107b1106fbf9ae43871d50`.

Loaded the shared/job instructions from `origin/cloud-plans-1105` and the archived Software Architect, Programmer, and TDD personas. Setup rebuild and relink underway before baseline verification.

1. Large choice answers: fixed in `b8153eba7`. Iterative append preserves 200,000 selections without argument-stack overflow. `packages/chat/src/core/question-answer.ts` and its existing test file. Baseline 21 passed; new regression failed with RangeError before fix, now 22 passed.
2. DeepSeek authentication classification: fixed in `b8153eba7`. A key name alone, including quota/upstream messages, no longer implies missing credentials; actual missing/invalid-key signals still match. `packages/agent-runtime/src/auth.ts` and its existing test file. Baseline 65 passed; four regression cases failed before fix, now 75 passed.
3. Consistent upload limits and bounded reads: pending inspection and regression test.
4. Disabled plugin readable guidance with unavailable tools: pending inspection and regression test.
5. Replaced media cache behavior and request read cost: pending inspection and regression test.

No completed fixes or test claims yet. Setup logs stay outside tracked source under `/workspace/work/small-fixes`.

Focused validation (from Jini after sourcing `/workspace/.tovu-build/env.sh`):
- `pnpm --filter @jini-ai/chat exec vitest run src/core/__tests__/question-answer.test.ts` — 22 passed.
- `pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/auth.test.ts` — 75 passed.

Pushed checkpoint: Jini `dd7c3a2d7` on `cloud/small-fixes`.
