Software Architect(Direct): Loaded the requested Software Architect persona. **1. Goal:** Ship swappable form providers and close the remaining High findings through small, independently releasable changes.

**2. Findings**

**Recommend targeted replacement of the provider/render seam, retaining Jini’s submission and delivery core.** The 20–30-day estimate includes urgent work already implemented and optional table/orchestration cleanup. Those are not prerequisites for swapping providers.

Read-only inspection covered both `merge-1029` clones. Graph tools were unavailable; evidence below comes from bounded source reads. No files changed or tests, installs, typechecks, project builds or servers ran. **UNVERIFIED:** deployed versions, test results, production data volumes and recoverable historical evidence.

H1–H12 follow the audit’s High-finding order. “Corrected” means corrected in source, awaiting release verification.

| Finding | Current code and disposition |
|---|---|
| **H1: Public attachments** | **Corrected for new files:** uploads request private access; public media rejects private assets. Legacy protection warns and continues boot. Already orphaned files remain unresolved. [storage:28](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/form-file-storage.ts:28), [public gate:449](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/routes/site/media-rendition.ts:449), [legacy protection:17](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/protect-existing-files.ts:17) |
| **H2: Purge leaves attachments** | **Corrected prospectively for originals:** hooks capture references before deletion and schedule cleanup. Derived bytes and pre-fix orphans remain. [purge wiring:1485](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:1485), [cleanup:35](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/attachment-cleanup.ts:35), [rendition-row deletion:884](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/media/media-service.ts:884) |
| **H3: Production email disabled** | **No longer true in source:** forms now pass the durable-mail readiness gate. [readiness wiring:1979](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:1979) |
| **H4: Email failures swallowed** | **No longer true on Tovu’s durable path:** recipient jobs have stable identities; failures propagate to retry/terminal handling. Legacy hosts without an outbox retain inline behavior. [notification jobs:99](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/notify-subscriber.ts:99), [failure propagation:149](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/notify-subscriber.ts:149), [retry selection:23](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/contracts/core/events/outbox-retry-policies.ts:23) |
| **H5: Static validation differs** | **Still partly true.** Email, checkbox and choice checks were added. Cloudflare still advertises number/range/date/phone/URL support while omitting Jini’s corresponding format/bound checks. [receiver checks:179](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/forms-receiver.mjs:179), [advertised types:82](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/lib/forms.mjs:82), [Jini rules:95](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/field-registry.ts:95) |
| **H6: Unusable static uploads** | **Corrected by explicit capability refusal:** publishing rejects file fields before provisioning. Static upload support itself remains unavailable. [publish check:83](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/lib/forms.mjs:83) |
| **H7: Remote PII retained after import** | **Corrected for committed imports:** acknowledgment deletes rows; new rows store no raw IP; republishing scrubs legacy acknowledged rows/IPs. Unpulled answers still remain until imported. [receiver insert:84](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/forms-receiver.mjs:84), [ack:282](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/forms-receiver.mjs:282), [legacy cleanup:146](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/lib/forms.mjs:146) |
| **H8: Invalid-import errors disappear** | **Corrected for new imports:** classification/errors persist outside answers and appear in admin. Previously discarded errors remain unknown. [import:143](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/import-remote-submissions.ts:143), [admin display:59](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/forms/react/components/FormSubmissionDetail.tsx:59) |
| **H9: Historical schema/consent changes meaning** | **Still true:** submissions have validation metadata but no captured schema or consent context; display derives labels/options from supplied current descriptors. [submission contract:69](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/types.ts:69), [answer columns:16](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/forms/html-rules.ts:16) |
| **H10: Download forms leak through GET** | **No longer true for the identified native-submit path:** backend-dependent forms use `method="dialog"`, including associated controls’ method overrides. The handoff’s “non-form containers” description is stale. [export policy:137](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-export/export-html-policy.ts:137) |
| **H11: HTML transfer/duplication loses markup** | **Duplication corrected; transfer/hash still broken.** Duplication passes mode/HTML; the publish contributor omits both, including from its transferred-field projection. It still transfers notification recipients. [duplicate:570](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/tool-registrations.ts:570), [transfer:33](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/publish-content.ts:33) |
| **H12: Late admission/unbounded storage** | **Partly corrected:** admission precedes route body parsing; multipart has a site/process budget. Durable storage reservations and a lifetime byte cap remain absent. [route:58](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/routes/site/forms-submit.ts:58), [limits:6](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/routes/site/forms-admission.ts:6) |

