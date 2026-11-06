# forms-privacy

Status: implementation complete for the approved steps 1–4. Focused validation passes; full-app delivery validation is partial because of a reproduced baseline startup bug.

Branch in both repositories: `cloud/forms-privacy`. No push to main, force push, deployment, tag, or package publication. Work started at 2026-11-05 19:49 America/Los_Angeles and finished within the two-hour cap.

Instructions: `cloud/jobs/COMMON.md`, `cloud/jobs/forms-privacy.md`, `cloud/plans/FP-forms-privacy-plan.md`, and `cloud/plans/TRIM.md` from Jini `origin/cloud-plans-1105`. Loaded the supplied software-architect, programmer, and TDD personas. Used the repository-required sidekick for bounded implementation and verification.

Bases fetched from the current forms-left tips:
- Jini: `e0dab177afd45fccca44fef82b0a36b37b1c87f5`.
- Tovu: `64aae82d7683805c29dbb07aeb08e06f96d3bbdb`.

## Changes

1. New destination delivery jobs store binding metadata, captured form metadata, submission/form identity, and the existing idempotency key. They contain no answer snapshot. Jini hydrates a reference through an injected read port on each attempt; Tovu binds a workspace-scoped source lookup and verifies its form. Missing/purged sources or a mismatched source identity stop delivery before the adapter. Missing wiring fails terminally; source read errors retry with the existing safe error code. Legacy snapshot jobs remain readable without a source lookup. Existing purge code scrubs legacy snapshots and terminally fails unfinished jobs in either format; job IDs, retry policy, index tables, and plan-once semantics remain unchanged.
2. Submission deduplication now requires a nonempty explicit string attempt token. Tokenless and malformed-token callers remain valid and independent, including identical answers/uploads behind one IP. Explicit-token retries, timing evidence, rate limits, concurrent claims, failed-first-attempt recovery, and upload compensation retain their behavior.
3. The existing Jini `idPrefix` mechanism now reaches both native and external generated form bodies. Tovu allocates an occurrence UUID at its contact-form render boundary, so repeated resolved IR across embeds/regions does not reuse control IDs. Labels, grouped choices, help, and error associations use the same prefix. Fully authored HTML remains authored; this job changes generated Builder IDs. Existing styling hooks and field names remain stable.
4. Both Admin submission declarations reuse `FormAnswer`, preserving number, choice-array, and file answers across the typed boundary. The common model-facing form tool projection exposes stored `mode` and `html`, including empty stored HTML, while preserving absence on legacy definitions.

No compaction command, shared storage quota, new table, migration, framework, or maintenance scan was added. Extra test-file changes outside the plan's exact test list only update affected upload, rendering, purge, and PostgreSQL fixtures for the approved contracts.

## Commits

All code/test commits below were pushed successfully. The final report-only commit is identified by the branch head and the final user message.

### Jini
- `b25b6c9220a3a7a38ecfb23149999ebb87c94c1d Preserve token retry coverage for uploads`
- `d7d766683584eb949f4de919bddf3bedf138b467 Keep form controls distinct and verify delivery compatibility`
- `a6d5d1dae07cf246326e8ac4dd3f902ac9e9611d Improve form delivery and answer contracts`

### Tovu
- `2fcbb96429b32bfdbaaf89250e8039ad74d5cf79 Keep form controls distinct and verify delivery compatibility`
- `be90a02d98bcd4da9b2f11b320ef0d892fd0f60f Improve form delivery and answer contracts`

## Exact changed files

