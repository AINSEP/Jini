# moves/audit-x2 — cloud results (PARTIAL: stopped at the tool-call budget)

Bases: Jini 6cfcc471, Tovu 9ec4ad4a (integ/wave-b). Branch `moves/audit-x2` in both repos. Node 24.22.3, Jini `pnpm install --frozen-lockfile` OK.

## Per slice
| sheet | status | Jini SHA | Tovu SHA |
|---|---|---|---|
| 1 D08 HD-published-types-1 | DONE | 4a7d83ad | fd4933f4 |
| 2a D12 MV-local-dev-1 (pickFreePort/isPortFree) | DONE | b3c8a8aa | c7b121c4 |
| 2b D12 DD-local-dev-2 (port-listeners, load-repo-root-env, start.test fixture symlink) | DONE (no Jini commit, per sheet) | - | 8e0650aa |
| 3 C06 MV-agent-inventory-1 | DONE | 7843db36 | 2bdce15e |
| 4a D03 DD-coverage-1 (integrity) | DONE | - (no Jini commit) | 1667bb91 |
| 4b D03 DD-coverage-2 (route/area/diff + F1/F2/F2b tests) | NOT STARTED: stopped at the tool-call budget. Sheet is intact; needs a rerun | - | - |

Slice 3 of D03 stays blocked on owner question Q1, as the sheet says.

## Evidence
- D08 Jini, RED on parent (index.ts restored to HEAD, new tests kept): `published-types.test.ts` 3 failed (pins add/replace, pin outside scope, keepScratch). GREEN on the commit: 42/42 in `src/checks/published-types`. eslint clean after extracting `projectDependencies` (the sheet's inline version took `check` to complexity 11, so a helper was added; the sheet's behaviour is unchanged).
- D08 Tovu T1 ("unreadable manifest -> FAIL operation-error, not a crash"), RED on parent scripts: failed. GREEN on the commit: passed. The existing registry-drift skip test and `check-no-linked-jini.test.ts` (3 cases) stay green.
- D08 R2 (`--pin @jini-ai/agent-runtime=0.3.1` must FAIL with a drift block) NOT proven: Tovu has no full install here (node_modules is a stub holding tsx plus symlinks to the Jini devops/platform builds). The run only produced install/mkdtemp errors. Owed to a proper cloud run.
- D12 Jini: `src/local-dev` 38/38 (4 new free-port tests; characterization, GREEN by construction). tsc: no errors in the touched files. eslint: clean.
- D12 Tovu: `start.test.mjs`, `load-repo-root-env.test.mjs`, `port-listeners.test.mjs`, `desktop-portable.unit.test.ts` pass, as does af-cli-characterization apart from the failures below. These failures are environmental and in files I did not edit: `probePortFree` ::1 tests and "released port" (sandbox has no IPv6, `EAFNOSUPPORT`); `dev.mjs`/`dev-desktop.mjs` fixture tests (fixture lacks `compose-bundled-agent-plugins.mjs`); brand-icon/trash-backfill (missing deps). I did not run these against the parent, so "pre-existing" is inferred from the error messages, not measured.
- C06 Jini: `src/embed-widget/browser` 36/36 pass; 2 other test files in that dir fail to load (unbuilt deps, unrelated). eslint and tsc clean on the new files. Tovu admin vitest NOT run (no admin install); census matches the sheet's allowed list.
- D03 DD-coverage-1: Tovu `check-coverage-integrity.test.ts` 9/9 pass. Honest-testing ledger: 43 tests (45 grep matches, including a loop and an indented test) -> 9 kept; the 34 deleted ones have same-titled Jini twins per the sheet. I did not re-verify the twin titles. `coverage-changed.test.ts` could not run (`typescript` not installed in the Tovu stub). `isFirstParty` was hoisted to module level in `coverage-changed.ts` (the sheet's contingency).
- Guard counts: Jini `pnpm guard` fails here in setup (`node_modules/@jini-ai/plugins` symlink missing), not from these changes. `pnpm --filter @jini-ai/devops... build` stops at a pre-existing http-kit test typecheck error (`sse.test.ts` TestEvent); devops/platform were built alone, because tsc emits despite those errors.
- Tovu eslint was not run (no install). `node --check` passed on every edited .mjs.

## Sheet errors / deviations
- D08: the sheet's inline `check` change breaks complexity 10; fixed with a helper (above).
- D08: the sheet's `check-no-linked-jini.mjs` binding block reorders the `registryDependencyNames` doc onto `rejectFileSpecs` (as written).
- D03 DD-coverage-1: sheet text says WRAPPER_HELPER_NAMES/MIN_DA are both "kept" and "all go"; they have no users after the cut, so they were deleted.
- Changesets added: devops-published-types-pins (minor), devops-local-dev-free-port (minor), chat-browser-agent-inventory (minor).
