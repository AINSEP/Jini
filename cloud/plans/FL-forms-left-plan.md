Loaded both requested skill files. Goal: finish stale-form handling, recover only provable original errors, and safely clean up proven orphan files.

Read-only review of `origin/cloud/combine`: Jini `7932eef2c`, Tovu `4c793bc5d`. No files changed or project checks run.

**Findings**

- Evidence capture already exists; native acceptance captures the stored definition but does not compare it with the visitor’s page. [submission-evidence.ts:36](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submission-evidence.ts:36), [submit-service.ts:95](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submit-service.ts:95).
- Cloudflare likewise validates against its current manifest without checking the page’s schema hash. [forms-receiver.mjs:69](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/forms-receiver.mjs:69).
- Import reports contain remote ID, submission ID and field errors. Receipts store the corresponding submission ID under `(workspace, destination, remote ID)`, but expose only `claim`. [import-remote-submissions.ts:52](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/import-remote-submissions.ts:52), [form-submission-receipt-repo.ts:15](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/repos/form-submission-receipt-repo.ts:15).
- Durable cleanup already exists through the outbox, grace period and ownership recheck. Rendition rows, however, disappear before their keys are captured. [attachment-cleanup.ts:18](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/attachment-cleanup.ts:18), [media-service.ts:880](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/media/media-service.ts:880).
- Legacy protection accepts filename prefixes as ownership evidence; current content-reference checks skip trashed posts. Both are unsafe foundations for orphan classification. [protect-existing-files.ts:54](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/protect-existing-files.ts:54), [where-used.ts:27](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/media/where-used.ts:27).
- **UNVERIFIED:** retained historical reports/backups, recoverable orphan identities, deployed versions and current test results. Graph MCP was unavailable; the tracked knowledge graph predates these changes. Source evidence uses bounded `git show`/`git grep`.

**Ordered changes**

Paths below are repository-relative. Line estimates exclude generated artifacts; tests are proposed, not executed.

1. **Detect stale pages and preserve answers — 7–10 Codex hours.**

   Jini files:
   - `packages/cms/src/forms/submission-evidence.ts`
   - `packages/cms/src/forms/portable-validation.ts`
   - `packages/cms/src/forms/submit-service.ts`
   - `packages/cms/src/forms/types.ts`
   - `packages/cms/src/forms/errors.ts`
   - `packages/cms/src/forms/html-render.ts`
   - `packages/cms/src/forms/express/handler.ts`
   - `packages/cms/src/widgets/resolvers/contact-form.ts`
   - `packages/agent-plugins/cloudflare/worker/forms-receiver.mjs`

   Tovu files:
   - `apps/website/src/features/forms/form-destination-manifest.ts`
   - `apps/website/src/server/inbound/public-http/http/site/render.ts`

   Render a reserved hidden schema hash using the existing canonical schema owner. Compare before field validation, uploads or acceptance; strip it from answers. Align native and manifest hashing, including HTML definitions.

   On mismatch, return HTTP 409 with a `no-store` retry response: “This form changed while you were filling it in. Your form has not been sent. Your previous answers are kept below. Please review the updated form.”

   Keep bounded non-file answers as escaped draft text. Repopulate only values compatible with current controls; retain changed/removed answers separately for copying. Require consent again and file reselection. Missing or malformed hashes on browser submissions receive the same review flow without claiming a confirmed change. Preserve legacy API compatibility; a missing hash provides no stale-page guarantee.

   **Why no smaller:** comparing hashes alone loses answers; capturing today’s schema alone does not identify an old page. No schema-history store is needed.

   Roughly **+240–360 / −30–70 production lines**. Tests **+180–260**, in:
   - `packages/cms/src/forms/express/__tests__/handler.test.ts`
   - new `packages/cms/src/forms/__tests__/stale-form.test.ts`
   - `packages/agent-plugins/cloudflare/worker/__tests__/forms-validation-parity.test.mjs`
   - Tovu `apps/website/src/features/forms/__tests__/form-destination-manifest.test.ts`

   Cover changed fields/consent, HTML parity, missing/duplicate hashes, hostile values, answer preservation and zero acceptance effects.

2. **Recover errors from supplied retained reports — 4–6 hours.**

   Files:
   - new Jini `packages/cms/src/forms/recover-validation.ts`
   - Jini `packages/cms/src/forms/index.ts`
   - Jini `packages/cms/src/forms/submission-json.ts`
   - Tovu `apps/website/src/platform/db/repos/form-submission-receipt-repo.ts`
   - new Tovu `scripts/forms-maintenance.ts`

   Jini owns matching and recovery decisions behind receipt/read/conditional-write ports. Tovu supplies database and retained-report access.

   Match workspace, exact destination identity and remote ID; require the receipt’s submission ID to equal the report’s submission ID. Recover only missing validation metadata. Preserve answers/evidence, skip purged rows, refuse conflicting reports, and emit no submission or delivery event. Reports lacking trustworthy scope remain unusable. Leave unavailable history explicitly unknown; do not reconstruct it by validating today’s schema.

   **Why no smaller:** remote IDs alone collide across destinations; unconditional updates can overwrite newer evidence. A maintenance command avoids a new API, UI or recurring scan.

   Approximately **+140–220 / −0–15 lines**; tests **+110–170** in new Jini `packages/cms/src/forms/__tests__/recover-validation.test.ts` and existing Tovu `apps/website/src/platform/db/repos/__tests__/form-submission-receipt-repo.dialects.test.ts`.

