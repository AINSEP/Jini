# kt-k07: K-07 trash list/restore agent tools -> `@jini-ai/cms/trash` (DONE)

Branch `wave3/kt-k07` in both repos, created from `origin/refactor/terra` (Tovu ada11733f / Jini 4c1892368), then one `--no-ff` merge each of `wave2/kt-K-01`, `kt-K-02`, `kt-K-02b` (none was an ancestor). Cross-plan check: no `origin/wave3/su-*` branch (`su-cms`, `su-s5`) carries an S4a/S4b commit (`git log --grep='S4[ab]'` empty), so K-07 ran. Sheet blobs matched (fba503a0, 8c5a27d7). Census: every hit is a row of `K-07.importers.tsv`.

## Pushed SHAs
Tovu `wave3/kt-k07`: merges (K-01, K-02, K-02b), then
- 31e62e3cc S0 characterization test + golden (tests only)
- 4f4599563 S1 one const per handler; `buildTrashRegistrations` 53 -> 25 code lines
- 53f90faff S2 `buildTrashToolRegistrations({ deps }, optional = {})` over `TrashPackageToolDeps` (`trashPolicy`), host builder keeps name/parameter and binds the policy + `withToolMetadata`; NEW `trash/tool-kinds.ts` (`TRASH_TOOL_ENTITY_TYPES`, `trashToolEntityTypes`, moved unchanged); 2 importers repointed (rule 7a)
- d837574ae S4 binding imports from `@jini-ai/cms/trash`; `agent-tools.ts` deleted; 3 test imports repointed (rule 7a); written against Jini 3da88e4ab
- (this report's commit, last)
Jini `wave3/kt-k07`: merges, then 3da88e4ab S3 (`packages/cms/src/trash/{agent-tools,tool-registrations}.ts`, index lines, changeset `cms-trash-agent-tools.md` minor, vitest `__tests__/tool-registrations.test.ts` 12 tests).

## Gates (all on this branch)
- Baseline, unmodified merged trees: Jini cms typecheck ok, `vitest run` 341 files / 4134 tests pass, `pnpm guard` ok. Tovu `tsc -p tsconfig.json` and `tsc -p tsconfig.tests.json` exit 0; `check:size` ok (201 violations, 192 debt, 9 exceptions); `check:complexity` ok (42); `check:errors` prints nothing; trash glob + contracts + trash-item tests 376 pass.
- BASE-RED: `npm run check:architecture` exits 1 on the base (3 metrics regressed, many NEW cross-feature edges, none involving trash). Recorded first; after every Tovu commit the output is identical to base except the file count (2242 -> 2243, from `tool-kinds.ts`) and the bidirectional hub percentage (16.19 -> 16.18%): no new line. `npm run check:why-comments` (base origin/refactor/terra): 27 lost blocks, all in files other than trash (widgets etc., from the merged wave2 branches); the one trash block it flagged mid-run (the host builder's docblock) was restored verbatim. `npm run check:boundaries`: 16 errors, none involve the trash tools (pre-existing).
- After each Tovu commit (V2): both `tsc` exit 0; `npx tsc` tests; trash glob + contracts + trash-item tests 386 pass (376 + 10 new), also `chat-delete-grant`, `byok-tool-surface`, `tool-contribution-registry`, `honesty-lines-search`, `permanent-delete-tool-gate`, `tool-registrations.post` 159 pass; `check:size` ok; `check:complexity` ok; `check:errors` prints nothing; eslint on touched files 0 errors (5 pre-existing warnings in untouched code of `member-adapter.test.ts`/contracts test); S-FN50 empty; S-FORWARD, S-SUPPRESS, S-MOCK, S-SCHEMA, S-DELETE empty (the one S-DELETE hit is a comment line moved verbatim).
- Jini V2 (3da88e4ab): `build`, `typecheck` ok; cms `vitest run` 342 files / 4146 tests pass; `pnpm guard` ok after one fix (module-level `Map` typed `ReadonlyMap`, as the redirects precedent: HW3); S-IMPORT, S-BARREL, S-TEXT, S-RUNTIME, S-ARGS, S-FN50 (complexity 10), S-SIZE all print nothing. The package was rebuilt and the Tovu `tsc` pair re-run green against it.
- V3, all RED then restored (`git show HEAD:<path>`/saved copy, diff clean): dropping the list permission check -> (d) list; dropping the restore permission check -> (d) restore and (f); dropping `metadata: toolMetadata` -> (b); changing one catalog description -> (b); skipping `filterVisible` -> (f); de-duplicating the binding's `messageKinds` -> (h); making `catalogKinds` a raw concatenation -> (i).

## Differences from the sheet / notes
- Sheet steps S0, S1, S2, S3, S4 as in K-TOOLS-PATTERN; S0b not needed (no `own-limit`). No `surfaces` parameter (sheet: "no surfaces").
- `AgentToolSideEffect` / `AgentToolDefinition` moved as private types in the Jini catalog (the redirects precedent), not exported; nothing imported them.
- Jini copy passes the list `entityTypes` filter only when one is given (conditional spread), because Jini compiles with `exactOptionalPropertyTypes`; the Tovu code passed an explicit `undefined`. No test pinned the key; the port reads `optional.entityTypes` either way.
- Test import edits (rule 7a only): `tool-registrations.contracts.test.ts` and `member-adapter.test.ts` (`trashToolEntityTypes` -> `../tool-kinds.js`, `buildTrashAgentToolCatalog` -> `@jini-ai/cms/trash`), `trash-list-items-honesty.test.ts` (`buildTrashAgentToolCatalog` -> `@jini-ai/cms/trash`). The S0 test and every direct-builder call are unedited.
- Docs that cite `trash/agent-tools.ts` line numbers (`development/assistant-prompts/capability-prompts.md:753,755`, `development/refactor-patterns/abort-before-write.terra-prompt.md`) are outside the write set and now point at a deleted file: left for the docs owner.
- File-disjointness: this run edited only `features/trash/*` plus the three test files above; overlap with other lanes by the INDEX table: S4 (importer rows), U1/U2 (`member-adapter.test.ts`, contracts test), Jini `cms/src/trash/index.ts` (S4a, U1).
- Jini cms test run once with `--maxWorkers=2` fails at startup (pool config conflict); run without it.

## Left / next
Nothing left in K-07. K-07b (`trash-item-tool.ts`) stays in the design queue until lane S S4b. Next in chain K: K-09 (separate run).
