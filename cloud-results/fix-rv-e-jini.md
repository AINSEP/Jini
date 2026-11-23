PARTIAL: codex/ex2-holds-tovu-jini FIX 1-3 in progress

# fix-rv-e-jini — review rv-e FIX run (Jini)

Report lives on `codex/st-ready-jini` (the first branch fixed). Source review: Tovu
`origin/plan/whats-left-1122:reviews/rv-e-rereviews-stready.md`.

## `codex/st-ready-jini` — all five FIX items applied

| # | item | commit |
|---|---|---|
| 1 | ST-5 selection compares resolved identities; aliases collapse (first/newest row wins) and never take a window slot; relative protected paths protect absolute candidates; verified identity excluded explicitly. `pruneDatabaseCopies` untouched. | `8804304e` |
| 2 | ST-4 queue publishes the running pass before invoking `execute`; advances on fulfil **and** reject; scheduled (boot/timer) rejections go to `reportError` as `A scheduled storage cleanup pass could not run.` (cause = raw error); `stop()` resolves when the in-flight pass failed. | `000f18c3` |
| 3 | ST-4 runner drops `@jini-ai/core` runtime imports (`describeErrorForLog`, `createConsoleLogger`). Outcome text fixed (`Storage cleanup "<id>" failed while cleaning up.`); raw error only as `cause` to the reporter; a throwing reporter is swallowed (no console). | `3a2f7d23` |
| 4 | ST-14 walk enumerates through an anchored no-follow port: `StorageTreeFs = { lstat (root only), openDirectory }`, `StorageTreeDirectory { identity, list, lstatChild, stillOpenedDirectory, close }`. Identity must match the inspected folder on open and after the reads, else the folder is unknown and nothing it listed is counted. Node adapter `nodeStorageTreeFs`: `O_DIRECTORY|O_NOFOLLOW` open + `fstat`, reads through `/proc/self/fd/N` on Linux; elsewhere pathname reads with the identity re-check (residual swap-and-restore window documented in code). | `1f50c5f7` |
| 5 | Changesets `st-ready-platform-retention.md` (Platform patch) and `st-ready-db-copy-selection.md` (DB patch, P9 §1 extraction rule); Platform api baseline regenerated for the FIX 4 port. | `eb8551ce` |

### Tests (tests written first; each new test was red before its fix)
- db `copy-selection.test.ts`: +3 (alias of retained/newest, verified alias with relative anchor, relative protected path). 9 → 12.
- platform `runner.test.ts`: +6 (sync re-entry, throwing clock recovery, scheduled failure reported, stop after failed pass, fixed safe text + cause, throwing reporter writes no console); 3 message assertions updated to the fixed text. 16 → 22.
- platform `measure-tree.test.ts`: +6 (fake: replaced-before-open, identity change during reads; Node: swapped for symlink, different folder put in place, replaced while children read, Linux swap-and-restore anchored read). Existing fakes moved to the new port. 11 → 17.

### Named mutations (red, then restored green)
- ST-5 remove alias collapse (`if (seen.has(identity)) continue`) → alias test red.
- ST-5 raw protected paths (no `path.resolve`) → relative protected test red.
- ST-4 publish `running` after `execute` → sync re-entry test red.
- ST-4 no advance on reject → throwing-clock + scheduled-failure tests red.
- ST-4 drop scheduled `.catch` report → scheduled-failure test red.
- ST-4 error class back in outcome text → 3 tests red; console fallback in reporter catch → console test red.
- ST-14 drop open-time identity check → 2 tests red; drop post-read `stillOpenedDirectory` → 2 red; unanchored Node reads (`base = target`) → Linux swap-and-restore test red.
- Survivors (named, intentional): ST-5 removing the anchor from the `kept` set (unreachable given collapse + keep ≥ 1; kept as the review asked, commented); ST-14 dropping `O_NOFOLLOW` (the identity check still catches it — defence in depth).

### Verify (st-ready-jini tip `eb8551ce`)
Frozen install 0 · `pnpm -r build` 0 · dependents of platform+db build 0 · `pnpm typecheck` 0 · `pnpm guard` 0 · `pnpm api:check` 0 · platform 3393 passed / 6 skipped · db 962 passed. ESLint complexity ≤ 10 / ≤ 80 lines: 0 errors on the changed files.

### Tovu follow-up (not pushed — `codex/st-ready-tovu` is APPROVED and out of scope)
`apps/website/src/features/storage/__tests__/measure.test.ts:92` fakes the old `{ lstat, readdir }` port and will not compile against FIX 4. Migration:
`{ lstat: nodeStorageTreeFs.lstat, openDirectory: async t => { if (t === locked) throw EACCES; return nodeStorageTreeFs.openDirectory(t); } }` (import `nodeStorageTreeFs` from `@jini-ai/platform/retention`). `measure.ts` itself only forwards `fs`, unchanged.

## ex3-review-c0b-holds-jini items
Already on their branches before this run (checked `git log`): site-key `hex` keyof assertion `56c60415` (`codex/ex3-c0b-jini`); RT-1 type owners + db.ts comment, RT-2 injection assertion + ports.ts comment, core changeset patch `554b7fde`; consumer inventory `11d47b47` (`codex/ex2-holds-jini`). Nothing re-applied.
