DONE

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

## `codex/ex2-holds-tovu-jini` — all three FIX items applied

| # | item | commit |
|---|---|---|
| 1 | `importPolicy` moved from `StartTier2WorkerRequired` to `StartTier2WorkerOptional`: the pre-policy call shape compiles and runs unchanged (resolver, then import, no policy). Regression test for the old shape sits beside the policy-order test. | `6fe48656` (with FIX 2: same files and tests) |
| 2 | Policy package = host-registered root. `Tier2ImportPolicyRequired.packageRoot` (required); `tier2ImportPolicyData` realpaths it and refuses an entry outside it (or equal to it). `Tier2PluginRef.packageRoot?` added; `createTier2ImportSeam` fills it from the loader's `plugin.packageRoot`, mapped onto a site snapshot by the entry's relative path (`undefined` when the snapshot does not mirror it). A policy-carrying worker with no `packageRoot` fails closed at the import stage. `runTier2Call` uses the registered root when sent (legacy guess otherwise, seam info only). Extra trust stays keyed to the exact entry. Installed (`<pkg>/server/index.mjs`) and built-in (`<sourceDir>/index.mjs`) layouts pinned. | `6fe48656` |
| 3 | `api-baseline/jini-ai__plugins.json` regenerated (7 added policy exports; `StartTier2WorkerOptional`, `Tier2PluginRef` changed); `.changeset/c043-tier2-import-policy.md` (Plugins patch). | `13d8cba5` |

### Tests
- `import-policy.unit.test.ts`: +4 (built-in sourceDir layout + sibling stays SDK-only, entry outside/equal root refused, old call shape, policy without root fails closed); existing calls moved to the optional arg, packageRoot pinned in the order test; the malformed-URL test now runs the real policy computation (only Node `register()` stubbed), since the registered root no longer forces the URL parse in `runTier2Call`.
- `tier2-import-seam.unit.test.ts`: +2 (snapshot mapping + built-in root, non-mirroring snapshot carries no root); the probe-shape assertion now includes `packageRoot`. Support wrapper takes an optional `packageRoot`.
- `l1c1.extract-s6.unit.test.ts`: policy moved to the optional arg; request carries `packageRoot`.
- Targeted files 80 → 87 tests.

### Named mutations (red, then restored green)
- FIX 1 always register a default policy → old-call-shape + fail-closed tests red.
- FIX 2 grandparent `packageUrl` → built-in layout test red; drop containment check → outside-root test red; guess root instead of failing closed → fail-closed test red; seam always forwards the registered root → both seam tests red.

### Verify (ex2-holds-tovu-jini tip `13d8cba5`)
Frozen install 0 · plugins + dependents build 0 · `pnpm typecheck` 0 · `pnpm guard` 0 · `pnpm api:check` 0 · plugins 1030 passed (77 files).

### Tovu follow-up (not pushed — run scope was Jini-side only)
- `codex/ex2-holds-tovu` `apps/website/src/server/runtime/plugin-tier2/worker.ts:62`: move `importPolicy: TIER2_IMPORT_POLICY` from the first argument to the second — `startTier2Worker({ ...required, binding, registerSdkResolver, realImport }, { ...optional, importPolicy: TIER2_IMPORT_POLICY })` — keeping the policy explicit. Without this the call is a TS excess-property error against the fixed Jini. No other Tovu change is needed for the root: the Jini seam now sends the loader's registered root, so the content analyzer's `sourceDir` becomes its package (Tovu's registration must pass the analyzer's `sourceDir` as `pluginRoot`, which the review says it declares).
- Not linked-verified: Tovu pins `@jini-ai/plugins ^0.7.2` from the registry, and this run changed no Tovu file, so the Tovu link/typecheck/vitest step was not run.

## ex3-review-c0b-holds-jini items
Already on their branches before this run (checked `git log`): site-key `hex` keyof assertion `56c60415` (`codex/ex3-c0b-jini`); RT-1 type owners + db.ts comment, RT-2 injection assertion + ports.ts comment, core changeset patch `554b7fde`; consumer inventory `11d47b47` (`codex/ex2-holds-jini`). Nothing re-applied.
