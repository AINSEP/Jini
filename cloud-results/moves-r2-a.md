# moves/r2-a results

Base: Jini 6cfcc471d, Tovu 9ec4ad4a4 (integ/wave-b). Branch moves/r2-a in both repos.

| # | slice | status | Jini SHA | Tovu SHA |
|---|---|---|---|---|
| 1 | repoint-commands (RP-commands-1/2) | DONE | - | 0ec3f39a |
| 2 | dedupe-site-guide (DD-site-guide-1) | DONE | - | e559fad1 |
| 3 | delete-plugins (DL-plugins-1..6) | SKIPPED | - | - |
| 4 | ui-dashboard-1 | DONE | c9a08436 | 8c9f3a44 |
| 5 | move-html (MV-html-1) | DONE | 1832a5f9 | de621f89 |
| 6 | split-commands SP-commands-1 | DONE | 2ca65345 | 931300c4 |

## Skip reason (slice 3)
All guards, censuses and Jini preconditions held (19 census hits, blobs match). After the edit the reach_check printed 2 unlisted hits:
- `apps/website/src/platform/db/client/__tests__/open-site-db-client.unit.test.ts:33` — a FORBIDDEN-module scan list entry `features/plugins/migration-recovery` (a path literal in a list a test scans). Deleting the Tovu file makes this guard vacuous; the sheet's `path_literals: -` missed it (written after C3t/other waves added this test).
- `duplicate-content-db.integration.test.ts:207` — comment ref.
Per T-DELETE step 2 an unlisted hit = SKIP. Tree restored. Sheet needs a `path_literals` row retargeting the scan to `@jini-ai/db/data-modules` (decision needed: what the daemon DB client must not load from Jini).

## Tests (Node 24; Tovu linked to Jini via link-jini.mjs)
- S1: 97/97 pass (7 repointed + commands tests).
- S2: 40/41 pass; 1 fail `facts-profile` "guide projection pins absent sections..." — fails identically on the unmodified tree (pre-existing). Other 40 pass.
- S4: Jini ui usePersistedDisclosure 4/4; admin dashboard dir 99/99.
- S5: Jini cms style-values 7/7 + subpath-isolation 1/1; Tovu render.test.ts 218/218.
- S6: Jini cli stdin-line 8/8; Tovu import-local.integration 24/24.
- Tovu `tsc -p tsconfig.json`: no errors in touched files (46 total pre-existing, env-related; 104 before building Tovu workspace packages).
- eslint: 0 import/unused/resolve errors on all slices; S5 render.ts has pre-existing max-lines; S6 one sonarjs warning in verbatim sheet code.

## Env / sheet notes
- Jini baseline build: `pnpm -r build` fails in desktop-host, capability-providers, http-kit, ui, cms test-file typecheck (pre-existing; dist still emitted by tsc).
- Sheet `--minWorkers=1` flag conflicts with Jini vitest 2 configs (RangeError) and Tovu admin vitest 4 (unknown option); used `--maxWorkers=2` / `--no-file-parallelism`.
- S1 sheet census line numbers shifted (match by text, fine). S6: import-local.ts differed only at line 4 (C5 repoint, as expected).
- Slice 2: `ui-dashboard*` sheet glob = ui-dashboard.md only.
