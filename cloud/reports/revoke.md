# revoke — 2026-11-05

Implementation complete within the two-hour cap. Focused tests and complexity lint pass. Tovu's server/admin type checks retain the exact errors reproduced on the unchanged pinned base; those findings are listed below.

Instructions: `cloud/jobs/COMMON.md`, `cloud/jobs/revoke.md`, `cloud/plans/TRIM.md` and B-bugs plan from Jini plans commit `a2e6fe163f47309cda7d576a624dd511faea035d`. Loaded the specified Software Architect, Programmer and TDD personas from `/workspace/cloud/ai-dev-shop`.

## Branches and pushed implementation commits

Jini: `cloud/revoke`, based on `6f507852d`.

- `c445db12182b71da91bc11288c74922302bd8b62` — failing queued-delivery regressions.
- `856bb9b7629ea7eda48e5a09798972ff4af4f5a0` — retired-export guards.
- `1695dbe5dbaaa12e6edd776c99725f9d586dc35a` — real SDK queue tests and lifecycle documentation.

Tovu: `cloud/revoke`, based on `e327c07c8`.

- `241800a353cf979f2579c4bd7285cb557ce9e860` — retirement wiring and visible 30-second notice.
- `166c1db732249330266a550a4f0993e8e45ba8b0` — revoke reply/ordering regression and complexity correction.
- `3cf7ff6db47a61ef703856836e9996dd2dbd3e8d` — prove the test event enters the queue before retirement.

This report is committed separately after validation. Only `cloud/revoke` was pushed in either repository; no force push, main push, deployment or publication.

## Delivered behavior

The existing project-key revoke path already commits the detachment before calling local provider reapply. It remains the owner of that sequence, now protected by a regression. Other processes continue using the existing 30,000 ms metadata watcher.

Tovu supplies an AbortSignal through the existing provider factory options. Replacing/removing a provider configuration or failing an apply retires its old exports before SDK disposal. Jini's PostHog, Sentry, Langfuse and OTLP trace/metric adapters discard pending exports after retirement, allowing SDK shutdown to drain its queues without sending the old credential. Ordinary host shutdown still flushes; regrant creates a fresh active client. Independent local keys keep their existing precedence.

The saved-key UI and successful revoke reply say: “Access is revoked within 30 seconds.” No per-send grant lookup, schema, table, dependency declaration, version bump or new polling loop was added.

Reuse: existing `createProjectKeys.use`, provider reapply queues, `watchProviderRevisions`, factory options and SDK transport/export boundaries; the retirement signal uses the standard AbortController. Vendor behavior remains in Jini; Tovu wires lifecycle and product copy.

## Validation — exact commands and outcomes

All commands ran in this container. Commands below use `source /workspace/.tovu-build/env.sh`. The prescribed `/workspace/shared/dev-env.sh` and `/workspace/shared/start-postgres.sh` were absent; the existing equivalents were found under `.tovu-build`, and `/workspace/.tovu-build/start-postgres.sh` started the local development PostgreSQL instance.

From `/workspace/Jini`:

```sh
npm --prefix packages/provider-plugins run test -- src/__tests__/analytics-posthog.test.ts src/__tests__/ai-trace-langfuse.test.ts src/__tests__/observability-sentry.test.ts src/__tests__/observability-opentelemetry.test.ts src/__tests__/telemetry-delivery.test.ts src/__tests__/observability-metrics.test.ts
pnpm --filter @jini-ai/provider-plugins build
pnpm -r --filter @jini-ai/chat --filter @jini-ai/daemon --filter @jini-ai/devops --filter @jini-ai/mcp --filter @jini-ai/server --filter @jini-ai/sqlite --filter @jini-app/reference-web build
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/provider-plugins/src/telemetry-reporter.ts packages/provider-plugins/src/analytics-posthog/posthog.ts packages/provider-plugins/src/observability-sentry/sentry.ts packages/provider-plugins/src/observability-opentelemetry/opentelemetry.ts packages/provider-plugins/src/observability-opentelemetry/index.ts packages/provider-plugins/src/ai-trace-langfuse/langfuse.ts packages/provider-plugins/src/ai-trace-langfuse/index.ts
```

Results: **141 tests pass**, provider TypeScript checks and all plugin bundles build, remaining seven workspace builds pass, complexity lint passes. The four original adapter suites also passed 123 tests before implementation. New retirement regressions were run red before the fix. Real SDK queues, delayed Sentry processing, regrant, and a loopback collector for both OTLP signals were exercised. Dropped OTLP batches do not report a successful delivery.

