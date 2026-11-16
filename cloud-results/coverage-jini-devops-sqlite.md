# Coverage: @jini-ai/devops + @jini-ai/sqlite

Branch `test/coverage-jini-devops-sqlite` (from `origin/integ/wave-b`). Node 24.11, pnpm 10.33.2.
Measured with `vitest --coverage --maxWorkers=2 --minWorkers=1`, `include: src/**`, tests and `__tests__` excluded (the package's own config only measures `src/deploy/**`, so the numbers below widen it to all of `src/`).

## Baseline on the unmodified tree
- `pnpm install --frozen-lockfile` OK. `@jini-ai/http-kit` (and `ui`, `chat` under `-r`) **fail `tsc` build on the untouched tree** (test files typecheck against non-exported symbols, e.g. `sse.test.ts`, `origin.test.ts`). Not touched. devops/sqlite do not need them built; the leaf deps (core, platform, daemon, db, registry, protocol...) built.
- devops: 80 files / 1214 tests green. Whole-`src/**` lines **88.54%** (5004 lines; the "18% / 57 files never loaded" figure did not reproduce here, every file loads).
- sqlite: 12.5% was an unbuilt-deps artefact. With `dist` built, 4 files / 9 tests green, `src/index.ts` 100% (it is a 20-line re-export barrel).

## devops, per file (lines % / branches %)
| file | before | after |
|---|---|---|
| deploy/ops-runner.ts | 8.0 / 0 | 100 / 100 |
| deploy/ops-secrets.ts | 5.2 / 100 | 100 / 100 |
| packaging/electron/staged-closure.ts | 5.4 / 100 | 100 / 100 |
| deploy/ops-tools.ts | 8.5 / 100 | 100 / 100 |
| deploy/ops-secret-card.ts | 2.1 / 100 | 100 / 100 |
| deploy/ops-registry.ts | 18.2 / 100 | 100 / 100 |
| packaging/electron/staged-closure-node.ts | 22.2 / 100 | 100 / 83.3 |
| local-dev/node-runtime.ts | 75 / 100 (fn 66.7) | 100 / 100 |
| packaging/electron/optional-peers.ts | 66.7 / 50 | 100 / 100 |
| src/index.ts | 0 / 100 | 100 / 100 |
| **total** | **88.54 / n.a.** | **99.74 lines, 97.64 branches, functions ~99.9** |

Tests are in-process with injected fakes (`ops-fixtures.ts` builds a `DeployOpsRuntime`; `memory-fs.ts` for packaging). The old `staged-closure.test.ts` ran the audit in a subprocess, so it never counted toward coverage; the new `staged-closure.unit.test.ts` covers the same logic in-process and the subprocess test is kept.

New tests: ops-runner (115), ops-secrets (74), ops-tools (56), ops-secret-card (25), ops-registry (5), staged-closure.unit (33), optional-peers (14), staged-closure-node (4), node-runtime.real (5), index (1). sqlite: reexport-identity (9). Existing tests: none removed or edited (devops 1214 -> 1548, sqlite 9 -> 18).

## sqlite
`src/index.ts` 100/100/100/100. Added `reexport-identity.test.ts`: every runtime export `===` its origin binding, the covered list equals the barrel's key set, plus `parseJsonOrUndef` behaviour.

## Seams added (no behaviour change)
- `packaging/electron/staged-closure-node.ts`: `createNodeRuntimeResolver(input, { importResolve? })`, default `import.meta.resolve`. Needed because Vite's SSR `import.meta` has no `resolve`. Changeset: `.changeset/devops-staged-closure-import-resolve-seam.md` (patch).

## Files left (devops, not at 100%)
Not done, in rough order of uncovered branches; none below 94% lines:
- deploy/target-descriptors.ts 96.89 L / 65.69 B (6 lines)
- deploy/publish-jobs.ts 100 L / 79.54 B
- local-dev/source-tree-stamp.ts 94.44 L / 70 B
- packaging/electron/staged-closure-node.ts 83.3 B: the `?? import.meta.resolve` default can't be taken under vitest (undefined there); it is only exercised by the existing subprocess test, which v8 coverage cannot see. Left honestly, not ignore-commented.
- packaging/electron/typescript.ts 91 B; deploy/config-descriptors.ts 96.77 L / 85.7 B; local-dev/server-retirement.ts 96.77 L / 89.5 B; static-export/html-url-locations.ts 96 L / 90 B; deploy/ops-descriptors.ts 90 B; source-control/repository-path.ts 95.7 B; checks/hardwiring.ts 98 fn; checks/coverage/lcov.ts 98.9 B; staging.ts 99.5 B; transforms.ts 98.2 B.

## Bugs found
None. No test marked fail/skip.
