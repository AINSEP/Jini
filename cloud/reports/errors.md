# errors — delivery report

2026-11-05. Implemented within the two-hour cap. Instructions: Jini `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `cloud/jobs/errors.md`, and `cloud/plans/S2-errors-replan-result.md`, with the job trim taking precedence.

## Branches and source commits

Only `cloud/errors` was pushed in either repository. Both branches started at the exact requested commits, rather than the subsequently moved named base branches. The source tips below precede this report commit.

| Repository | Branch | Exact base | Source tip |
| --- | --- | --- | --- |
| Jini | `cloud/errors` | `6f507852d50cc5b22914917ad3a80f1168feccee` | `2cdc3bced0ea1759628428e99038e5410dabdf67` |
| Tovu | `cloud/errors` | `e327c07c8fc220fa8612ba1eb60c81c28b8a900f` | `0c4409858c5bddefecd3491a6ec50d5225f1921f` |

## Delivered behavior

- Jini provides pure request-failure wording with injected approved vocabulary, bounded route tokens, and method-specific risky-action overrides. A host-owned failure channel retains one incident, invalidates old requests across scope resets, and isolates failed notification effects.
- Tovu declares resource nouns and restore/publishing semantics in contracts. Static inventory checks cover directory families and 47 actual static route families; nested publishing destinations are named explicitly. Concrete identifiers, query values and submitted data never become fallback prose.
- Shared admin failures now default to safe, copyable evidence and one correlated incident reference. Explicit authorized wording, expected refusals, disk-space responses and the existing export disclosure policy remain. Anonymous unexpected helper replies discard caller-provided private message/action/cause/metadata/details overrides.
- One persistent, dismissible, polite `ErrorNotice` is mounted beside `ServerRestartingBanner`. It publishes only after the existing retry/reconnect sequence finally fails, preserves the original rejection and `ApiError.body`, and clears stale details on session/site changes. Existing inline notices remain.
- Analytics retains its canonical envelope and matching incident reference. Forms wording enters the formatter. Uncaught admin exceptions use the failure lifecycle, preserve headers-sent and expected 4xx delegation, and reuse request-scoped report admission to avoid duplicate tracking.
- Publishing mappers carry registered method/template and authentication context, including push, manual send/undo and destination management. Typed refusal behavior remains.
- The two daemon boundaries distinguish startup from update connection failure and advise checking run/completed actions before retrying. Codes, IDs, event shapes and single terminal events remain unchanged.
- Final aggregate testing exposed a real rare UUID/Luhn collision. The formatter now preserves complete boundary-owned UUID correlation identifiers while credential, custom-pattern and explicit-secret rules still win. Cause-derived identifiers keep normal PII scrutiny. All other fields receive PII redaction before bounds; assembled copy still checks credential/exact secrets across labels.

The trimmed exclusions were respected: dev-auth, standalone preview details/buttons, raw download adapters, existing inline notices, schemas, dependency declarations/manifests, deployment and publishing were not changed.

## Validation

The final focused checks are green. The broader aggregate is deliberately reported as non-green rather than hiding existing failures.

| Check | Result |
| --- | --- |
| Recursive Jini build | PASS after frozen dependency restoration; changed core rebuilt again after the final formatter fix |
| Core request wording + formatter | 15 passed; deterministic numeric-UUID and untrusted-cause regressions first failed, then passed with PII/exact-secret assertions |
| Jini ErrorNotice + failure channel | 7 passed |
| Daemon runs/model-proxy/fields | 425 passed |
| Tovu vocabulary/inventory | 5 passed |
| Final server boundary and affected mapper suites | 109 passed, 0 failed/skipped; 21 host boundary cases rechecked after the final UUID-only narrowing also passed |
| Final admin request/session/notice/reconnect suites | 65 passed across 8 files |
| Final affected aggregate, 197 files | 2,514 tests: 2,505 passed, 9 failed; see classification below |
| Source complexity | Jini changed files: 0 errors; Tovu 13 source files: 0 errors, 6 existing warnings |
| Typechecks | Jini touched packages/core build passed; Tovu source/admin/test projects retain baseline diagnostics listed below |
| Jini guard | 17 findings at unchanged paths or checkout build leftovers; none at this job's changed paths |
| Chromium 155 | PASS: real admin UI with intercepted synthetic anonymous 500; secret canary absent, incident retained, details/copy/dismiss work, login remains, no page exceptions |

### Aggregate failure classification

Two failures led to fixes after that aggregate: the remaining newsletter mapper snapshot now passes its full 12-test file, and the numeric UUID incident reference is covered by deterministic core regressions and the final 109-test server run, including the full 7-test media-trash file. The other seven aggregate failures are unchanged baseline cases:

- BASELINE: menu stackless diagnostic expects a bare message; pinned Jini formatter returns `Error: ...`. Exact base formatter probe reproduces it.
- BASELINE: workspace stackless diagnostic has the same exact prefix mismatch; assertion and formatter are unchanged.
- BASELINE: mail-card save expects 200 but the attached-only vault refuses the write with 500. The exact original `e327c07c8` test reproduces it after verified import-only rewrites.
- BASELINE: publish concurrency progress expects the initial export state but receives a later creation state. The exact original test reproduces the same mismatch in isolation.
- BASELINE: two successful plugin-toggle warning-array assertions receive an additional `charts-recharts` `INTEGRITY_FAILED` warning. Relevant production files and failing test blocks are byte-identical to the base; the full provider build does not eliminate that runtime warning.
- BASELINE: provider settings expects 503 but returns 200. The exact original test and unchanged relevant source reproduce it.

Other open checks/findings:

- BASELINE: Tovu source tsc reports `apps/website/src/features/deployments/publish-credentials/store.ts:410` (`string | undefined`).
- BASELINE: admin tsc reports unchanged `Security.tsx:183` arity and `api-user-facing-fallback.unit.test.ts:24–25` unknown-value assertions.
- BASELINE: test-project tsc reports 50 diagnostics, including 6 in unchanged lines of touched test files; no diagnostics land on this job's modified lines.
- BASELINE: four non-admin completion-log snapshots expect raw Error objects rather than the existing redacted inspect string. Exact baseline middleware and test copies reproduce all four failures. Non-admin response handling was preserved.
- BASELINE: existing throwing daemon diagnostic sinks can escape/reinvoke; unchanged, as required by the bounded scope.
- BASELINE/GUARD: existing orphan package output directories, stale neutrality/allowlist rules, CMS subpath imports, a chat public export, vendor/environment hardwiring, and a missing model definition remain. Exact guard findings follow.

```text
[guard] R8-package-metadata packages/plugin-ai-trace-langfuse/package.json: package directory "plugin-ai-trace-langfuse" is missing package.json
[guard] R8-package-metadata packages/plugin-analytics-posthog/package.json: package directory "plugin-analytics-posthog" is missing package.json
[guard] R8-package-metadata packages/plugin-observability-opentelemetry/package.json: package directory "plugin-observability-opentelemetry" is missing package.json
[guard] R8-package-metadata packages/plugin-observability-sentry/package.json: package directory "plugin-observability-sentry" is missing package.json
[guard] R8-package-metadata packages/plugin-payments-stripe/package.json: package directory "plugin-payments-stripe" is missing package.json
[guard] R8-package-metadata packages/plugin-ui-ux-design/package.json: package directory "plugin-ui-ux-design" is missing package.json
[guard] N1-consumer-identity packages/agent-plugins/src/core/identity-namespace.ts: forbidden source reference "tovu" (comments included)
[guard] N0-allowlist packages/agent-plugins/src/manifest.ts: unused exception for N1-consumer-identity; remove stale policy
[guard] N0-allowlist packages/agent-plugins/src/lifecycle/manifest.ts: unused exception for N1-consumer-identity; remove stale policy
[guard] SI-domain packages/cms/src/forms/attachment-cleanup.ts: ./forms (forms) reaches src/media/blob-gc.ts (media) via ../media/blob-gc.js
[guard] SI-domain packages/cms/src/forms/attachment-cleanup.ts: ./forms (forms) reaches src/media/blob-gc-lock.ts (media) via ../media/blob-gc-lock.js
[guard] R10-chatpane-public-surface packages/chat/src/react/features/chat-pane/create-mcp-ui-tool-caller.ts: imports "SurfaceRecoveryInfo" from "../../../core/surface-recovery.js" (resolves outside features/chat-pane/**), but "SurfaceRecoveryInfo" is not in the public barrel's export list (packages/chat/src/react/index.ts) — a consumer of the published API could not reach this the same way ChatPane does
[guard] HW1-env-default packages/devops/src/local-dev/node-runtime.ts: process.env is allowed only as an injected environment default (?? process.env or env = process.env).
[guard] HW2-vendor-adapter packages/mcp/src/server/http-tool-server.ts: Driver/vendor dependency belongs in an adapter, kernel or provider.
[guard] HW2-vendor-adapter packages/mcp/src/server/http-tool-server.ts: Driver/vendor dependency belongs in an adapter, kernel or provider.
[guard] HW2-vendor-adapter packages/mcp/src/server/tool-result-pages.ts: Driver/vendor dependency belongs in an adapter, kernel or provider.
[guard] R13-model-fallback-freshness packages/agent-runtime/src/defs/antigravity.ts: could not load the def module (Cannot find module '/workspace/Jini/packages/agent-runtime/src/defs/antigravity.ts' imported from /workspace/Jini/scripts/check-model-fallback-freshness.ts)
```

No tests were deleted, skipped, excluded, or weakened to obtain green. Snapshot expectations supply independent literal message/action/step values; only nondeterministic UUIDs and strict ISO timestamps are reused from responses. The helper verifies the complete copy block and exact remaining envelope. A separate review found no response-derived expected text. The 41-file first route group retained 410 static test declarations before/after.

## Runtime cost

No new database reads/writes, network requests, retries, timers, polls, history or persistent storage were added. Per unexpected failure: one bounded template/operation description and one formatted response; 227 approved default vocabulary contexts measured at most **1,189 bytes** serialized. Explicit export details retain the existing formatter bounds. The client retains one formatted incident (copy text at most 8,192 characters) plus subscribers and a generation counter. Each tracked request gains one reference to its already-existing report scope. Clipboard work occurs only on an explicit click, with the existing fallback.

## Setup and exact commands

The requested `/workspace/shared` setup scripts were absent. Their installed equivalents were `/workspace/.tovu-build/env.sh` and `/workspace/.tovu-build/start-postgres.sh`. Node was 24.22.1; sourcing the environment selected pnpm 10.33.2. PostgreSQL started successfully for fixtures; tests used disposable/memory data.

The initial dependency tree missed declared provider-package links. Its default pnpm cache was read-only. The supported frozen reinstall used a writable workspace store without changing manifests or lockfiles:

```bash
source /workspace/.tovu-build/env.sh
cd /workspace/Jini
CI=true pnpm install --frozen-lockfile --force --store-dir /workspace/work/errors/pnpm-store
pnpm -r build
npm --prefix packages/core test -- src/user-facing-error.test.ts src/request-failure.test.ts
npm --prefix packages/core run build
npm --prefix packages/ui test -- src/features/panel-kit/__tests__/failure-channel.test.ts src/features/panel-kit/__tests__/ErrorNotice.test.tsx
npm --prefix packages/daemon test -- src/http/__tests__/runs.test.ts src/http/__tests__/model-proxy.test.ts src/http/__tests__/model-proxy-fields.test.ts
npm --prefix packages/daemon run typecheck
npm --prefix packages/ui run typecheck
pnpm guard
cd /workspace/Tovu
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
node --import tsx packages/contracts/src/__tests__/admin-failure-copy.test.ts
node_modules/.bin/tsc -p tsconfig.json --noEmit
npm --prefix apps/admin run typecheck
npm run typecheck:tests
```

The guard completed with loopback/network permission; an earlier default-sandbox run stalled in its `git check-ignore --stdin` child and was stopped. All localhost integration commands ran with network permission. Strict complexity used:

```bash
cd /workspace/Jini
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/core/src/user-facing-error.ts packages/ui/src/features/panel-kit/failure-channel.ts packages/daemon/src/http/runs.ts packages/daemon/src/http/model-proxy.ts
cd /workspace/Tovu
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/admin/src/App.hooks.ts apps/admin/src/components/AdminFailureNotice/AdminFailureNotice.tsx apps/admin/src/lib/admin-failure-channel.ts apps/admin/src/lib/api.ts apps/admin/src/main.tsx apps/website/src/server/inbound/admin-http/routes/analytics/recent-hits.ts apps/website/src/server/inbound/admin-http/routes/forms/pull-submissions.ts apps/website/src/server/inbound/admin-http/routes/publish-content/peer-transport.ts apps/website/src/server/inbound/admin-http/routes/publish-content/peers.ts apps/website/src/server/inbound/admin-http/routes/publish-content/route-helpers.ts apps/website/src/server/inbound/admin-http/routes/system/site-share-errors.ts apps/website/src/server/inbound/shared/observability-middleware.ts packages/contracts/src/admin-failure-copy.ts
```

Final server focused command (cwd `/workspace/Tovu`):

```bash
TOVU_DB=memory node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-force-exit --test-concurrency=2 apps/website/src/server/inbound/admin-http/routes/system/__tests__/user-facing-failure.test.ts apps/website/src/server/inbound/shared/__tests__/observability-error-report.test.ts apps/website/src/server/inbound/shared/__tests__/publishing-peer-failure-context.unit.test.ts apps/website/src/server/inbound/admin-http/http/__tests__/ranked-user-facing-errors.test.ts apps/website/src/server/inbound/admin-http/http/__tests__/unexpected-route-errors.test.ts apps/website/src/server/inbound/admin-http/http/__tests__/newsletter-errors.test.ts apps/website/src/server/inbound/admin-http/routes/media/__tests__/trash-route.unit.test.ts apps/website/src/server/inbound/admin-http/routes/publish-content/__tests__/peer-transport.routes.pins.test.ts apps/website/src/server/inbound/admin-http/routes/publish-content/__tests__/peers.routes.pins.test.ts
```

Latest UUID-only formatter host check (21 passed, cwd `/workspace/Tovu`):

```bash
TOVU_DB=memory node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-concurrency=2 apps/website/src/server/inbound/admin-http/routes/system/__tests__/user-facing-failure.test.ts apps/website/src/server/inbound/shared/__tests__/observability-error-report.test.ts apps/website/src/server/inbound/shared/__tests__/publishing-peer-failure-context.unit.test.ts
```

Final admin command (cwd `/workspace/Tovu`):

```bash
npm --prefix apps/admin test -- --maxWorkers=2 src/lib/__tests__/admin-failure-channel.unit.test.ts src/components/__tests__/AdminFailureNotice.unit.test.tsx src/__tests__/unit/app-session-failure-reset.unit.test.tsx src/lib/__tests__/api-user-facing-fallback.unit.test.ts src/lib/__tests__/api-request-unreachable.unit.test.ts src/lib/__tests__/server-reconnect.unit.test.ts src/__tests__/unit/app-session-local-owner.unit.test.tsx src/__tests__/unit/app-session-unauthenticated-kickback.unit.test.tsx
```

Exact aggregate selector/run:

```bash
set -euo pipefail
cd /workspace/Tovu
mapfile -t error_test_files < <(
  {
    git grep -l -E 'assertAdminResponse|testRouteFailureMatrix' e327c07c8 -- ':(glob)apps/website/src/server/**/*.test.ts' | cut -d: -f2-
    cat <<'TESTS'
apps/website/src/server/inbound/admin-http/http/__tests__/ranked-user-facing-errors.test.ts
apps/website/src/server/inbound/admin-http/http/__tests__/unexpected-route-errors.test.ts
apps/website/src/server/inbound/admin-http/routes/system/__tests__/user-facing-failure.test.ts
apps/website/src/server/inbound/shared/__tests__/observability-error-report.test.ts
apps/website/src/server/inbound/shared/__tests__/unexpected-admin-escape-paths.unit.test.ts
apps/website/src/server/inbound/shared/__tests__/publishing-failure-copy.unit.test.ts
apps/website/src/server/inbound/shared/__tests__/publishing-peer-failure-context.unit.test.ts
TESTS
  } | sort -u
)
test "${#error_test_files[@]}" -ge 188
printf '%s\n' "${error_test_files[@]}" > /workspace/work/errors/final-affected-tests.txt
TOVU_DB=memory TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-force-exit --test-concurrency=4 "${error_test_files[@]}"

