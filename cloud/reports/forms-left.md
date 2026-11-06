# forms-left

Implementation complete. Scoped verification completed with the existing failures listed below. No full suite was run.

Approved scope: steps 1, 3 and 4 of FL-forms-left-plan, with COMMON and the forms-left job trims. Step 2/error recovery was excluded entirely. No deployment, publication, tag, main push, schema migration, storage_allocations table, new schedule, or live/owner-data maintenance occurred.

Both repositories use `cloud/forms-left`, created from the then-current `origin/cloud/combine` tips. All pushes target only that branch, without force. Clean temporary worktrees performed `git pull --rebase origin cloud/forms-left` immediately before each push so active workers were not stashed or interrupted.

## Branches and pushed implementation commits

### Jini

Base: `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`. Implementation tip: `9a7197f7af769ead2e7ea2bee06d546494cb92c8`.

- `d9da4f6b9` — docs: record forms maintenance scope
- `f60982c99` — fix: journal rendition keys before media removal
- `8575d5fd9` — fix: preserve answers when a form changes
- `efd44f1d7` — fix: serialize rendition writes with byte cleanup
- `a20aeff63` — fix: align published forms with schema review
- `744b08a8c` — feat: classify proven form attachment orphans
- `2b8848a25` — fix: recheck captured objects under writer locks
- `1bd088f44` — fix: bound form retry answers and preserve current choices
- `9badba897` — fix: serialize tombstones within host transactions
- `78423bb0d` — fix: retain attachments with historical references
- `9a7197f7a` — refactor: isolate rendition source reads

### Tovu

Base: `5358aa594fb6e8c0ca107b1106fbf9ae43871d50`. Implementation tip: `c1f8bfc158d06fee621285572e47e7381124521b`.

- `ce8584b96` — docs: record forms maintenance scope
- `31d50aa43` — fix: render current form schema metadata
- `371535f56` — fix: persist attachment cleanup before removing rows
- `dadf7faae` — refactor: keep schema rendering within complexity limits
- `19d86d121` — fix: avoid cleanup lock inversion and retain unproven assets
- `31330d6ae` — feat: maintain proven orphan form files explicitly
- `c1f8bfc15` — refactor: keep retained reference checks within complexity limits

The final report commit follows these implementation tips; its SHA is reported in the final response.

## Result

- Built-in form pages carry the existing canonical schema digest. A missing hash remains accepted. A present changed, duplicate, empty or malformed hash returns HTTP 409 before validation, rate admission, uploads, persistence or delivery. Metadata is excluded from answers.
- Native retries return the current form with no-store caching, compatible answers repopulated, consent reset and files reselected. Removed, incompatible or shortened answers remain escaped plain copy text. The complete non-file draft is bounded below 64 KiB, with visible truncation information. Current authored prose and control choices are preserved.
- Cloudflare rejects stale attempts with its plain error page and zero D1 operations; it does not construct repopulated HTML. Existing manifest hashing was already correct; cross-owner tests verify parity without duplicating that implementation.
- Shared media removal journals exact rendition keys before deleting rows, in the same host transaction. Existing outbox/grace/retry cleanup handles captured keys even after the original row disappears, rechecks exact shared ownership, and uses the output-byte writer lock. Older hash-only jobs remain supported; unknown key layouts retain retryable work.
- Rendition byte writes and ownership-row commits share that output lock. SQLite compensation avoids a transaction/hash-lock wait cycle through the existing tombstone owner's injected lock executor, bypassing the extra JavaScript hash lock only inside an actual SQLite transaction. Memory and other dialects retain the default hash behavior.
- Form purge updates its owner snapshot before tombstoning and refuses public assets whose only claimed provenance is a filename prefix. Failed-upload compensation uses the same durable cleanup binding.
- Explicit orphan maintenance previews by default and processes at most 100 increasing-key candidates per invocation. Exact canonical server cleanup records establish terminal removal intent; current, Trash, shared-hash, retained content/config/history, undo, delivery and publish records block cleanup. Missing/corrupt/opaque proof keeps the candidate with a fixed reason. Proven orphans become private in a committed transaction before ownership is rechecked for the existing Trash/purge/grace/outbox path.
- Legacy protection no longer treats a filename prefix as ownership evidence. Permanent unknowns warn and remain unchanged; the existing attempted-pass marker prevents repeated full boot scans. Transient protection failures retain the existing automatic retry behavior.

## Exact changed files

### Jini

