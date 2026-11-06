# Small fixes — in progress

Job: small-fixes. Started 2026-11-06 02:55 UTC; hard stop 04:55 UTC.
Branch in each changed repository: `cloud/small-fixes`.
Bases fetched from current `origin/cloud/combine`: Jini `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`; Tovu `5358aa594fb6e8c0ca107b1106fbf9ae43871d50`.

Loaded the shared/job instructions from `origin/cloud-plans-1105` and the archived Software Architect, Programmer, and TDD personas. Setup rebuild and relink underway before baseline verification.

1. Large choice answers: fixed in `b8153eba7`. Iterative append preserves 200,000 selections without argument-stack overflow. `packages/chat/src/core/question-answer.ts` and its existing test file. Baseline 21 passed; new regression failed with RangeError before fix, now 22 passed.
2. DeepSeek authentication classification: fixed in `b8153eba7`. A key name alone, including quota/upstream messages, no longer implies missing credentials; actual missing/invalid-key signals still match. `packages/agent-runtime/src/auth.ts` and its existing test file. Baseline 65 passed; four regression cases failed before fix, now 75 passed.
3. Consistent upload limits and bounded reads: Jini admission, source reads and PDF extraction now share 50 MiB (`4165a61b3`); 37 focused tests passed. Host wiring and bounded local-file reads in progress. Jini image/video default remains 10 MiB for other consumers; archive expansion remains independently capped at 40 MiB.
4. Disabled plugin readable guidance with unavailable tools: implementation and real-filesystem regression tests in progress; pinned-run activation remains required, and off-plugin reads do not activate tools.
5. Replaced media cache behavior: Tovu implementation complete, pending commit. Public renditions now revalidate every reuse; original/gated responses remain private/no-store. Four cache integration cases pass. Broader affected route tests expose pre-existing generation 500s; a representative failure was reproduced with exact base route source. Header selection adds zero reads per origin request; revalidation increases origin request frequency.

No completed fixes or test claims yet. Setup logs stay outside tracked source under `/workspace/work/small-fixes`.

Focused validation (from Jini after sourcing `/workspace/.tovu-build/env.sh`):
- `pnpm --filter @jini-ai/chat exec vitest run src/core/__tests__/question-answer.test.ts` — 22 passed.
- `pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/auth.test.ts` — 75 passed.

Pushed checkpoint: Jini `dd7c3a2d7` on `cloud/small-fixes`.

Setup: `pnpm install --frozen-lockfile --store-dir /workspace/.tovu-build/pnpm-store --force`, `pnpm --filter @jini-ai/core build`, and `pnpm --no-bail -r build` completed successfully. Workspace cache variables avoid read-only home cache. `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` succeeded.
