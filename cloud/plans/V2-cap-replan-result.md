Software Architect(Direct): Loaded the requested persona. Read-only review completed; no files changed, tests run, or servers contacted.

**1. Goal**

Stop public attachments exhausting local disk with a conservative per-site cap, preserved answers, and no new table.

**2. Findings**

- **A table is unnecessary if we accept a filesystem metadata walk per attachment-bearing submission.** Recommend counting the site’s entire media namespace and gating only public form uploads.
- Submission references already contain `byteSize`, populated from actual input bytes. [types.ts:88](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/types.ts:88), [form-file-storage.ts:35](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/form-file-storage.ts:35)
- **Summing those references is insufficient for disk protection:** bytes are written before submission persistence; cleanup can fail; blob deletion has a grace period. Deleted or failed submissions can leave bytes outside that sum. [submit-service.ts:222](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submit-service.ts:222), [types.ts:118](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/media/types.ts:118)
- Media/blob records lack persisted sizes. Existing `sizeOf`/`head` reads individual object sizes, but `ObjectStore` has no listing operation. These cannot cheaply enumerate unrecorded files. [blob schema:1580](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/schema.sqlite.ts:1580), [object-store.ts:52](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/object-store.ts:52)
- Local keys use `ws/{workspaceId}/blobs/...`; composition already supplies the correct uploads root. Reuse both. [blob-key.ts:25](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/media/blob-key.ts:25), [site-paths.ts:191](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/site-paths.ts:191)
- Existing retry cookies **do not fully preserve answers**: only selected text controls qualify, values truncate at 300 characters, and oversized cookies drop fields. Reuse the existing HTML renderer’s escaped defaults instead. [handler.ts:132](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/express/handler.ts:132), [form-render.ts:694](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/http/site/form-render.ts:694), [html-render.ts:103](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/html-render.ts:103)
- Both clones are on `merge-1029`. Graph tools were unavailable; findings use bounded current-source reads. The clone’s architecture chapters were absent; the original workspace copies were consulted.
- **UNVERIFIED:** deployed file counts, scan latency, concurrent upload count, and exact eventual patch length.

**3. Ordered plan**

Paths below are relative to the indicated clone. **Budget: approximately +150/−4 lines, including tests; a planning estimate, not a measured patch.**

1. **Write failing regression tests first — approximately +45 lines.**
   Extend existing Jini forms/storage and Tovu route fixtures.
   Cover: exact boundary/one byte over; workspace isolation; orphan files counted; missing directory; unreadable storage; multi-file refusal before writes; long text, selections and checkbox preservation.
   Assert refusal creates no media, submission or outbox event, and boot performs no capacity scan.
   Tests are proposed here, not executed.

2. **Jini: add one local capacity reader — approximately +40 lines.**
   New `packages/platform/src/fs/storage-capacity.ts`; export through `fs/index.ts`.
   Signature: `readStorageCapacity(requiredObj, optionalObj)`.
   Walk the injected workspace directory using Node filesystem APIs; sum file sizes without reading contents; read available disk space with `statfs`.
   Count everything physically present there, including orphaned and pending-deletion files.
   Handle absent directories automatically; refuse symlinks and propagate other read failures.
   Stop early when the admission threshold is exceeded; bound traversal work and refuse safely if that bound is reached.
   This creates **no inventory artifact, cache, reconciliation job or durable counter**.

3. **Jini: check once before the first file write — approximately +25/−2 lines.**
   Extend `packages/cms/src/forms/{submit-service,errors,index}.ts`.
   Inject a capacity-reader callback and byte limits through `SubmitFormDeps`; keep `(requiredObj, optionalObj)` contracts.
   Inside the existing dedupe-protected persistence callback, total validated incoming file bytes, then require:
   `usedBytes + incomingBytes ≤ cap` and `freeBytes − incomingBytes ≥ workingSpace`.
   Reject the entire attachment batch before `store()` if either condition fails.
   Unknown capacity refuses uploads with a specific message and an existing structured warning containing no answers.
   Existing upload compensation remains the owner of later write failures. [submit-service.ts:215](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/submit-service.ts:215)