```

Raw command logs and baseline-proof copies are in `/workspace/work/errors` in this execution environment, not committed. Chrome verification used `/usr/bin/chromium` and intercepted every API response; no live or owner data was read. Required job reports are committed to `cloud/reports/errors.md` in both repositories.

## Every implementation/test commit pushed

### Jini

- `1957e630caaa2898a19f2e4e3653efba6b891dea` — fix(daemon): explain run startup and assistant response failures
- `0e1e666561870e6ca3707b781a831a1d7fedc40e` — feat(errors): add approved request wording and scoped failure channel
- `821a3be9edd98f854c65855009492463b88a76ab` — fix(errors): distinguish mutation phases and isolate notice effects
- `6163c40644317ce1b945a4e2df0be9029ab8b34b` — fix(errors): bound request context before tokenization
- `c672f1ef1da9d57ccc7586b54de49de0828dbb0e` — fix(errors): preserve public correlation IDs during PII redaction
- `5e1b011b54d196496dce38fa1f7e19546b3afd73` — refactor(errors): simplify public correlation ID shape checks
- `2cdc3bced0ea1759628428e99038e5410dabdf67` — fix(errors): keep cause-derived identifiers under PII policy

### Tovu

- `28ffcbbad81b2dc767e250dd9e8bfc06e9d7cb2d` — feat(errors): declare safe admin operation wording
- `20835c2b6342eaff4268ab31e46244ebe62aae68` — feat(admin): show final request failures in shared ErrorNotice
- `9f4d7d7fd89b7923d871afb0177b2b3ccc014fde` — fix(admin): default to safe correlated failure details across boundaries
- `28bff668c32beded4d7d6e4d2c8007e6dae86e37` — fix(admin): explain failures without a server incident reference
- `381dbb4191d5ef3eb3c0f46ba0749dc6333830fe` — fix(admin): preserve request-scoped error report deduplication
- `6f9931228922ff21dabd641c6676d4c10121368c` — wip(errors): pin explicit request failure snapshots across affected routes
- `fafa70c643326e34be21f91766640a74d39e523a` — test(errors): complete explicit admin failure snapshot expectations
- `05d1fae53f0ae84299bb6dfdc298edb9974784f0` — test(errors): fix direct preview expectations and request-tracking fixtures
- `0c90d9017d395ba8f3e1e3530a3d193f7c9bf40a` — fix(admin): preserve safe request context for publishing destinations
- `0c4409858c5bddefecd3491a6ec50d5225f1921f` — fix(admin): preserve expected client error statuses in final middleware