### Jini
- `cloud/reports/forms-privacy.md`
- `packages/admin/src/core/ports/forms.ts`
- `packages/admin/src/forms/__tests__/answer-format.unit.test.ts`
- `packages/admin/src/forms/models.ts`
- `packages/cms/src/forms/__tests__/file-fields.test.ts`
- `packages/cms/src/forms/__tests__/html-render.test.ts`
- `packages/cms/src/forms/__tests__/submit-service.host-options.test.ts`
- `packages/cms/src/forms/delivery/__tests__/deliver-job.unit.test.ts`
- `packages/cms/src/forms/delivery/__tests__/planner.unit.test.ts`
- `packages/cms/src/forms/delivery/__tests__/subscriptions.unit.test.ts`
- `packages/cms/src/forms/delivery/deliver-job.ts`
- `packages/cms/src/forms/delivery/index.ts`
- `packages/cms/src/forms/delivery/planner.ts`
- `packages/cms/src/forms/delivery/subscriptions.ts`
- `packages/cms/src/forms/delivery/types.ts`
- `packages/cms/src/forms/html-render.ts`
- `packages/cms/src/forms/submission-attempts.ts`
- `packages/cms/src/forms/submit-service.ts`

### Tovu
- `apps/website/src/features/forms/__tests__/tool-definition-view.unit.test.ts`
- `apps/website/src/features/forms/tool-registrations.ts`
- `apps/website/src/features/widgets/__tests__/integration/html-form-embeds.integration.test.ts`
- `apps/website/src/platform/db/repos/__tests__/form-delivery-repo.dialects.test.ts`
- `apps/website/src/platform/db/repos/__tests__/form-delivery-repo.postgres.test.ts`
- `apps/website/src/platform/db/repos/form-delivery-repo.ts`
- `apps/website/src/server/inbound/public-http/http/site/__tests__/form-field-max-length.unit.test.ts`
- `apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts`
- `apps/website/src/server/inbound/public-http/http/site/__tests__/render.test.ts`
- `apps/website/src/server/inbound/public-http/http/site/render.ts`
- `apps/website/src/server/runtime/composition/__tests__/form-delivery-purge.integration.test.ts`
- `apps/website/src/server/runtime/composition/__tests__/form-delivery-vertical-slice.fixture.ts`
- `apps/website/src/server/runtime/composition/__tests__/form-delivery.security.test.ts`
- `apps/website/src/server/runtime/composition/__tests__/form-delivery.test.ts`
- `apps/website/src/server/runtime/composition/form-delivery.ts`
- `cloud/reports/forms-privacy.md`

## Validation

Source `/workspace/.tovu-build/env.sh` before every command below. Commands ran inside this container. Logs are under `/workspace/work/forms-privacy/`.

Setup:
```sh
cd /workspace/Jini
CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store
pnpm --no-bail -r build
cd /workspace/Tovu
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```
All final builds passed. The initial install tried a read-only default pnpm store; the workspace-local store resolved it. The initial recursive build overlapped new red tests and therefore is not claimed as a clean baseline build. An isolated archive of the untouched forms-left CMS sources and original six focused test files subsequently passed **77/77**, with zero skipped tests. Original source/test files were used, with installed package dependencies linked into scratch. No real source changes were made for that baseline.

Failing regression evidence preceded implementation: reference jobs and purged-source delivery, tokenless/malformed-token acceptance, occurrence prefixes, Admin rich-answer type assignments, and mode/HTML tool projection. Existing duplicate upload/window fixtures were supplied explicit tokens to retain their original single-attempt assertions; a separate new test checks independent tokenless uploads. No test, assertion, rule, or coverage scope was deleted, skipped, disabled, or weakened.

Final focused CMS command: **163/163 passed**, zero skipped.
```sh
cd /workspace/Jini/packages/cms
pnpm exec vitest run \
  src/forms/delivery/__tests__/planner.unit.test.ts \
  src/forms/delivery/__tests__/deliver-job.unit.test.ts \
  src/forms/delivery/__tests__/subscriptions.unit.test.ts \
  src/forms/__tests__/submit-service.host-options.test.ts \
  src/forms/__tests__/submission-attempts.test.ts \
  src/forms/__tests__/html-render.test.ts \
  src/forms/__tests__/html-render.fields.test.ts \
  src/forms/__tests__/submit-service.test.ts \
  src/forms/__tests__/submit-service.boundaries.test.ts \
  src/forms/__tests__/file-fields.test.ts
```
Log: `cms-final-verified.log`. One intentional throwing-notification scenario prints its expected warning and passes.