- `cloud/reports/forms-left.md`
- `packages/agent-plugins/cloudflare/worker/__tests__/forms-validation-parity.test.mjs`
- `packages/agent-plugins/cloudflare/worker/forms-receiver.mjs`
- `packages/cms/src/forms/__tests__/attachment-cleanup.test.ts`
- `packages/cms/src/forms/__tests__/reconcile-attachments.test.ts`
- `packages/cms/src/forms/__tests__/stale-form.test.ts`
- `packages/cms/src/forms/attachment-cleanup.ts`
- `packages/cms/src/forms/errors.ts`
- `packages/cms/src/forms/express/__tests__/handler.test.ts`
- `packages/cms/src/forms/express/handler.ts`
- `packages/cms/src/forms/html-render.ts`
- `packages/cms/src/forms/html/__tests__/retry-draft.test.ts`
- `packages/cms/src/forms/html/html-authoring.ts`
- `packages/cms/src/forms/html/retry-draft.ts`
- `packages/cms/src/forms/index.ts`
- `packages/cms/src/forms/portable-validation.ts`
- `packages/cms/src/forms/reconcile-attachments.ts`
- `packages/cms/src/forms/stale-form.ts`
- `packages/cms/src/forms/submission-evidence.ts`
- `packages/cms/src/forms/submit-service.ts`
- `packages/cms/src/media/__tests__/media-service.test.ts`
- `packages/cms/src/media/__tests__/rendition-service.test.ts`
- `packages/cms/src/media/blob-gc.ts`
- `packages/cms/src/media/media-service.ts`
- `packages/cms/src/media/rendition-service.ts`
- `packages/cms/src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts`
- `packages/cms/src/widgets/resolvers/contact-form.ts`

### Tovu

- `apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts`
- `apps/website/src/features/forms/__tests__/form-file-purge.test.ts`
- `apps/website/src/features/forms/__tests__/form-file-renditions.test.ts`
- `apps/website/src/features/forms/__tests__/form-file-storage.test.ts`
- `apps/website/src/features/forms/__tests__/form-schema-hash.test.ts`
- `apps/website/src/features/forms/form-file-maintenance.ts`
- `apps/website/src/features/forms/form-file-purge.ts`
- `apps/website/src/features/forms/protect-existing-files.ts`
- `apps/website/src/features/media/__tests__/mediawidget-where-used.test.ts`
- `apps/website/src/features/media/purge-media.ts`
- `apps/website/src/features/media/where-used.ts`
- `apps/website/src/server/inbound/public-http/http/site/render.ts`
- `apps/website/src/server/runtime/composition/__tests__/form-file-cleanup.integration.test.ts`
- `apps/website/src/server/runtime/composition/app.ts`
- `apps/website/src/server/runtime/composition/deps.ts`
- `cloud/reports/forms-left.md`
- `scripts/forms-maintenance.ts`

Jini strict lint command (from its root):

```sh
./node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/agent-plugins/cloudflare/worker/forms-receiver.mjs packages/cms/src/forms/attachment-cleanup.ts packages/cms/src/forms/errors.ts packages/cms/src/forms/express/handler.ts packages/cms/src/forms/html-render.ts packages/cms/src/forms/html/html-authoring.ts packages/cms/src/forms/html/retry-draft.ts packages/cms/src/forms/index.ts packages/cms/src/forms/portable-validation.ts packages/cms/src/forms/reconcile-attachments.ts packages/cms/src/forms/stale-form.ts packages/cms/src/forms/submission-evidence.ts packages/cms/src/forms/submit-service.ts packages/cms/src/media/blob-gc.ts packages/cms/src/media/media-service.ts packages/cms/src/media/rendition-service.ts packages/cms/src/widgets/resolvers/contact-form.ts
```

Tovu strict lint command (from its root):

```sh
./node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/forms/form-file-maintenance.ts apps/website/src/features/forms/form-file-purge.ts apps/website/src/features/forms/protect-existing-files.ts apps/website/src/features/media/purge-media.ts apps/website/src/features/media/where-used.ts apps/website/src/server/inbound/public-http/http/site/render.ts apps/website/src/server/runtime/composition/app.ts apps/website/src/server/runtime/composition/deps.ts scripts/forms-maintenance.ts
```

## Verification commands and results

Source `/workspace/.tovu-build/env.sh` first. Run each command from the named repository root. Only changed/affected tests ran; no test, coverage rule or lint rule was skipped, weakened or disabled.

