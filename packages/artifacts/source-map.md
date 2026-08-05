# `@jini/artifacts` — provenance

**Package history:** this package did not originate as its own extraction task. It was ported
as `@jini/daemon/src/artifacts/` on 2026-07-18 (full original provenance below, unedited from
`packages/daemon/source-map.md`), then moved out into this standalone package on 2026-07-19
after the swarm-consensus architecture debate found `ArtifactStoreToken` had been declared
alongside `@jini/daemon`'s genuine kernel tokens (`RunLifecycleToken`/`EventLogToken`/
`ToolExecutorToken`/`AgentExecutorToken`) — a real violation of the locked kernel-noun set
(extraction-plan.md §2.1: "NO projects, artifacts, design-systems, brands, marketplace,
conversations in the kernel"). See `src/tokens.ts`'s doc comment and
`ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md` for the finding
and fix. This package is **unlocked/incubating** — see repo-root `UNLOCKED.md` — not part of
the locked 14-package set.

---

## artifacts/ — generic artifact-store kernel port (2026-07-18, original porting record)

Origin: `apps/daemon/src/artifacts/` (6 files) on the real fork clone
`leonaburime-ucla/open-design`, read directly from `/tmp/od-source` for this
task. Per `ADS-memory/reports/jini-port/recon/r1-daemon.md` TASK 1's MIXED-classification
entry for `artifacts/`: "the artifact store concept is a generic engine
port, but OD's artifact = HTML prototype / design output. Extract the store
interface; keep OD's file-kind classification as adapter."

**Original home decision: `@jini/daemon`, not `@jini/core`** (superseded 2026-07-19 — see
above). Both packages' existing scope was checked first per the task brief. `@jini/core` (per
`ADS-memory/reports/jini-port/extraction-plan.md` §3) owns `ProviderRegistry`/
`ToolRegistry`/DI tokens+resolver/`Principal`/`Authorizer` — pure
registries and composition machinery, not stateful storage. `@jini/daemon`
already owned `RunLifecycle` + the durable `EventLog` kernel port
(extraction-plan §12 C1) via the exact async-port-plus-in-memory-reference-
implementation shape (`event-log.ts` / `createInMemoryEventLog`) this task
needed to mirror for `ArtifactStore` / `createInMemoryArtifactStore`. The
extraction-plan's own §10 roadmap-appendix text also describes artifacts as
tied to runs producing output — kernel-adjacent, matching `@jini/daemon`'s
existing charter at the time. `ArtifactStoreToken` was added to `src/tokens.ts`
alongside `RunLifecycleToken`/`EventLogToken`, same pattern — this is exactly
the placement the 2026-07-19 debate found to be a kernel-noun-set violation.