Admin formatting command: **27/27 passed**.
```sh
cd /workspace/Jini/packages/admin
pnpm exec vitest run src/forms/__tests__/answer-format.unit.test.ts
```
Log: `admin-final-verified.log`.

Tovu commands ran from `/workspace/Tovu`. The exact commands (with each explicit file set) are recorded below; all use the same existing composed test setup.

The exact file sets and results:
- `apps/website/src/features/forms/__tests__/tool-definition-view.unit.test.ts`, `apps/website/src/features/forms/__tests__/common-field-tools.test.ts`, `apps/website/src/features/forms/__tests__/tool-registrations.model-facing-errors.test.ts`: **11/11 passed** (`step4-tools-affected.log`).
- `apps/website/src/server/runtime/composition/__tests__/form-delivery.test.ts`: **5/5 passed** (`tovu-composition-final.log`). This checks complete hydrated form/binding/submission/key metadata and missing-source refusal.
- `apps/website/src/server/runtime/composition/__tests__/form-delivery-subscribers.test.ts`: **2/2 passed** (`tovu-delivery-final-1.log`).
- `apps/website/src/server/runtime/composition/__tests__/form-delivery.security.test.ts`: **12/12 passed** across SQLite/PGlite (`tovu-delivery-final-2.log`).
- `apps/website/src/platform/db/repos/__tests__/form-delivery-repo.dialects.test.ts`: **36/36 passed** across SQLite/PGlite (`repo-dialects.log`). Tests preserve old queued snapshots as explicit legacy fixtures and separately prove reference rows contain no answers and remain unchanged on replay/purge.
- `apps/website/src/platform/db/repos/__tests__/form-delivery-repo.postgres.test.ts`: **2/2 passed** against real PostgreSQL (`repo-postgres.log`). Started only the provided fixture server using `bash /workspace/.tovu-build/start-postgres.sh`. No owner data was read.
- Render set: `apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts`, `apps/website/src/server/inbound/public-http/http/site/__tests__/render.test.ts`, `apps/website/src/server/inbound/public-http/http/site/__tests__/form-field-max-length.unit.test.ts`, `apps/website/src/server/inbound/public-http/http/site/__tests__/form-field-types-style.unit.test.ts`, `apps/website/src/features/widgets/__tests__/integration/html-form-embeds.integration.test.ts`: **239 tests passed across the final runs**. The first combined run passed 236 and could not launch the three browser tests because the expected Playwright executable was absent. The entire four-test layout file then passed using installed `/usr/bin/chromium` via a scratch executable symlink and `PLAYWRIGHT_BROWSERS_PATH=/workspace/work/forms-privacy/playwright`, with executor network permission enabled for Chromium's socket operations. No assertion changed for the environment. Logs: `tovu-render-focused.log`, `tovu-render-browser-network.log`.

```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/features/forms/__tests__/tool-definition-view.unit.test.ts \
  apps/website/src/features/forms/__tests__/common-field-tools.test.ts \
  apps/website/src/features/forms/__tests__/tool-registrations.model-facing-errors.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/runtime/composition/__tests__/form-delivery.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/runtime/composition/__tests__/form-delivery-subscribers.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/runtime/composition/__tests__/form-delivery.security.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/platform/db/repos/__tests__/form-delivery-repo.dialects.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/platform/db/repos/__tests__/form-delivery-repo.postgres.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts \
  apps/website/src/server/inbound/public-http/http/site/__tests__/render.test.ts \
  apps/website/src/server/inbound/public-http/http/site/__tests__/form-field-max-length.unit.test.ts \
  apps/website/src/server/inbound/public-http/http/site/__tests__/form-field-types-style.unit.test.ts \
  apps/website/src/features/widgets/__tests__/integration/html-form-embeds.integration.test.ts

PLAYWRIGHT_BROWSERS_PATH=/workspace/work/forms-privacy/playwright TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/runtime/composition/__tests__/form-delivery-vertical-slice.integration.test.ts

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --test-isolation=none --experimental-test-module-mocks \
  apps/website/src/server/runtime/composition/__tests__/form-delivery-purge.integration.test.ts
```