Setup: Jini `pnpm install --frozen-lockfile` (writable workspace store/cache) and `pnpm --no-bail -r build` passed on the base; Tovu `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. Tovu contracts were rebuilt using `npm --prefix packages/contracts run build` to replace stale base build output. Jini CMS was rebuilt and Tovu relinked after source changes.

### Jini

- `npm --prefix packages/cms run test -- src/forms/__tests__/stale-form.test.ts src/forms/html/__tests__/retry-draft.test.ts src/forms/__tests__/submit-service.test.ts src/forms/__tests__/submission-evidence.test.ts src/forms/html/__tests__/html-authoring.test.ts src/forms/express/__tests__/handler.test.ts src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts` — 77 passed, one existing logging assertion failed. All 11 new native tests passed. After the last draft helper edit, `npm --prefix packages/cms run test -- src/forms/__tests__/stale-form.test.ts src/forms/html/__tests__/retry-draft.test.ts` passed 8/8.
- `pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/attachment-cleanup.test.ts src/media/__tests__/media-service.test.ts src/media/__tests__/blob-gc.test.ts` — 90/90 passed.
- `npm --prefix packages/cms run test -- src/media/__tests__/rendition-service.test.ts` — 15/15 passed; the new concurrency regression failed before the output-hash lock fix.
- `pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/reconcile-attachments.test.ts` — 9/9 passed.
- `npm --prefix packages/cms run build` and `npm --prefix packages/cms run typecheck` — passed. Final worker builds also passed after the shared tombstone seam and retained-reference matcher changes.
- Sequential `node <file>` for `packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver-edges.test.mjs`, `packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs`, `packages/agent-plugins/cloudflare/worker/__tests__/forms-urgent.test.mjs`, `packages/agent-plugins/cloudflare/worker/__tests__/forms-validation-parity.test.mjs`, plus `packages/agent-plugins/cloudflare/lib/__tests__/forms-edges.test.mjs` and `packages/agent-plugins/cloudflare/lib/__tests__/forms.test.mjs` — 54/54 passed.
- `node packages/agent-plugins/cloudflare/targets/__tests__/forms-publish.test.mjs` — 5/5 passed, including the self-contained receiver/portable bundle and retained pending routes/storage identity.

### Tovu

The sandbox's child test runner sometimes exited without useful test output. Direct imports still execute the real node:test suites, show assertion failures and pass counts, and set a failing exit status.

- `node --import tsx -e "import('./apps/website/src/features/forms/__tests__/form-file-renditions.test.ts').catch(error => {console.error(error); process.exitCode=1})"` — 5/5 passed: SQL rollback/reopen, exact shared-key ownership, canonical writer locks, real upload versus compensation deadlock, and default-lock fallback.
- `node --import tsx -e "import('./apps/website/src/features/forms/__tests__/form-file-storage.test.ts').catch(error => {console.error(error); process.exitCode=1})"` — 2/2 passed.
- `node --import tsx --import ./development/test-support/composed-bundle-env.ts -e "import('./apps/website/src/server/runtime/composition/__tests__/form-file-cleanup.integration.test.ts').catch(error => {console.error(error); process.exitCode=1})"` — 2/2 passed through actual persistent deps and Trash, including the spoofed filename refusal.
- `node --import tsx apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts` — 11/11 passed, including preview/apply on disposable SQLite, private-first failure, retained/current/Trash/undo/publish owners, corrupt proof, explicit cursor and 100-row resume.
- `node --import tsx apps/website/src/features/forms/__tests__/form-file-purge.test.ts` — 8/8 passed.
- `node --import tsx --import ./development/test-support/composed-bundle-env.ts apps/website/src/features/forms/__tests__/form-schema-hash.test.ts` — 1/1 passed; the equivalent command for `form-destination-manifest.test.ts` passed 10/10.
- `node --trace-exit --trace-uncaught --import tsx --import ./development/test-support/composed-bundle-env.ts apps/website/src/features/media/__tests__/mediawidget-where-used.test.ts` — 4/5 passed, including the new Trash reference protection; one unrelated existing route error-copy expectation failed.
- `npx tsc -p tsconfig.json --noEmit` — final merged check passed.
- `npx tsc -p /workspace/work/forms-left/tsconfig.maintenance.json --noEmit` — final explicit CLI check passed. Temporary config extends `/workspace/Tovu/tsconfig.json`, sets rootDir to Tovu, typeRoots to its node_modules/@types, and includes `scripts/forms-maintenance.ts` plus website declarations; the CLI is not silently omitted by the ordinary root include list.
- `node --import tsx scripts/forms-maintenance.ts --help` — passed without opening any database.

### Complexity, review and integrity

Strict lint used `eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' <changed-production-paths>` in each repository. Jini's changed forms/media/worker units and Tovu's new adapters, maintenance CLI, media reference adapter and rendering pass. No rules or configuration changed.

Tovu's existing composition functions retain exactly the four errors reproduced with the same policy against the base source: `composeSiteRouteDeps` cyclomatic 21/cognitive 21, `createRouteDeps` 11, and `createApp` 11. New adapter functions have zero complexity errors; no new increase was retained. Existing warning details are below.

