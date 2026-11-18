# kt-k05: taxonomy agent-tool handlers -> `@jini-ai/cms/taxonomy` (K-05, revision 3)

Branch `wave3/kt-k05` in both repos. Base `origin/refactor/terra` (Tovu ada11733f / Jini 4c1892368), then one `--no-ff` merge each of `origin/wave2/su-s1`, `wave2/kt-K-01`, `wave2/kt-K-02`, `wave2/kt-K-02b` (none was an ancestor).

## Status: DONE (S0-S4), with one red commit in the middle (see "Red commit")

## Pushed SHAs
Jini: `fb7e3e434b53961e7481608f375268e2b77d3801` S3 (handlers, builder, ports, port-fake tests, changeset `cms` minor), `f17d3b88ce9181eb0d906495b4f4411f76c8aef3` S3b (merge dialog stays with the host).
Tovu: `203a3de8` S0 characterization test + golden, `830214e0` S1 seam (handlers split, `buildTaxonomyRegistrations#1` size-debt entry deleted), `9f90193a0b784cca46eab7616a8590fcd8fee1e1` S2 ports, `274f8a204b36416b980023487504d05ff6ed807b` S4 move, `a964de0f38bf979f4a7899757ad8c43bb4af26a3` S4b dialog back in the binding. Final Tovu tip is this report's commit (after a964de0f).

## What moved
Jini `packages/cms/src/taxonomy/`: `tool-handlers.ts` (10 handlers, merge split into `mergePrepare`/`mergeRun`), `tool-handlers.types.ts` (ports), `tool-registrations.ts` (`taxonomyDerivedRisk`, `buildTaxonomyToolRegistrations({ deps, surfaces, catalog }, optional = {})`), 3 export lines in `index.ts`, test `__tests__/tool-registrations.test.ts` (port fakes only, 9 tests).
Tovu `features/taxonomy/tool-registrations.ts`: 450 -> 171 lines; keeps `TaxonomyToolDeps`, `buildTaxonomyRegistrations` (same name, positional params, default surfaces, one `withToolMetadata` call), `contributeTaxonomyTools`, `toPackageDeps` (getters, so a route dep assigned after the registry is built is read at call time), and the merge dialog.

## Differences from the sheet (decisions the sheet did not make)
1. The catalog is a builder argument. The Jini catalog has 8 tools (a Jini test pins that); Tovu `agent-tools.ts` (stays, per the sheet) extends it with `taxonomy_get_term` and `taxonomy_get_assigned_terms`. `buildDomainRegistrations` needs all 10, so `catalog` is a required field of the Jini builder and Tovu passes its own. S0 (a) compares against the Tovu 10-tool list, not the Jini catalog names.
2. `mergeGateway` closes over the gateway deps (`plan/confirm/execute(required)` without `deps`): Tovu's bound functions take Tovu's `GatewayDeps`, a different type from core's, so they cannot be passed "unchanged" under core's types. Behaviour is identical (same calls, same args).
3. The merge dialog stays in Tovu (sheet allows this when it reads host wording). Reason found by test: `assistant/__tests__/mcp-ui-allowlist-completeness.test.ts` ("the scan finds the known exchange openers") reads `taxonomy_execute_merge_term` from a `humanConfirmedToolHandler` `dialog:` spec in Tovu source. Jini port is `mergeConfirmedHandler(surfaces, { flag, prepare, run })`; `TaxonomyMergePrepared` is exported for the host dialog.
4. Jini `ForbiddenError` is `ToolPermissionDeniedError` from `@jini-ai/core` (what `@jini-ai/cms/core` re-exports as `ForbiddenError`).

## Red commit (honest)
`274f8a20` (S4) was pushed with one source-reading test red: `mcp-ui-allowlist-completeness` "the scan finds the known exchange openers". I ran that test file after pushing, not before. `a964de0f` fixes it forward (no amend, no force-push); every other gate was green on `274f8a20`. Tovu tip is green.