4. **Jini: preserve answers on refusal — approximately +25/−2 lines.**
   Extend `packages/cms/src/forms/express/handler.ts`, reusing `renderHtmlForm`.
   For native HTML, return a direct, uncached retry page with validated non-file answers supplied as render-only defaults; avoid the truncating cookie.
   Say: **“This site has no room for another attachment. Your answers are kept below. Your form has not been sent.”**
   JSON receives a specific error code/message and retained non-file answers.
   File controls remain empty and explain that files must be selected again.
   Existing saved submissions remain intact; the rejected request is kept for retry, not recorded as an accepted submission.

5. **Tovu: wire policy and paths — approximately +15 lines.**
   Update `apps/website/src/server/runtime/composition/app.ts`; consume the updated Jini package exports.
   Bind the existing served-site uploads root plus workspace prefix. Recommend **256 MiB cap and 512 MiB working-space floor**.
   Owner media and renditions count toward this conservative allowance; only public attachment admission is gated.
   Use the effective storage selection already exposed by composition. A remote store without a capacity reader refuses attachments with an explicit storage-unavailable message; boot and text-only forms continue. [media-store.ts:92](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/object-storage/media-store.ts:92)
   Keep changed functions at complexity ≤10. No migration or startup validation.

**4. Cost per upload**

Let `N` be files inspected, `D` directories inspected, `B` incoming attachment bytes, and `S` retained non-file answer bytes.

| Added operation | Frequency × payload |
|---|---|
| Directory enumeration | Once per validated, nonduplicate attachment-bearing submission × directory-entry names for up to the traversal bound |
| File metadata | Up to `N` size reads plus directory safety checks × metadata only; **zero existing file-content bytes** |
| Free-space probe | One `statfs`, plus ancestor probes if the directory is absent × filesystem statistics |
| Effective storage selection | At most one existing setting lookup per check when selection is setting-driven × provider ID |
| Refusal response | One response × `S` plus rendered controls/message; already bounded request input |
| Capacity writes/polls | **Zero database writes, filesystem writes, network storage requests or new polls** |

Accepted uploads retain existing hashing/storage cost of **O(B)**; added admission work is **O(N + D)**. Actual metadata payload sizes and latency are **UNVERIFIED**.

Concurrent admissions can overshoot by roughly the bytes still being uploaded: under `12 MiB × concurrent requests` at this HTTP boundary. This is deliberately approximate, not a reserved global disk guarantee. [forms-submit.ts:58](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/routes/site/forms-submit.ts:58)

**5. What this will NOT do; CUT-CANDIDATES**

- No allocation table, reservations, reconciliation, legacy cleanup, orphan classification or ambiguous-file review.
- No exact attachment-only accounting: the conservative allowance includes other site media.
- No hard coordination across processes, cloud usage accounting, or protection against growth from text submissions and unrelated writers.
- **CUT-CANDIDATES:** quota dashboard, configurable settings UI, cached totals, remote-provider usage adapters, automatic cleanup and quota notifications.
- Exact physical attribution with cheap constant-cost reads would require durable accounting; that larger requirement remains parked.

**6. Effort and dependencies**

**4–6 hours of Codex work:** tests/contracts → capacity reader and admission → retry response → Tovu wiring and focused verification.
Jini package availability precedes Tovu dependency consumption. No database migration or Cloudflare receiver republish is required.
The final diff must confirm the 150-line ceiling; estimated package/version churn is **UNVERIFIED**.

**7. Owner questions**

- **Allowance:** recommend counting all site media toward the public-upload threshold; distinguishing only attachment bytes reintroduces accounting work.
- **Defaults:** recommend 256 MiB per site with 512 MiB disk space left available.
- **“Answers kept”:** recommend a fully populated retry page, with no incomplete accepted submission.
- **Remote storage:** recommend refusing attachments clearly until its usage can be checked, while continuing boot and text-only submissions.