Reuse checked: Jini’s keyed provider registry, trusted plugin contribution loader, authoring JSON envelope, submission JSON envelope, transactional import receipts, pull leases, shared outbox, Trash hooks, blob ownership and object-store metadata operations. None requires a new framework. [registry:43](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/provider-registry.ts:43), [loader:45](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/src/lifecycle/contribution-loader.ts:45), [definition encoding:6](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/fields-json.ts:6), [submission decoding:7](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submission-json.ts:7)

**3. One ordered plan**

Line estimates below separate production changes from tests and exclude generated/package output. Each step ships alone; no step waits for optional cleanup.

1. **Release the urgent corrections — 4–6 hours.**
   Files: existing urgent forms/media changes, package manifests/lockfile, bundled-plugin selection/distribution.
   Verify the supplied regression tests first; reproduce any uncovered bug with a failing test before fixing it. Publish changed Jini packages and consume those versions in Tovu: its manifests currently use npm ranges, so editing the sibling clone alone does not deliver the fixes. [dependencies:137](/Users/la/Programming/tovu-integration-clones/prov2-tovu/package.json:137)
   Ship website/admin and applicable desktop artifacts. **Republish every forms-enabled Cloudflare Worker now**, carrying the receiver, enriched manifest and legacy D1 cleanup; retain database, receiver URL and secret.
   Production **+0–80/−0–30 lines**; tests **+0–100**, extending existing retry, privacy, purge, import and export cases. Deployment success remains a release check.

2. **Close static validation and HTML-transfer gaps — 6–10 hours.**
   Files: Jini `forms/field-registry.ts` and a small portable validation entrypoint; Cloudflare `worker/forms-receiver.mjs`, `lib/forms.mjs`; Tovu `form-destination-manifest.ts`, `publish-content.ts`.
   Ship the existing validation owner into the receiver; pass necessary bounds/options and normalize remote answers consistently. Continue explicitly refusing files and any rule the receiver cannot enforce.
   Carry mode/HTML through transfer and hashing. Keep notification recipients local by default, with a visible transfer preview.
   Production **+180–320/−100–200**; tests **+200–350**: forged numeric/date/phone/URL values, Unicode lengths, optional checkboxes, HTML-only hash changes and transfer round trips.
   **Republish Cloudflare receiver + manifest; republish affected pages after transferred markup changes.**

3. **Preserve evidence and identify unknown history — 8–12 hours.**
   Files: Jini `forms/{types,submission-json,submit-service,sql/repo.rows}.ts`, new `submission-evidence.ts`, admin forms contracts/detail; move touched generic import orchestration from Tovu into Jini, leaving dependency wiring.
   Extend the existing submission envelope with immutable descriptors, option labels, exact form-owned consent wording, schema hash, capture time and provenance. Use captured descriptors for historical detail/export and delivery formatting.
   Render a schema hash; detect stale browser forms before acceptance, preserve safe answers and explain the changed form. Static receivers capture their published schema; later imports retain that evidence rather than relabeling against today’s definition.
   Old rows say **“original schema/consent unavailable”** and **“validation unknown”** where appropriate. Recover original errors only from retained reports matched to receipt identities; a current-schema recheck is a separate result.
   Production **+300–500/−100–180**, plus **~200–300 moved lines**; tests **+250–400**: edited consent/options, stale pages, old JSON formats, delayed imports and unknown-history display.
   **Republish Cloudflare receiver, manifest and affected HTML together.** No new evidence table is needed.

