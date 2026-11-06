Codex(Review Mode): Loaded both requested skills. Goal: finish forms privacy and reliability with small patches to the existing system.

Checked local `origin/cloud/combine`: Tovu `5358aa594`, Jini `b0cc1371b`. Nothing changed; no tests, builds, installs or servers ran. Deployed behavior is **UNVERIFIED**.

Paths below use:
- **T** = `prov2-tovu/apps/website/src/`
- **J** = `prov2-jini/packages/cms/src/forms/`
- **A** = `prov2-jini/packages/admin/src/`
- **C** = `prov2-jini/packages/agent-plugins/cloudflare/`
- **G** = `prov2-jini/packages/agent-plugins/google-workspace/form-destinations/`

The audit contains **12 High findings, one additional Medium/Required finding, and seven recommendations**.

| Finding | Current status and evidence |
|---|---|
| Public attachments | **PARTLY.** New uploads request private access; public routes deny it: `T/features/forms/form-file-storage.ts:28`, `T/server/inbound/public-http/routes/site/media-rendition.ts:449`. Older orphan files need trustworthy ownership evidence; their presence is **UNVERIFIED**. Leave that work with `forms-left`. |
| Purge leaves attachments | **PARTLY.** Cleanup hooks now exist: `T/features/forms/form-file-purge.ts:16`, `J/attachment-cleanup.ts:34`. Exact rendition cleanup and orphan reconciliation belong to `forms-left`. |
| Production notifications disabled | **FIXED.** Forms readiness is enabled and recipient jobs are wired: `T/features/forms/mail-outbox-readiness.ts:2`, `T/server/runtime/composition/modules/forms.ts:72`. |
| Notification failures swallowed | **FIXED for durable Tovu delivery.** Planning errors propagate; recipient failures become retry/status errors: `J/notify-subscriber.ts:87,106,158`. Legacy hosts without an outbox still log failures intentionally. |
| Static validation differs | **FIXED.** Enriched rules use the shared validator: `T/features/forms/form-destination-manifest.ts:67`, `C/worker/forms-receiver.mjs:164`. |
| Publishing unsupported uploads | **FIXED.** File fields refuse publication: `C/lib/forms.mjs:105`. |
| Remote answers/IP retained after collection | **FIXED in source.** Ack deletes answers; new rows store no raw IP; publish preparation clears old acknowledged rows/IPs: `C/worker/forms-receiver.mjs:89,308`, `C/lib/forms.mjs:201`. Uncollected answers deliberately remain. |
| Invalid imports lose classification | **FIXED.** Invalid status/errors persist and delivery is withheld: `T/features/forms/import-remote-submissions.ts:146`. |
| Historical meaning changes | **FIXED for captured submissions.** Schema/consent evidence persists and detail formatting uses it: `J/submission-evidence.ts:36`, `A/forms/html-rules.ts:104`. Original evidence for older rows cannot be recovered. |
| Download forms leak answers through GET | **FIXED.** Forms and submit overrides use `dialog`: `T/features/site-export/export-html-policy.ts:143,197`. |
| HTML transfer/duplication loses markup | **FIXED.** Transfer includes mode/HTML; recipients stay local; duplication preserves markup: `T/features/forms/publish-content.ts:42`, `T/features/forms/tool-registrations.ts:575`. |
| Admission too late/no aggregate budget | **PARTLY.** Admission precedes parsing, with source and multipart budgets: `T/server/inbound/public-http/routes/site/forms-submit.ts:58`, `forms-admission.ts:11`. These are process-local; the approved disk guard is approximate. A shared remote-storage quota is absent. |
| Repository decorator fabricates fields | **OPEN, recommended cleanup.** `J/html/authoring-adapter.ts:57` still returns `fields: []`. |
| Every receiver requires pull/ack | **PARTLY.** Still true in `T/features/form-destinations/registry.ts:92`. However, direct POST/embed collection now has its own Jini contract: `J/provider.ts:10`. No registry rewrite is needed for Formspree. |
| Generic ownership split | **OPEN, architectural recommendation.** Import orchestration remains in Tovu: `T/server/runtime/composition/form-submissions.ts:149`. |
| Delivery copies answers per destination | **OPEN — privacy.** Each child stores the snapshot: `J/delivery/planner.ts:54`. SQL confirms the answers live in outbox payloads: `T/platform/db/repos/form-delivery-repo.ts:25`. |
| Inconsistent duplicate prevention | **OPEN — reliability.** Tokenless identical answers behind one IP can collapse; memory state expires; Cloudflare assigns random IDs: `J/submission-attempts.ts:102`, `C/worker/forms-receiver.mjs:89`. |
| Sheets scans/discarded outcomes | **OPEN, recommended optimization.** Up to ten bounded scans; successful references are discarded: `G/dedupe.mjs:17,38`, `J/delivery/deliver-job.ts:12`. |
| Duplicate Builder DOM IDs | **OPEN — Required.** Constant prefix remains: `T/server/inbound/public-http/http/site/render.ts:2421`, `J/html-render.ts:65`. |
| Public contracts incomplete | **OPEN.** Admin answer types omit numbers/arrays/files; tool views omit mode/HTML: `A/core/ports/forms.ts:128`, `A/forms/models.ts:7`, `T/features/forms/tool-registrations.ts:147`. |

The remaining **answer-retention privacy work** is delivery snapshots and legacy attachment residue. File residue stays with `forms-left`; this plan does not duplicate its cleanup or stale-form work.