`git diff --check` passed in both repositories. Independent advisory review found no remaining actionable correctness/security issues after the fixes. Separate native SQLite probes verified exclusive admission for both DELETE and WAL modes and reproduced the corrected kernel/hash wait cycle. These are scoped source/runtime checks; no full-suite or coverage percentage is claimed.

Red-before-green evidence covered stale schema effects, unsafe draft truncation, mixed-case consent handling, multipart hash handling, durable key journaling, partial cleanup retries, snapshot tombstoning, filename spoofing, orphan proof and concurrent compensation. Test assertions inspect real state, durable outbox records, reopened databases and byte preservation.

## Explicit command and safety boundary

`node --import tsx scripts/forms-maintenance.ts --database <existing-content.db> --workspace <id> [--after <media-id>] [--apply]`

Preview opens an existing database read-only. Apply requires exclusive SQLite admission and fails before changes if another connection prevents it. It performs one batch and returns `nextAfter` for another explicit invocation. It does not bootstrap a site, run migrations, invent proof, list object storage, delete bytes immediately, or install a schedule. No command was run on owner data. Concurrent/PostgreSQL maintenance apply has not been validated or exposed by this command.

## Added state and I/O cost

- Form render: one local digest over the already-loaded schema and one small hidden field per built-in form; zero new database reads. Hashed native submission: one extra local digest before existing evidence capture; missing hashes add no digest check. Native stale response: current form plus bounded draft, zero persistence writes/cookies/polls. Worker stale response: zero D1 reads/writes.
- Media removal: one rendition identity read plus one existing outbox write per asset, carrying exact key strings, in the removal transaction. No file bytes are downloaded.
- Cleanup delivery: one additional original lookup when captured keys exist, then a writer lock, up to two ownership probes and at most one idempotent object DELETE per distinct key. Existing outbox delivery/retry frequency is reused. Existing schema has no storage-key index, so those probes may scan rendition/blob rows; no schema/index was added.
- Maintenance: at most 100 candidate metadata rows per explicit invocation. Most old files stop after the missing-proof check. Proven candidates use paged reads of at most 100 rows per existing owner/history source, once for preview or up to three times for apply's preflight/private/purge checks. The existing purge owner also makes its usual media/post list. Cost is O(candidates × retained-reference bytes); no stale proof cache, periodic scan, or new persisted ledger was introduced.
- Legacy boot protection preserves its previous once-per-site attempted pass and transient-failure retry cost; uncertain permanent records do not cause repeated whole-site scans.

## Cloudflare release requirement

Re-export every affected static page embedding a built-in form and republish that site's existing Worker in the same release. Upload the bundle containing `index.mjs`, changed `receiver.mjs`, changed `portable-validation.mjs`, and current `forms-manifest.mjs`; the pages' hidden hashes must correspond to that manifest. Preserve the existing D1 database ID, receiver URL, secret, and authenticated pending/ack routes. External-provider-only pages do not need this change. Hashless pages remain accepted until republished; they gain stale detection when republished.

Native handling, cleanup and maintenance additionally require the updated Jini CMS code in the Tovu runtime release. No Cloudflare D1 migration or credentials change is needed. Nothing was deployed or published during this job.

## Open items and findings

BUG (existing baseline): CMS handler test `a failing definition lookup is logged and the validation redirect still happens` expects an Error object, while existing redacted production logging emits a string. It failed before implementation and remains unchanged.

BUG (unrelated existing assertion): media where-used route test expects the older generic admin error payload; current route emits the specific media-operation error with failure details. The new Trash usage regression passes. No error-copy code or original assertion was changed.

BUG (unrelated broader startup): `commerce_get_status has no approval classification` prevents the old createApp-based broader delivery fixture from starting. The new actual deps/Trash lifecycle checks pass without that unrelated app/tool bootstrap; its source was not modified for this issue.

OPEN (existing complexity): the four composition errors above remain; strict rules were not weakened. Existing portable-validation regex performance and media expression/nesting warnings remain unchanged.

OPEN (conservative inventory): legacy files lacking exact terminal proof, unreadable history or opaque restore points are kept with a reason. No production inventory/counts or historical error recovery were attempted. Maintenance apply is verified only for offline exclusive SQLite.

ADVISORY (scale): repeated retained-reference reads and exact-key ownership scans are explicit, cold work and can be expensive for large histories. State costs are documented above; new tables/indexes/caches are outside this job.

Workspace note: an untracked leftover `Jini/packages/plugin-ui-ux-design/` is outside the committed change and was left alone. Temporary tests/probes/build logs and push worktrees live under `/workspace/work/forms-left`.