4. **Bound storage and finish attachment cleanup — 16–24 hours.**
   Files: new Jini CMS media allocation/reconciliation modules and SQL adapter; existing attachment cleanup/media purge; Tovu migration/types and composition wiring.
   Add one durable `storage_allocations` table for byte reservations, stored objects and recovery state. This DDL is justified: current blob records lack byte counts and in-flight reservations. Use an **ADR-066 ordered TS migration**, not a second migration system. [blob schema:1580](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/schema.sqlite.ts:1580), [ADR-066:36](/Users/la/Programming/tovu-integration-clones/prov2-tovu/ADS-memory/reports/architecture/ADR-066-kysely-query-layer.md:36)
   Reserve before writing, serialize admission by workspace, count deduplicated bytes once, retain charges through Trash/grace, and release only after confirmed physical deletion. Recover interrupted reservations automatically.
   Capture rendition keys before deleting their records; journal byte cleanup through the existing outbox. Run resumable, bounded legacy inventory in background work. Proven form orphans become private and enter normal cleanup; ambiguous objects remain protected pending an in-app review—never guessed from filenames.
   Boot warns and continues. Unknown/full storage blocks only new affected uploads with a specific explanation and preserved answers.
   Production **+450–700/−80–160**; tests **+350–550**: concurrent reservations, crashes, shared bytes, failed deletion, parent purge, restart recovery and ambiguous legacy files.
   **No Cloudflare republish for local attachment accounting.** Remote pending-answer quotas are separately disclosed below.