The initial `pnpm -r build` attempts built the other workspace packages but stopped at incomplete preinstalled chart dependencies. Missing declared dependencies/links were repaired without manifest or lockfile changes. A frozen install could not write the inherited read-only pnpm store; existing declared chart dependencies were installed in `/workspace/work/revoke-chart-deps` with a scratch npm cache. The successful provider build and seven-package resume completed every remaining workspace build; a manifest/log check found no build without a successful completion.

From `/workspace/Tovu`:

```sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
node --import tsx --test apps/website/src/features/project-keys/__tests__/tools.unit.test.ts apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts apps/website/src/server/runtime/composition/__tests__/provider-revision-watch.unit.test.ts apps/website/src/server/runtime/composition/__tests__/provider-key-reference-only.unit.test.ts
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/project-keys/service.ts apps/website/src/server/runtime/composition/provider-plugins.ts apps/admin/src/features/security/AccessTokensTab.tsx
npm --prefix packages/contracts run build
```

Results: relink succeeds; **63 tests pass**; complexity lint and contracts build pass. Server tsc exits 2 with the single unchanged-base diagnostic below.

From `/workspace/Tovu/apps/admin`:

```sh
npm exec -- vitest run src/features/security/__tests__/AccessTokensTab.credential-flows.unit.test.tsx
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Results: **87 tests pass**. The three added UI assertions failed before the notice was added. Admin tsc exits 2 with the three unchanged-base diagnostics below.

Unchanged-base verification, from `/workspace/Tovu`, used a detached worktree at `e327c07c8` with the same installed dependencies:

```sh
node_modules/.bin/tsc -p /workspace/work/revoke-tovu-base/tsconfig.json --noEmit
node_modules/.bin/tsc -p /workspace/work/revoke-tovu-base/apps/admin/tsconfig.json --noEmit
```

Both reproduce exactly the same server/admin diagnostics. None points to a changed file. `git diff --check` passes in both repositories. Tests were limited to changed/affected files; full suites and packaged real-chat verification remain with integration. Coverage percentages were not collected; the direct behavior evidence is mapped below. No existing test was removed or weakened.

## Review and cost

Architecture audit: PASS for this diff. Generic SDK delivery guards are in Jini behind factory options; Tovu supplies lifecycle signals. Public additions are optional object fields/arguments. No provider plugin imports another plugin.

| Assessment unit | Evidence | Added time / state | Disposition |
| --- | --- | --- | --- |
| Host replace/apply retirement | queued-event admission, drop-before-dispose, regrant tests | O(1) per slot; one current controller per slot | NO_RECORDED_FINDINGS |
| Project-key revoke reply | committed detachment before reapply; exact 30-second message | O(1); existing I/O unchanged | NO_RECORDED_FINDINGS |
| PostHog/Langfuse fetch and Sentry send | real queued/delayed events suppressed; fresh client sends | O(1) per SDK send; existing bounded queues | NO_RECORDED_FINDINGS |
| OTLP reporting exporter and factory wiring | trace and metric queues dropped; fresh exports reach loopback collector | O(1) per batch; existing queue limits | NO_RECORDED_FINDINGS |
| UI notice | three existing project-key row scenarios assert visible copy in the rendered tree | constant markup | NO_RECORDED_FINDINGS |

The skepticism pass checked naming, queue admission, ordinary shutdown, multiple queued items/signals, regrant and ordering. It caught the regression fixture's invalid hyphenated event name; the fixture now uses `revoked_queue` and proves admission before revoke.

State cost: no added durable reads/writes, payload bytes or polls. Existing watcher: one metadata query per configured store every 30 seconds. Outbound sends add only an in-memory aborted check. Already-dispatched requests are not recalled; the requested change discards pending work when reapply retires its provider.

## Bugs and open findings

FIXED BUG: retiring provider clients could flush queued telemetry using a revoked shared key.

FIXED BUG: saved-key UI/revoke feedback did not state the cross-process 30-second revocation window.

OPEN BASELINE BUG: `apps/website/src/features/deployments/publish-credentials/store.ts:410:88` — TS2322, `string | undefined` passed where `string` is required.

OPEN BASELINE BUG: `apps/admin/src/features/security/Security.tsx:183:46` — TS2554, two arguments supplied to a one-argument function.

OPEN BASELINE BUG: `apps/admin/src/lib/__tests__/api-user-facing-fallback.unit.test.ts:24:10` and `:25:10` — TS18046, `error` is unknown.

The baseline bugs were listed without fixes as instructed. No task implementation remains open. Release/publishing and packaged real-chat verification were not part of this job. The unrelated untracked Jini `packages/plugin-ui-ux-design/` directory was preserved.