Typechecks, all passed after rebuilding stale dependencies:
```sh
cd /workspace/Jini
pnpm --filter @jini-ai/cms run typecheck
pnpm --filter @jini-ai/admin run typecheck
cd /workspace/Tovu
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Logs: `cms-tsc-closeout.log`, `sidekick-admin-typecheck.log`, `sidekick-tovu-tsc-final.log`. Earlier missing exports were stale build output and cleared without unrelated source edits.

Complexity: all **14 changed production TypeScript files** pass both ceilings at 10, zero errors/warnings. From each repository root the explicit path set was every production `.ts` path listed above, excluding `__tests__` and the report:
```sh
# Jini
pnpm exec eslint --no-inline-config \
  --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'  \
  packages/admin/src/core/ports/forms.ts \
  packages/admin/src/forms/models.ts \
  packages/cms/src/forms/delivery/deliver-job.ts \
  packages/cms/src/forms/delivery/index.ts \
  packages/cms/src/forms/delivery/planner.ts \
  packages/cms/src/forms/delivery/subscriptions.ts \
  packages/cms/src/forms/delivery/types.ts \
  packages/cms/src/forms/html-render.ts \
  packages/cms/src/forms/submission-attempts.ts \
  packages/cms/src/forms/submit-service.ts
# Tovu
npm exec -- eslint --no-inline-config \
  --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'  \
  apps/website/src/features/forms/tool-registrations.ts \
  apps/website/src/platform/db/repos/form-delivery-repo.ts \
  apps/website/src/server/inbound/public-http/http/site/render.ts \
  apps/website/src/server/runtime/composition/form-delivery.ts
