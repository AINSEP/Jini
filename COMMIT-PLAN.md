# w3b-ext-w1 — Jini rerun

Working tree only; no git writes, tests, builds, installs, typechecks or linters.
Source anchors: Tovu c0f1068a59, checked via git show. J19/J20 already built; skipped.
Scope: J21 -> J22 -> J23. J24/T20 rejected duplicates of w2b 72/73. T18/T19 belong to Tovu.

## Planned commits (coordinator commits)

1. J21 — website files copy: tests first, then copy-tool.ts, CMS export/entry, minor changeset, CMS baseline surface.
   Extend AssetApprovalToolHandler with existing optional ask({ prepared }) predicate (owner override).
   Mutations: read-before-destination-check; accept-truncated-glob; save-documents-during-preflight; skip-site-approval.
2. J22 — website image transform: tests first, then tool.ts, README wiring, CMS export/entry, minor changeset, CMS baseline surface.
   Mutations: prepare-destination-on-inspect; render-again-after-confirm; skip-picked-approval.
3. J23 — website media generation: tests first, then generation contracts, registrar, CMS export/entry, core+CMS minor changeset, baseline surfaces.
   Mutations: env-after-saved-open-error; validate-against-builtins; drop-post-dispatch-abort; credit-stub-as-real.

## Constraints / pre-code gates

Use existing J19 storage, J20 destinations, CMS image-ops/catalog/analytics/sniff/preview, core branded approval lifecycle.
CMS runtime imports only core, same-package code, and node:path. No host, integrations, archive SDK or platform runtime imports.
Inject key refusal and structural approval handler; keep approval ask conditional, destination authorization before reads, full preflight before effects.
Keep native bounded listing/glob and copy byte/count caps. Generation credential scan is catalog bounded and sequential, fresh at execution.
Test seams: injected source/storage/generation/approval ports. Adversarial cases: truncated listing, refused second document, post-click byte identity, late canceled generation.
The source statement order and existing why-comments govern the moves. Owner's exact sheets override skill advice to redesign, add comments, run checks, or seek another style approval.

## Validation / release

Tests and named mutations will be executed by Opus. Baseline entries are provisional pending Opus declaration regeneration.
No tests are deleted or weakened. No unrelated edits or production helpers beyond the sheet's moved functions and named splits.

## Final diff review

Pending. Deletions of unrequired additions: none so far.

## Completed units (in commit order)

### 1. J21 — website-files-copy

- Created `packages/cms/src/asset-transfer/__tests__/copy-tool.test.ts` FIRST (0 -> 4 tests).
- Created `packages/cms/src/asset-transfer/copy-tool.ts` with the G-W1 structural approval type including the explicitly authorized optional `ask`.
- Updated `packages/cms/package.json` (exact `./asset-transfer/copy-tool` export and node entry).
- Created `.changeset/website-files-copy.md` (CMS minor).
- Updated `api-baseline/jini-ai__cms.json` (provisional surface, pending Opus regeneration).
- Mutation witnesses: denied destination asserts zero source calls (`read-before-destination-check`); truncated glob asserts zero reads/preparation/writes (`accept-truncated-glob`); second-document rejection asserts zero saves (`save-documents-during-preflight`); the card checks no write before approval and the unchanged prepared bytes after it (`skip-site-approval`).

### 2. J22 — website-image-transform

- Created `packages/cms/src/media/site-transform/__tests__/tool.test.ts` FIRST (0 -> 3 tests).
- Created `packages/cms/src/media/site-transform/tool.ts`; copy/destination imports are type-only, operations reuse the existing image-ops owner.
- Updated `packages/cms/src/media/site-transform/README.md` with theme writer/reload and guarded batch rationale/source locations.
- Updated `packages/cms/package.json` (exact `./media/site-transform/tool` export and node entry).
- Created `.changeset/website-image-transform.md` (CMS minor).
- Updated `api-baseline/jini-ai__cms.json` (provisional surface, pending Opus regeneration).
- Mutation witnesses: inspect asserts no destination-kit calls (`prepare-destination-on-inspect`); site/picked card witnesses exact prepared bytes, one render and one prepare, and object identity at execution (`render-again-after-confirm`); declined picked approval asserts zero writer calls (`skip-picked-approval`).