3. **Journal rendition keys before deletion — 4–6 hours.**

   Files:
   - Jini `packages/cms/src/media/media-service.ts`
   - Jini `packages/cms/src/forms/attachment-cleanup.ts`
   - Tovu `apps/website/src/features/forms/form-file-storage.ts`
   - Tovu `apps/website/src/server/runtime/composition/deps.ts`
   - Tovu `apps/website/src/server/runtime/composition/app.ts`

   Add a small injected cleanup-journal callback to the shared removal path. Read exact rendition keys and commit their cleanup job before deleting their records, within the same database transaction. Bind it for form purge and failed-upload compensation.

   Extend existing cleanup jobs to handle captured keys independently of whether the original blob row still exists. Recheck exact-key/shared ownership after grace; retain failed work for existing retries. Continue supporting older job payloads.

   **Why no smaller:** keys held only in memory disappear on a crash; reading them after deletion is impossible.

   Approximately **+90–150 / −20–40 lines**; tests **+120–180** in:
   - Jini `packages/cms/src/forms/__tests__/attachment-cleanup.test.ts`
   - Jini `packages/cms/src/media/__tests__/media-service.test.ts`
   - Tovu `apps/website/src/features/forms/__tests__/form-file-purge.test.ts`

   Cover rollback, restart, partial deletion, missing originals and shared keys.

4. **Classify and clean proven orphans; omit `storage_allocations` — 6–9 hours.**

   Files:
   - new Jini `packages/cms/src/forms/reconcile-attachments.ts`
   - Jini `packages/cms/src/forms/index.ts`
   - new Tovu `apps/website/src/features/forms/form-file-maintenance.ts`
   - Tovu `apps/website/src/features/forms/protect-existing-files.ts`
   - Tovu `apps/website/src/features/forms/form-file-purge.ts`
   - Tovu `apps/website/src/features/media/where-used.ts`
   - Tovu `apps/website/src/server/runtime/composition/deps.ts`
   - Tovu `scripts/forms-maintenance.ts`

   Run explicitly requested maintenance in resumable batches of at most 100 candidates. Require trustworthy records connecting the exact media/object identity to a completed form upload, plus proof that no live or restorable owner remains. Absence of a submission during a possible in-flight upload is insufficient.

   Proven orphans become private first, then enter existing Trash/grace/outbox cleanup. Ambiguous candidates stay protected from deletion; established-private files remain private. Include trashed content and retained references. Missing evidence or failed ownership checks mean “keep and explain,” never filename inference.

   **Cleanup works without `storage_allocations`.** Existing metadata, outbox payloads and ownership checks provide deletion identities and retry state. The proposed table served exact quota reservations/accounting, which this job does not require. Add no schema migration; any later DDL must use ADR-066 TypeScript migrations.

   **Why no smaller:** deleting on absence alone risks active uploads and restorable content. A reservation ledger would not establish historical ownership.

   Approximately **+180–280 / −20–50 lines**; tests **+150–220** in new Jini `packages/cms/src/forms/__tests__/reconcile-attachments.test.ts` and new Tovu `apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts`.

**Added I/O cost**

Proposed bounds, not measurements: `A` = retained answer bytes; `J` = submission JSON bytes; `M` = candidate metadata; `K` = captured keys; `P` = content/reference bytes examined.

| Trigger | Added reads/writes/polls |
|---|---|
| Form render/export | **0 extra database reads**; existing HTML gains roughly **120 bytes/form**. One local digest/schema. |
| Submission | Existing POST gains roughly **80–100 bytes**. **0 extra database reads**; compare against the already loaded definition/manifest. |
| Stale attempt | **1 response × current form HTML + A**; **0 persistence writes or polls**. |
| Recovery run | **1 read/report × report bytes**, capped at proposed 16 MiB; per candidate **1 receipt read × small identity row + 1 submission read × J**; matched missing result **1 conditional write × J plus errors**. |
| Rendition purge | **1 read/asset × K key records**; existing cleanup job gains **K × key length**. |
| Cleanup attempt | Ownership metadata probes per key; **≤1 DELETE/key × key length**, then job/metadata settlement. No file downloads. Existing retries determine repeat frequency. |
| Orphan maintenance | **ceil(candidates/100) batches × ≤100M**, plus scoped submission/reference reads. Content checking costs **P per batch**, using paged reads, including Trash. |
| Proven orphan | At most two privacy metadata writes, existing Trash/purge writes and one cleanup job. Ambiguous candidate: **0 destructive writes**. |
| Cloudflare publication | Existing publication reads the changed modules/manifest once and uploads their bytes. **No new D1 lookup, table or recurring poll.** |

**Cloudflare release:** republish affected built-in forms pages and their Worker receiver/manifest together, including `receiver.mjs`, `portable-validation.mjs` and `forms-manifest.mjs`. Keep the existing D1 ID, receiver URL, secret and pending-answer routes. Local recovery/attachment cleanup needs a Tovu runtime release, not Cloudflare republishing.

**Will not do:** redo labels, consent capture, schema hashes, disk admission or Formspree; move the entire import pipeline; add vendors, tables, quotas, schedulers, filename-based recovery or fabricated history. Core stays vendor-free; plugins do not import one another. Agent plugins remain `@jini-ai/agent-plugins/<id>`. Maintenance failures explain the problem and allow boot to continue.

**Effort:** **21–31 focused Codex hours**, including focused tests and release checks; historical recovery volume remains **UNVERIFIED**.

**Owner-only question:** Which sites still have original pull reports and authoritative pre-purge attachment records/backups, and where are those retained?