**No duplicate primitive.** `@jini/agent-runtime` already has an
`ArtifactTaxonomy` (`isArtifact`/`classify` — a pure path-classification
predicate, ported from OD's `runtimes/run-artifacts.ts` in an earlier task)
whose own doc comment explicitly deferred `ArtifactStore` (actual
create/read/manifest persistence) as "a later storage/sqlite task's
concern" — confirmed by reading that file before starting this one. This
task's `ArtifactStore` is exactly that deferred follow-up, a different
concern (storage, not classification) in a different package — not a
duplicate of `ArtifactTaxonomy`.

### File map

| Jini file | OD origin file(s) | Transform |
|---|---|---|
| `artifacts/manifest.ts` | `artifacts/manifest.ts` | De-branded: `ALLOWED_KINDS`/`ALLOWED_RENDERERS`/`ALLOWED_EXPORTS` (including a literal `'design-system'` kind — OD's own product concept) were hardcoded module constants; now a caller-supplied `ArtifactManifestTaxonomy`. `status` (`'streaming'\|'complete'\|'error'`) kept as a fixed literal union — a generic artifact-lifecycle concept, not a product taxonomy. `sourceSkillId`/`designSystemId` fields collapsed into one generic `sourceContextId` (opaque to the engine). Two coverage-driven refactors (Phase 6.5 category 4): the redundant `typeof manifest.kind/renderer !== 'string'` re-checks after `validateBoundedString` already returned for any non-string value, and the `typeof JSON.stringify(...) !== 'string'` check (always a string for a plain-object argument) — all three replaced with type assertions + comments. `inferLegacyManifest` (OD's HTML/deck/markdown/svg extension-based inference) is **not ported** — see `ManifestInferrer` below. |
| `artifacts/store.ts` | `artifacts/create.ts` | Not a lift: the origin's `createProjectArtifactFile` took OD's own product-shaped workspace/file-tree writer as an injected dependency, and a companion `postCreateArtifactRequest` built a request body for OD's own per-workspace HTTP upload route — neither is a generic engine concern. Defines `ArtifactStore` (create/get/list) + `createInMemoryArtifactStore` reference implementation directly, mirroring `event-log.ts`'s `EventLog`/`createInMemoryEventLog` shape. `resolveArtifactManifest` ports the origin's require-explicit-OR-infer-OR-throw resolution logic (`ArtifactManifestRequiredError`/`ArtifactManifestInvalidError` kept, same codes). `ManifestInferrer` is the injection seam replacing OD's `inferLegacyManifest` call — a no-op default (`noopManifestInferrer` in `manifest.ts`) until a host supplies its own file-kind classification, per the task brief's explicit instruction to keep that OD-owned. |
| `artifacts/publication-guard.ts` | `artifacts/publication-guard.ts` | De-branded: the origin hardcoded `UNRESOLVED_ARTIFACT_PLACEHOLDERS` (5 literal strings lifted from one bundled example template's pitch-deck fill-in-the-blank convention) and `PUBLICATION_GUARDED_ARTIFACT_KINDS = {'html','deck'}`. Both are now a caller-supplied `PublicationGuardConfig` (`guardedKinds` + `blockedPlaceholders`), empty by default (blocks nothing until configured) — the guard *mechanism* is generic, the marker strings were 100% one template's own content. API also folds the kind-gate into `assertArtifactPublicationAllowed` itself (`isPublicationGuardedKind` check now inside the assert) rather than leaving it a separate check the caller must remember to run first, as the origin did — a deliberate port-time design improvement, not a preserved-behavior requirement. |
| `artifacts/runtime-compat.ts` | `artifacts/runtime-compat.ts` | **Not a lift — the seam only.** The origin, `normalizeArtifactRuntimeImports`, is entirely a fix for one specific CDN-bundle bug (rewriting a vanilla Motion UMD `<script>` tag to the `framer-motion` bundle when React-hook usage is detected) that OD's own system prompt steers models toward hitting — pure product/library-specific knowledge, explicitly out of scope per the task brief ("keep OD's specific logic as adapter"). This module defines only the generic `RuntimeCompatNormalizer` hook type + `noopRuntimeCompatNormalizer` default + a `composeRuntimeCompatNormalizers` helper for layering several a host might need; the Motion-CDN fix itself is not ported anywhere. |
| `artifacts/stub-guard.ts` | `artifacts/stub-guard.ts` | De-branded: `STUB_GUARDED_MANIFEST_KINDS = {'html','deck'}` and a literal `.html`/`.htm` sibling-matching extension were hardcoded; `siblingExtensions` is now a caller-supplied config field (`extensionAlternation` builds the regex generically from it). `readArtifactStubGuardConfigFromEnv` read three `OD_ARTIFACT_STUB_GUARD*` env vars; renamed `ARTIFACT_STUB_GUARD*` (no product prefix), same three-var shape/defaults. Two coverage-driven refactors (Phase 6.5): a `candidateIdentifiers.length === 0` guard made dead by the preceding regex-match precondition was removed (the next line's `.some()` on an empty array already produces the same `continue`); a `largest === null` guard after a loop that (given the already-checked non-empty `priors`) always assigns on its first iteration was replaced with a non-null assertion + comment. |
| `artifacts/text-suppression.ts` | `artifacts/text-suppression.ts` | The core (`createTaggedTextSuppressor`) was already fully generic in the origin (open/close regex + predicates as parameters, no product coupling) — ported verbatim. De-branded the origin's two pre-built instances: `createDsmlArtifactTextSuppressor` hardcoded OD's own "DSML" two-word tag-family (`<\|DSML artifact>...<\|/DSML\|>`); replaced with `createXmlTagTextSuppressor(tagNames)`, a generic factory over a caller-supplied tag-name list supporting both `<tagName>...</tagName>` and a `<\|tagName>...<\|/tagName\|>` bracket-pipe variant (a different, simpler bracket-pipe convention than OD's own two-word "DSML tagname" form, which doesn't generalize to arbitrary tag names). `createToolCallTextSuppressor` (`<tool_call>`/`<edit>` blocks) is a generic agent-protocol convention, not OD-branded, and is kept as a named instance. Two coverage-driven refactors (Phase 6.5): `compactTagCandidate`'s and the tool-call predicates' `!text.startsWith('<')` checks were dead — their only caller (`possibleTagStart`) always passes a tail slice starting at a `<` position — removed with a comment, keeping only the (real, reachable) `.includes('>')` check. |
| `artifacts/index.ts` | *(new — barrel)* | Re-exports every module above, plus `tokens.ts` (added 2026-07-19, see this file's header). |

### Not ported / explicitly out of scope

- `artifacts/create.ts`'s `buildCreateArtifactRequestBody`/`postCreateArtifactRequest` — OD's own HTTP request-shape builder for its `/api/projects/:id/files` route; an HTTP route shape is a product/transport-layer surface, not a kernel port concern (an OD adapter's own `@jini/http` pack would own the equivalent request handling against this port).
- `artifacts/manifest.ts`'s `inferLegacyManifest` (the HTML/deck/markdown/svg extension-based classification logic) — OD's own file-kind taxonomy; the `ManifestInferrer` injection seam replaces it, per the task brief's explicit instruction.
- `artifacts/publication-guard.ts`'s `UNRESOLVED_ARTIFACT_PLACEHOLDERS` literal strings — one bundled example template's own pitch-deck content, not a generic mechanism.
- `artifacts/runtime-compat.ts`'s Motion/Framer-Motion CDN-bundle rewrite logic in full — a third-party-library-specific fix, not a generic engine concern.

### Validation (original 2026-07-18 porting task)

- `pnpm --filter @jini/daemon typecheck` (src + tests, when this lived in `@jini/daemon`): zero errors, zero TS2307.
- `pnpm --filter @jini/daemon test` (full package, when this lived in `@jini/daemon`): 178/178 passing, including the pre-existing `identifier-lint.test.ts` vocabulary-firewall check (a doc-comment `projectId` mention was caught and genericized by this exact lint during this task — the lint earning its keep).
- **Coverage** (`json-summary`+`json` reporters, real aggregate for the whole `src/artifacts/` folder at the time): **statements 100%, branches 100%, functions 100%, lines 100%** — every individual file at 100% on all four metrics, no exceptions, no coverage-suppression comments anywhere in this task's files.
- **Purity**: `grep -rniE "open[- ]design|\bod_|--od-stamp|/tmp/open-design|@open-design" src/artifacts/` — zero matches.

### Validation (2026-07-19 move to standalone package)

- `pnpm --filter @jini/artifacts typecheck && pnpm --filter @jini/artifacts test`: see the Stage 0 hardening pass's verification in the same commit — all tests moved with the files, unedited, and still pass unchanged (proving the move was mechanical, not a behavior change).
- `pnpm guard`: `ArtifactStoreToken` no longer appears in `@jini/daemon`'s kernel token set; `@jini/artifacts` is registered in `UNLOCKED.md`.