### 3. J23 — website-media-generation-execution

- Created `packages/cms/src/media/site-generation/__tests__/tool-registrations.test.ts` FIRST (0 -> 4 tests).
- Extended `packages/core/src/contracts/site/media-tool-ports.ts` with the three named generation contracts; existing export/entry reused.
- Created `packages/cms/src/media/site-generation/tool-registrations.ts` using the existing catalog, sniffer, analytics and preview implementations.
- Updated `packages/cms/package.json` (exact `./media/site-generation/tool-registrations` export and node entry).
- Created `.changeset/website-media-generation-execution.md` (core + CMS minor).
- Updated `api-baseline/jini-ai__{core,cms}.json` (provisional surfaces, pending Opus regeneration). The existing media-tool-ports export had no baseline key at HEAD; added its full declaration surface once rather than a duplicate export.
- Mutation witnesses: saved-key open error preserves error identity and forbids env/dispatch for explicit and default model selection (`env-after-saved-open-error`); injected ordered enum accepts its plugin IDs and refuses an excluded built-in before credential reads (`validate-against-builtins`); a pending dispatch resolves only after Stop, then all storage ports remain untouched (`drop-post-dispatch-abort`); stub upload provenance matches only `{ kind: "generated" }` (`credit-stub-as-real`).

## Final review / handoff

- All source anchors matched Tovu `c0f1068a59`; no sheets stopped.
- J19/J20 skipped as requested. J24/T20 LEFT: rejected duplicate, owned by w2b 72/73. T18/T19 LEFT: Tovu-only cutovers.
- No tests, mutations, builds, installs, typechecks or linters executed (explicit dispatch prohibition). No git mutations, commits, pushes or subagents.
- Test count: 0 -> 11 across the three new files. Existing tests unchanged; no deletions or weakened assertions.
- Reread all three new registrars and tests, core contract diff, exports/entries, changesets and baselines. Removed unrequired additions: none. No source files deleted.
- Release baseline hashes intentionally say `pending-opus`, following existing baseline convention. Opus must run the named suites/mutations and regenerate the declaration hashes before release.
- Architecture audit: WARNING / runtime evidence deferred. CMS runtime imports stay within core, same-package canonical owners, and node:path. Required source/codec/archive/approval ports remain injected. No new vendor SDK, server framework, package dependency, private approval store or transport fallback.
- Function-quality assessment: copy catalog/preflight/registration, transform catalog/prepare/registration, generation selection/storage/execution/registration = INCONCLUSIVE for measured complexity/coverage/runtime (checks prohibited). Manual review found no extra behavior or out-of-scope abstractions; source caps and sequential I/O retained. Critical/High findings observed: 0. No claim of mechanical PASS.
- Reuse: copy uses J20 destination functions and native matchesGlob; transform uses canonical image-ops plus injected J20 kit; generation uses canonical catalog/sniff/analytics/preview and J19 storage contract. Reviewed the sheet-named source files and those owners only.
- Documentation: existing why-comments moved with their behavior; no new production comments. README explains relocated theme and guarded-writer wiring.

## Tovu integration needs

T18 imports `@jini-ai/cms/asset-transfer/copy-tool` and `@jini-ai/cms/media/site-transform/tool`, builds the catalogs from ASSET_SOURCE_SCHEMA/current FS permission, binds source/destination/refusal/archive ports, and passes its branded approval handler/describeWriteBatch. `AssetApprovalToolHandler` includes optional `ask({ prepared })`.

T19 imports `@jini-ai/cms/media/site-generation/tool-registrations`; its binder supplies the same live model list for catalog+execution, saved/env credential ports, guarded per-call generation dispatcher and nonconverting storage. Generation contracts are on the existing `@jini-ai/core/contracts/site/media-tool-ports` subpath. Keep issued credential diagnostics intact.