```
Logs: `sidekick-jini-final-complexity.json`, `sidekick-tovu-final-complexity.json`. `git diff --check` passed in both repositories. No full suite or coverage run was requested or run.

Full-app validation remains partial:
- `apps/website/src/server/runtime/composition/__tests__/form-delivery-vertical-slice.integration.test.ts`: 11 tests, 1 passed, 3 failed, 7 cancelled. App creation fails on the existing commerce approval-classification error below.
- `apps/website/src/server/runtime/composition/__tests__/form-delivery-purge.integration.test.ts`: 2 tests cancelled before assertions by the same app startup error.
- Running the **original purge fixture on untouched Tovu forms-left** `64aae82d7683805c29dbb07aeb08e06f96d3bbdb`, in a detached scratch worktree, reproduces exactly the same error and two cancellations. Logs: `tovu-delivery-final-3.log`, `tovu-delivery-final-4.log`, `baseline-tovu-purge.log`. No approval policy was bypassed or mocked. Focused composition and actual database purge/retry checks above pass.

## Legacy copies and remaining work

- Pre-change destination job rows in `outbox_events.event_json` can still retain `payload.snapshot.submission.answers`, including completed, failed, pending, and processing jobs. They are deliberately not rewritten or compacted by this job. The legacy reader continues delivering queued snapshots. Existing explicit source/form purge scrubs these indexed snapshots and stops unfinished jobs; completion by itself does not compact them. No live database inventory or count was performed.
- Canonical local answers/evidence remain in `form_submissions.data_json` until their source is explicitly purged. This is the intended source for new references, not an extra per-destination copy. Notification child jobs already hold source IDs and recipient metadata, not answer snapshots.
- Cloudflare pending/unacknowledged submission answers remain intentionally collectable. Deployments still using older receiver/provisioning code may retain acknowledged rows/raw IPs until the existing publish preparation is run. Current forms-left source deletes acknowledged rows and clears legacy IPs at preparation, then deletes newly acknowledged submissions. No remote data was inspected or modified here.
- Already delivered email/destination copies are outside local purge. Existing attachment residue/remediation belongs to forms-left and was not re-inventoried or changed here.
- Durable cross-process deduplication and shared storage quotas remain outside this job. Full suites and the full-app delivery fixtures must be rerun after the existing commerce startup bug is resolved.

BUG (existing): `commerce_get_status has no approval classification` at Tovu `apps/website/src/assistant/assistant-tool-approval-policy.ts:46` prevents the full-app delivery fixture from reaching its assertions; confirmed on the untouched base. Not fixed outside this job's scope.

BUG (fixed): new destination jobs duplicated answers in each persisted child job.

BUG (fixed): tokenless identical submissions behind a shared IP silently collapsed, including file submissions.

BUG (fixed): repeated generated forms reused control/help/error IDs.

BUG (fixed): public Admin answer declarations omitted numbers/arrays/files; the model-facing tool view omitted stored mode/HTML.

Setup residue observed: Jini `packages/plugin-ui-ux-design/` is an untracked stale/generated directory from installed dependencies; left untouched and uncommitted. No unrelated code was changed.

## Cloudflare republish requirements

1. Regenerate and republish static HTML for every Cloudflare page containing a generated Builder form, including pages where a shared header/footer/sidebar region embeds a form, repeated HTML/Tiptap embeds, external native-POST Builder forms, and HTML-mode fallback bodies generated from fields. These pages need the new occurrence IDs. Authored form markup is not rewritten. Also include the combined forms-left schema/stale-form metadata in the same normal export.
2. For deployments that have not received the combined forms-left receiver/privacy changes, publish the Worker module set together: `index.mjs`, `receiver.mjs`, `portable-validation.mjs`, and newly enriched `forms-manifest.mjs`, using the current `provisionForms` publish preparation. That preparation removes old acknowledged rows and legacy raw IPs. Preserve the existing D1 database/binding `TOVU_FORMS`, receiver URL, `TOVU_FORMS_SECRET`, and pending pull/ack access. Do not replace the database or rotate the receiver identity for this change.
3. The incremental runtime delivery-reference, deduplication, Admin type, and tool projection changes in this job do **not** independently require a Worker code republish. They require the updated Jini packages and Tovu runtime to be used by the normal release. Static form HTML still requires item 1. No Cloudflare deployment was inspected or published, so which deployed sites already have item 2 is unverified.

## Cost and review

State cost: for S submissions, D selected destinations, and T attempts per job, the existing job-write count remains S × D; new payloads replace answer bytes with a small reference. Referenced delivery adds S × D × T indexed source-row reads, each loading answers/evidence/row metadata once. No poll, scan, table, or timer is added. Tokenless callers now incur their normal independent submission/upload/event costs rather than losing valid data. ID generation adds one UUID per rendered form occurrence and only HTML bytes; types and tool projection add no database I/O.

Reuse: retained the existing plan store, outbox retry policy, error sanitizer, source repositories, purge transaction, `FormAnswer`, `FormAuthoring`, and `idPrefix` rendering. No parallel workflow owner was added. The scoped source read remains behind Jini's injected port, with Tovu wiring only.

Architecture audit: PASS for changed production paths: neutral Jini logic, explicit host source port, no new schema, no plugin cross-import, no vendor core code, no product-specific dependency in Jini, and existing public signatures preserved. `idPrefix` is propagated through existing options; Tovu owns occurrence identity.

Function review: planner/ref hydration/subscriptions, token admission, purge projection, generated render paths, and tool projection each retain one owner and direct observable tests. Query shape is documented at the attempt boundary. The review caught and restored one full frozen-form assertion in the composed-delivery test. A final name/invariant pass checked scoped IDs, metadata/answer separation, stable retry keys, terminal source refusal, and full DOM associations; no unresolved finding was introduced in the changed units. Source lookup and provider send are separate effects, as before; no external-destination transaction was added.

Pre-completion: approved scope rechecked, changed-file inventory captured, fresh targeted evidence recorded, integrity reviewed, all code/test commits pushed to the specified branch, and the baseline integration blocker listed explicitly. No production rollout is claimed.