1. **Stop storing answers in new delivery jobs; compact old copies explicitly.**

   Exact production files:

   - `J/delivery/{types.ts,planner.ts,deliver-job.ts,subscriptions.ts,index.ts}`
   - New `J/delivery/compact-legacy.ts`
   - `T/platform/db/repos/form-delivery-repo.ts`
   - `T/server/runtime/composition/form-delivery.ts`
   - New `prov2-tovu/scripts/forms-delivery-maintenance.ts`

   Keep frozen binding/form metadata, job IDs, idempotency keys, retries and existing tables. Store a submission reference; Jini hydrates answers through an injected read port. Tovu binds that port. Missing/purged sources must stop delivery.

   Keep a legacy reader. An explicit, preview-first maintenance command processes at most 100 old jobs per invocation, skips processing jobs, and preserves pending payloads whose equivalence cannot be established.

   Roughly **+280/−60 production lines; +170 test lines**. Extend Jini’s delivery `planner`, `deliver-job` and `subscriptions` unit tests; add `compact-legacy.unit.test.ts`; extend Tovu’s `form-delivery.test.ts` and `form-delivery-repo.dialects.test.ts`.

   **Cannot be smaller:** clearing only completed jobs leaves per-destination copies; changing payloads without legacy compatibility risks queued deliveries.

2. **Prevent tokenless requests from silently losing legitimate submissions.**

   Exact files: `J/submit-service.ts`, `J/submission-attempts.ts`, `J/__tests__/submit-service.host-options.test.ts`, `J/__tests__/submission-attempts.test.ts`.

   Use attempt deduplication only with a usable explicit token. Tokenless callers remain valid, including agent CLIs. Keep existing token retry behavior.

   Roughly **+15/−10 production lines; +45 test lines**. Test identical tokenless submissions behind one IP, token retries, malformed tokens and failed-first-attempt recovery.

   **Cannot be smaller:** changing the timeout preserves false duplicate matches. Durable cross-process deduplication remains a separate contract decision.

3. **Give each Builder placement distinct control IDs.**

   Exact files: `J/html-render.ts`, `T/server/inbound/public-http/http/site/render.ts`, `J/__tests__/html-render.test.ts`, `T/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts`.

   Reuse the existing `idPrefix` mechanism. Tovu supplies placement/occurrence identity; Jini applies it consistently to controls, labels, help and errors. Slug alone is insufficient when the same form appears twice.

   Roughly **+35/−8 production lines; +60 test lines**. Cover repeated forms across embeds and regions, including external Builder collection.

   **Cannot be smaller:** changing only input IDs breaks their associated labels and accessibility references.

4. **Complete the existing public types and tool projection.**

   Exact files: `A/core/ports/forms.ts`, `A/forms/models.ts`, `T/features/forms/tool-registrations.ts`, `A/forms/__tests__/answer-format.unit.test.ts`, and new `T/features/forms/__tests__/tool-definition-view.unit.test.ts`.

   Reuse Jini’s `FormAnswer`; expose stored mode/HTML through the shared tool handler used by every CLI.

   Roughly **+15/−8 production lines; +35 test lines**.

   **Cannot be smaller:** both admin declarations currently narrow answers independently; correcting just one leaves the mismatch.

Runtime cost, with **S** submissions, **D** destinations, **R** recipients, **A** answer bytes, **E** evidence bytes, **K** frozen metadata and **I** reference bytes:

| Change | Added read/write/poll cost |
|---|---|
| Referenced delivery | **1 × (A + E + row metadata) read per delivery attempt**. Existing job-write count stays unchanged; payload storage falls by approximately **S × D × (A − I)**. |
| Legacy compaction | Per explicit page: **≤100 × old-job bytes**, plus needed source-row reads; **≤100 × replacement-payload bytes written**. No polling or startup scan. |
| Tokenless acceptance | Previously suppressed requests now incur the normal submission pipeline: one answer/evidence write, one source event, recipient/destination jobs and any accepted uploads. No new per-request lookup. |
| IDs/types/projection | **Zero added storage reads, writes or polls.** Rendering changes only output bytes; tool responses additionally carry stored HTML when present. |

**Collisions:** `forms-left` changes Jini `submit-service.ts`/`html-render.ts` and Tovu `render.ts`; apply steps 2–3 after its merge. `consent-declare` also changes Tovu `render.ts`. Available `release-fixes`, `small-fixes`, and Jini `om-chat-3` show no direct overlap with the proposed files. Tovu `om-chat-3` and both `ui-fixes` refs are unavailable locally: **UNVERIFIED**.

**Cloudflare follow-through:** republish affected Workers with `receiver.mjs`, `portable-validation.mjs` and enriched `forms-manifest.mjs` together, using updated publish preparation. Republish static pages for schema/stale-form metadata and the placement-ID fix. Preserve D1 identity, receiver URL, secret and pending pull/ack access. Runtime delivery changes alone do not require a Worker republish.

I would **not** rewrite orchestration, remove delivery tables, add `storage_allocations`, add schedules, move import orchestration, redesign receiver capabilities, optimize Sheets, or change uncollected-answer retention. No schema change is planned; any subsequently necessary schema change must use ADR-066 TypeScript migrations. Existing complexity ceilings remain binding.

**Effort:** approximately **10–14 Codex hours**, including focused tests, typechecks and boundary checks during implementation; excluding release operations.

**Owner-only question:** is a shared storage quota across remote stores or multiple writers actually required beyond the approved process budget and local disk floor? That decision is needed before expanding the partly resolved admission finding.