5. **Ship provider swapping: built-in + Formspree — 12–18 hours.**
   Files: new Jini `forms/{provider,builtin-provider}.ts`; existing fields codec/write service/widget resolver/HTML renderer/admin forms controls; Formspree runtime and agent-plugin subpaths; Tovu render/composition, tools, receiver-manifest filtering and bundle catalog.
   One small collection contract returns a native POST plan or embed plan, capabilities and typed setup errors. Keep receive/import and outbound delivery separate; do not require every collection provider to implement pull/ack.
   Reuse the keyed registry and trusted loader. Vendor runtime belongs in `@jini-ai/provider-plugins/formspree`; agent setup/tools belong in **`@jini-ai/agent-plugins/formspree`**. Plugins never import each other.
   Persist public provider selection/config in the existing definition envelope; absent selection means built-in. Extend readers first, preserve metadata on every write, and prevent an older writer from silently resetting selection. No provider column/backfill is necessary.
   Feed one plan into live rendering, ZIP export and static publication. Preserve native definitions/history when switching. Exclude external forms from built-in manifests and action rewriting; Formspree receives the exact POST URL. Its documented native endpoint supports this approach. [Formspree documentation](https://formspree.io/html/)
   Setup uses existing cards and authorized tools. Show where answers live and which validation/spam guarantees apply. Missing plugins warn without refusing boot; affected forms show a specific unavailable state.
   Production **+400–650/−100–200**; tests **+300–450**: two independent providers, switching back, HTML/Builder parity, unsafe configuration, inactive plugins, secret-free exports and unchanged frozen jobs.
   **Republish every static page containing a switched form.** For Cloudflare, update its built-in manifest/routes too; retain old receiver storage until pending imports finish.

6. **CUT-CANDIDATE: Google Forms embed — 3–5 additional hours.**
   Add its isolated provider/agent-plugin contributions using step 5’s embed plan, existing consent handling and scoped CSP permissions. Google documents website embedding. [Google documentation](https://support.google.com/docs/answer/2839588?hl=en)
   Production **+80–140/−0–20**; tests **+80–140** for URL validation, consent loading, inaccessible-form messaging and export parity. Republish affected pages.
   This adds another choice; built-in ↔ Formspree already proves real swapping.

Across implementation: generic behavior stays in Jini; Tovu supplies CMS/site bindings. Exported factories/functions use `(requiredObj, optionalObj)`. Maintain complexity ≤10, ≤9 in desktop. Use existing structured diagnostics without answers/secrets. Preserve routes, receipts, IDs, leases, job identities and retry schedules.

**4. Added I/O cost**

Variables: `S` answer bytes; `E` evidence bytes; `D` definition bytes; `F` files; `N` submissions; `R` recipients; `A` allocation rows; `M/P` media/post metadata bytes. Sizes below are proposed bounds or payload variables, not measurements.

| Trigger/frequency | Reads/writes/polls × payload |
|---|---|
| Provider setup/change | Existing definition read/write gains ≤2 KiB public config; existing audit/invalidation effects remain. Plugin load adds one small descriptor/module read per selected contribution per registry refresh. Rendering adds **zero vendor API reads**. |
| Collection | Formspree: **1 POST/submission × S**, directly from browser. Google: **1 embed load/display × vendor assets**, then vendor submission traffic; actual asset bytes **UNVERIFIED**. |
| Evidence capture/display | Existing submission write gains `E`; existing definition/manifest rendering carries evidence/hash. Detail reads gain `E`; list responses should return summary metadata only. Bound serialized evidence at 1 MiB; never silently truncate. |
| Remote import | Existing pull remains ≤10 pages ×50 rows; add a 1 MiB page-byte ceiling and adapt row count for evidence. Existing receipt/submission/event transaction gains `E` per imported row; ack sends IDs only. Existing startup/sign-in/manual triggers remain; **no new poll**. [pull bounds:9](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/form-destinations/pull.ts:9) |
| Notification | Per notification-enabled submission: `R` reference jobs × roughly ≤0.5 KiB. Per recipient attempt: **2 reads × `(D + S + E)`**, one existing mail request and outbox settlement. Existing retries govern frequency. |
| Legacy privacy upgrade | Once/site: `ceil(N/100)+1` reads × up to100 submission JSON records; per referenced file, one media read and up to two metadata writes. Later owner boots read only the completion marker. |
| Purge/cleanup | Per purge: paged submission references, existing media/post snapshot reads ×`M+P`, and `F` reference cleanup jobs. Per cleanup attempt: ownership/blob metadata probes, ≤1 object DELETE per captured key, metadata/allocation settlement; **zero file downloads**. |
| Storage admission | Per file attempt: workspace lock, **1 indexed SUM/COUNT over `A` allocation rows** returning two scalars, one reservation write and one settlement write, each ≤0.5 KiB. This is O(`A`) DB work; cap object count as well as bytes. |
| Reconciliation/recovery | Startup or existing outbox continuation: ≤100 metadata records/batch, ≤1 HEAD/stat per unknown object, ≤0.5 KiB state/job writes per object; no payload reads or independent timer. |
| Cloudflare upgrade | Per forms-enabled republish: existing provisioning plus **3 legacy-cleanup SQL statements**; affected-row writes vary with legacy data. New ack replaces UPDATE with DELETE; raw-IP payload shrinks. No new recurring remote scan. |

**5. What this plan will NOT do**

- **CUT-CANDIDATES:** three-table redesign, removing delivery-plan/job tables, merging notification configuration into delivery bindings, repository-decorator cleanup, durable dedupe redesign and Sheets scan optimization.
- **CUT-CANDIDATES:** Google embed, additional vendors, vendor-form creation, submission synchronization, webhooks and a new scheduler.
- No static file-upload receiver, universal vendor schema conversion, fabricated historical consent, automatic deletion of ambiguous editorial files, or replay of completed deliveries.
- No promise that changing a local setting changes an already published site.
- Pending remote answers receive no new automatic expiry in this minimum. Their storage policy must be visible; imported copies are deleted immediately.

**6. Effort and dependencies**

**Minimum complete scope: 46–70 focused Codex hours; budget 56–86 with integration contingency.** This includes test work and release verification, excludes owner review/vendor-account waiting and unknowable historical recovery.

Steps ship in the listed order. Step 3’s codecs must precede evidence writers; step 4’s migration precedes quota enforcement; step 5’s readers/render plan precede provider activation. Verification failures can expand the estimate.

The original **160–240 engineer-hour equivalent is not justified as the minimum**: it combines completed urgent work with a broader persistence/orchestration migration. Conversely, provider swapping alone does not close the evidence and storage High findings.

**7. Owner questions**

- **How much attachment storage should each site receive?** Recommend an initial **1 GiB forms-file budget and 10,000-object cap**, visibly configurable, counting retained bytes until deletion. Existing over-limit sites keep their data and receive automatic cleanup/status guidance.
- **Should uncollected Cloudflare answers ever expire?** Recommend **no automatic expiry initially**, with visible pending counts and a disclosed storage cap. The existing 90-day rule concerns IP addresses, not answers. A timed answer-deletion policy needs a separate explicit decision. [current policy:7](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submission-ip-retention.ts:7)
- **Should copying a form copy the people emailed about submissions?** Recommend **keep recipients local** and show the change in the transfer preview, preventing accidental disclosure to the source site’s recipients.
- **Is Google required for the first release?** Recommend **ship built-in + Formspree first**; add Google afterward if wanted.