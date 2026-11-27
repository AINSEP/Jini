# w3b-ext-w1 Jini working-tree handoff

No tests, builds, installs, typechecks or linters may run in this dispatch. No git mutations. Coordinator commits; Opus executes tests, checks mutations and regenerates declaration baselines.

## Completed implementation units (coordinator commit order; Opus verification pending)

1. J19 — media import execution and shared ingress ports (implementation written, unverified).
   - Files: packages/core/src/contracts/site/media-tool-ports.ts; packages/cms/src/media/site-import/tool-registrations.ts; packages/cms/src/media/site-import/__tests__/{tool-registrations,caller-safe-refusal}.test.ts; packages/{core,cms}/package.json; .changeset/website-media-import-ports.md.
   - Exact core/CMS exports and universal/node entries added. No new dependency or catalog copy. Injected adapted authorization and G-W1 key refusal; host egress/path classes remain outside CMS. Replacement target/source and optional editorial projection split as required.
   - Tests authored before production code.
   - Tests: permission denial touches neither source nor storage (`fetch-before-authorize`); redirect-final source and sniffed type are recorded (`persist-request-url`); replace capability refusal precedes source access (`read-before-cas-capability`); abort after acquiring bytes leaves storage untouched (`drop-import-abort-fence`); storage content-type refusal cannot become success (`ignore-content-type-write`).
   - caller-safe-refusal.test.ts: only the safe error reaches schema decoration; ordinary transport errors keep their identity (`throw-original-refusal`).

2. J20 — asset destination preparation and writes (implementation written, unverified).
   - Files: packages/core/src/contracts/site/asset-transfer-tool-ports.ts; packages/cms/src/asset-transfer/asset-destinations.ts; packages/cms/src/asset-transfer/__tests__/asset-destinations.test.ts; packages/{core,cms}/package.json; .changeset/website-asset-destinations.md.
   - Exact core/CMS exports and universal/node entries added. Core data remains Uint8Array-generic; CMS writers specialize Buffer. Preparation keeps one host-prepared batch, case-folded reservations and 1,000 rename probes; writes forward partial failures. No theme/storage/root implementation imported.
   - Four named tests authored before production code.
   - destination permission binds the correct entity (`authorize-picked-as-site`); preparation never writes and preserves the picked-folder batch (`write-during-prepare`); rename observes disk and case-folded in-batch reservations (`ignore-batch-collision`); site execution returns the first failure and remaining paths (`drop-partial-failure`).
   - The partial-failure witness injects the real FS batch writer and checks actual disk effects.

## Stopped / dependent / left

- J21 STOP: G-W1's literal AssetApprovalToolHandler options are only { flag?: string; batch?: boolean }. Source copy-tool.ts:158–170 passes `ask: ({ prepared }) => prepared.batch !== undefined`; host human-confirm.ts:214–243 implements it. Removing ask cards media/Library/theme and empty/skipped calls; retaining it exceeds the mandated structural API. Requires corrected sheet; no invented approval seam.
- J22 LEFT dependent on J21 (also uses `ask` for inspect/non-batch behavior at original tool.ts:85).
- J23 STOP prerequisite: cross-set Y3 requires w2a J10/T10b before J23/T19. This HEAD contains media/site/provider-credential-contracts.ts but no provider-credential-store.ts, provider-credential-vault.ts or provider-credential-store.memory.ts. No generation implementation before that prerequisite.
- T18/T19: Tovu-only, outside Jini dispatch; T18 also depends on stopped J21/J22.
- J24/T20: REJECT duplicate, owned by ext-w2b 72/73; no recovery edits.

## Verification / release pending

No runtime or static verification executed by owner instruction. Opus must regenerate api-baseline/jini-ai__core.json and api-baseline/jini-ai__cms.json from built declarations, rather than inventing signature hashes.

## Diff audit

Re-read all new source/tests and both manifest diffs against the sheets. No existing tests deleted or weakened; no source files deleted. Test count: 0 -> 10 in the three new test files (5 import execution + 1 safe refusal + 4 destinations). Named mutations are authored-for, not executed.

Deleted during self-review: unrelated package.json formatting from an initial serializer pass; temporary inline closures in optional-field construction (replaced with the sheet-required projection helper and conditional spreads). Removed no existing behavior or measured code.

Architecture audit (static reading): PASS for implemented J19/J20 boundaries: core contracts only; CMS imports core, its canonical media owners and node:path; all host I/O and classification injected; no new deps, adapters, catalog, global registration or compatibility forwarding files. Execution proof and generated API baselines remain pending. Why-comments on caller-safe refusal, replacement source checks, title construction, content-type persistence, collision reservation, per-destination validation and sequential writes preserved. Host-only conversion/HTTP policy comments stay with the host source until T18.

Function-quality reading: J19 permission/refusal/persistence/replacement/projection units and J20 permission/collision/preparation/execution units are scoped to the named seams; no known additional abstraction or fallback introduced. No complexity tool was run; source line counts were read. Named tests directly witness permission/order/abort/refusal/collision/partial-failure properties; no coverage percentage claimed.

## Tovu integration requirements

New core subpaths:
- @jini-ai/core/contracts/site/media-tool-ports
- @jini-ai/core/contracts/site/asset-transfer-tool-ports

New CMS subpaths:
- @jini-ai/cms/media/site-import/tool-registrations
- @jini-ai/cms/asset-transfer/asset-destinations

T18 must provide the real guarded ingress, classifier/logger, adapted authorization, G-W1 refuseUnexpectedKeys, converting import uploader and nonconverting asset persistence, replacement CAS capability check, shared FS/theme/Library writers and public-URL binding. No Tovu source has been modified/deleted. Complete the J21 approval-type correction and J21/J22 before T18's single cutover. Complete w2a J10/T10b before J23/T19. J24/T20 pins belong to ext-w2b 72/73.

## Pre-completion / self-validation

Requirements re-read; working-tree status/manifests/source manually inspected. No execution, mutation run, build, install, lint, typecheck, commit or push performed. Self-validation not run because the dispatch explicitly forbids verification commands. All changes remain reviewable in the working tree. COMMIT-PLAN.md is coordinator scratch, must not be committed.


## Function-quality handoff

| Units | Disposition from source reading | Findings / evidence limits | Local action |
| --- | --- | --- | --- |
| Import permission, schema classification and caller-safe wrapper | NO_RECORDED_FINDINGS | Permission/refusal tests authored; not run | Preserved handler-specific classifier scope and safe-error identity |
| Import persistence and editorial projection | NO_RECORDED_FINDINGS | Sniff/type-store and redirect pins authored; not run | Removed temporary inline closures; conditional omission retains field order |
| Replacement target/source and handlers | NO_RECORDED_FINDINGS | Capability-before-source and all-handler abort pins authored; not run | Required target/source split; signal reaches replacement |
| Destination validation, collision and preparation | NO_RECORDED_FINDINGS | Scope, batch and case-folded reservation pins authored; not run | Required explicit kind predicate; omitted absent batch/themeId |
| Destination execution | NO_RECORDED_FINDINGS | Real writer partial-failure pin authored; not run | Preserved sequential owners and unmodified prepared writes |

Zero-findings skepticism reading: checked host-only dependencies were not imported, ordinary faults were not widened to validation, field names describe their computed values, rename reservations include in-batch case folding, and absent optional properties are omitted. This is source inspection, not a claim that compilation, metrics, mutations or runtime behavior passed. Existing why-comments move; new contracts carry no filler comments. No extra cases beyond the sheets were added.