## Gates (commands and results)
Setup: Node 24.22.3; Jini `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (ok); Tovu `npm ci`, `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, built `packages/contracts` and `packages/sdk`. Desktop untouched. Pre-push hook did not block; no `--no-verify` used.
Baseline (unmodified merged tree): Jini `pnpm --filter @jini-ai/cms run typecheck` ok; `npm --prefix packages/cms run test` 346 files / 4211 tests pass; `pnpm guard` ok (1 "stale debt occurrence" line, present at baseline). Tovu `tsc -p tsconfig.json` exit 0; `tsc -p tsconfig.tests.json` exit 0; `check:size` ok (201 violations, 192 debt entries); `check:complexity` ok; `check:errors` prints nothing.
BASE-RED (recorded, not mine): `npm run check:architecture` exits 1 on the base tree (3 metrics regressed: propagation cost runtime-only 3.06 -> 3.20, module API surface 821 -> 852, bidirectional hubs 335 -> 362; cycles). After every Tovu commit its output is byte-identical to the base output (`diff` SAME). `npm run check:why-comments` lists 51 deleted comment blocks from the `su-s1` merge (taxonomy `repo.ts`, `contracts.ts`, `repo.rows.ts`); none from files this run touched. `npm run check:boundaries` has 16 errors, none in taxonomy.
After each Tovu commit (S0, S1, S2, S4, S4b): both `tsc` exit 0; taxonomy tests (all of `features/taxonomy/**/*.test.ts` + `assistant/__tests__/tool-registrations.taxonomy.test.ts` + `tool-registrations.contracts.test.ts`) 187 pass / 0 fail at S4b (151 at S0 incl. the new file); the 6 assistant source-reading tests (`mcp-ui-allowlist-completeness`, `mcp-ui-tool-calls`, `tool-search-keywords.backfill-ranking`, `site-insights-search-discoverability`, `content-read-get-by-id`, `content-read-tool`) 96/96 at S4b; `check:size` ok (200 violations, 191 debt entries: S1 deleted `buildTaxonomyRegistrations#1`); `check:complexity` ok; `check:errors | rg "^(New|Worse):"` prints nothing; eslint on touched files: 0 errors; S-FN50 prints nothing; S-SUPPRESS, S-FORWARD print nothing. Also ok: `check:inventory`, `check:route-tool-parity` (exit 0).
After each Jini commit: `pnpm --filter @jini-ai/cms run build`, `run typecheck`, `npm --prefix packages/cms run test` 347 files / 4220 tests pass, `pnpm guard` ok; S-IMPORT, S-BARREL, S-TEXT, S-RUNTIME, S-ARGS, S-MOCK, S-SUPPRESS, S-SIZE (no file over 500) all print nothing; Jini-form S-FN50 on the new files prints nothing. S-SCHEMA, S-DELETE (end): print nothing.
V3 (S0 test can fail; each shown RED, then restored with `git checkout` + `git diff --quiet`): remove `taxonomy_list`'s permission check -> `(d)` fails; drop `metadata: toolMetadata` from `buildDomainRegistrations` -> `(b)` fails; change the `taxonomy_get_term` catalog description -> `(b)` fails. Run on the pre-S1 code.

## Test edits (rule 7a only)
`assistant/__tests__/tool-registrations.taxonomy.test.ts` and `features/taxonomy/__tests__/get-assigned-terms-tool.test.ts`: `taxonomyDerivedRisk` import repointed from `../tool-registrations.js` to `@jini-ai/cms/taxonomy`. Nothing else.

## Overlaps (file-disjointness)
Jini `packages/cms/src/taxonomy/index.ts`: this run appended 3 lines; the su-cms run (S1c, S2*) may edit the same file (append-only here, merge by hand if it conflicts). Jini `.changeset/`: one new file, no overlap. Tovu `development/scripts/size-debt.json`: one entry deleted (shared with K-02, K-03, K-04, K-09, K-10a). Tovu `features/taxonomy/tool-registrations.ts` and the two test files above: no other known run. The su-s1 merge brought taxonomy `repo.ts` removal; no conflict.

## Left / next
Nothing left in K-05. Not done (out of scope): `taxonomy/collection-term-policy.ts`, `gated-hooks.ts`, the dialog wording and `agent-tools.ts` stay in Tovu (K-05b design queue). The two extra read tools could join the Jini catalog in a later sheet (needs the Jini catalog test updated); then the `catalog` argument could default. Publishing/consuming `0.7.1-next.N` is not part of this sheet: Tovu was green against the linked Jini at f17d3b88.
