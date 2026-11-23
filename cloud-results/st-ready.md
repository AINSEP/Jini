DONE b68efb79c 793328b79

# st-ready (2026-11-22) — ST-5, ST-14, ST-4 (the three READY storage slices)

Unattended cloud run, Opus high. Nothing in this run deletes, prunes, converts or compacts anything.
The SHAs on the first line are the last commits before this report on `codex/st-ready-tovu` and
`codex/st-ready-jini`. The report commit itself follows them on each branch.

- **Spec:** Tovu `origin/plan/whats-left-1122` — `plans/P11-storage-budget-v2.md` (§2a, §2e, §7),
  `plans/P11-storage-check-v2.md` (correction 3 and "Ready to build now" win), owner rules
  `plans/P9-extraction.md` §1.
- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`; Tovu `origin/integ/merge-13-2026-11-22`
  `0d7f78fa4` (its tip `f7185f153` only adds the combine-13 report, which was read with `git show`).
- **Pushed:** only `codex/st-ready-jini` and `codex/st-ready-tovu`, plain `git push` after
  `git pull --rebase`. No force-push, no `--no-verify`, no tags, no publish, no subagents, no
  codebase-memory tools. `main`, `integ/*`, `plan/*`, `refactor/terra` were only fetched.

## Where each piece lives (owner rule: generic in Jini, Tovu wires)

| piece | repo / file | why there |
|---|---|---|
| ST-5 copy selection | Jini `packages/db/src/sqlite/backup-policy.ts` (`selectDatabaseCopiesToPrune`) | Beside the existing `DATABASE_COPY_RETENTION` and `pruneDatabaseCopies`, so the five-copy constant and the folder/ordering rule are literally shared (one private helper `localCopiesNewestFirst`, used by both). |
| ST-4 runner | Jini `packages/platform/src/retention/runner.ts`, entry `@jini-ai/platform/retention` | Plan §2a: host-neutral, every collaborator injected. Imports only `@jini-ai/core` (allowed edge). |
| ST-14 walk (generic) | Jini `packages/platform/src/retention/measure-tree.ts` (`measureStorageTree`) | The run brief puts measurement contracts in Jini: symlink skipping, unknown-not-zero and per-target attribution carry no Tovu policy. |
| ST-14 site measure (Tovu) | Tovu `apps/website/src/features/storage/measure.ts` (`measureSiteStorage`) | Plan §2e path. Tovu policy only: categories, the category → class table (`automatic` / `yours` / `report-only`, from the v2 inventory's Auto? column) and the `-wal`/`-shm` split. New feature folder ranked `storage: 0` in `development/boundaries/feature-ranks.json`. |

Not wired anywhere, on purpose: the runner is not started by Tovu (that is ST-6a, gated on Q1), no
policy exists yet, no route, CLI or approval was added, and `pruneDatabaseCopies`' behaviour is unchanged.

## Setup
- Node 24.22.3 (`/opt/node24`), pnpm 10.33.2, npm 11.
- Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0 (on the unmodified tree; the db
  edit landed while the build was running, so `@jini-ai/db` and `@jini-ai/platform` were rebuilt with `tsc` after).
- Tovu: `npm ci --ignore-scripts` (root) 0, `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`,
  `packages/contracts` tsc 0, `packages/sdk` build 0 (the first base typecheck was red only because contracts were not built yet; rerun after building).
- Base gates ran in a clean `git worktree` at `0d7f78fa4` sharing the same `node_modules` (so it sees the
  same linked Jini; the new Jini exports are additive and unused by the base).

## ST-5 · pure copy-retention selection (Jini, commit `997cad080`)
- **Files:** `packages/db/src/sqlite/backup-policy.ts` (+ shared helper; `pruneDatabaseCopies` now calls the
  same helper, behaviour identical), `packages/db/src/sqlite/index.ts` (export),
  `packages/db/src/__tests__/sqlite/copy-selection.test.ts` (new, 9 tests),
  `packages/db/src/__tests__/sqlite/index.test.ts` (export list).
- **Contract:** `selectDatabaseCopiesToPrune({ copies, verifiedNewest }, { keep = DATABASE_COPY_RETENTION, protectedPaths } = {})`
  returns the copies a pass MAY remove. Nothing is selected unless `verifiedNewest` is the newest copy in its
  own folder (a newer, unverified copy written after verification selects nothing). Protected paths are kept
  beyond the cap. Copies in another folder are ignored. `keep` below 1 or fractional is a `RangeError` in plain words. Pure: no fs, input not reordered.
- **Tests (plan names):** `default keeps 5`; `protected paths are kept beyond the cap`; `nothing is selected
  without a verified newest copy`; `copies from another directory are ignored`; plus anchor-not-newest,
  tie order equals the live pruner's, purity, `keep` refusal. Existing `backup-policy.test.ts` (4) still green.
- **Named mutation — drop the verified-copy requirement** (remove the null guard and the anchor-is-newest check, anchor falls back to `copies[0]`):
  **killed**, 2/9 red (`nothing is selected without a verified newest copy`, `a verified copy that is not the newest local copy selects nothing`).
  Restored by byte copy, 9/9 green. Raw: Jini `cloud-results/st-ready-raw/st5-mutation.txt`.

## ST-14 · read-only storage measurement (Jini `8c4ff50dc` + Tovu `7418cf4a5`)
- **Jini files:** `packages/platform/src/retention/measure-tree.ts`, `…/retention/index.ts`,
  `…/retention/__tests__/measure-tree.test.ts` (11 tests), `packages/platform/package.json` (`./retention` export + `jini.entries`).
- **Tovu files:** `apps/website/src/features/storage/measure.ts`, `…/storage/__tests__/measure.test.ts` (7 tests),
  `development/boundaries/feature-ranks.json` (`"storage": 0`).
- **Contract:** `measureSiteStorage({ siteDir, paths }, { fs } = {})` with already-resolved absolute paths
  (a category may repeat, e.g. one entry per `pre-migrations-*.db`). One walk; every file goes to the closest
  path that contains it, the rest to `other`, so categories and classes add up to the walked total.
  Symlinks are never followed (listed in `skippedSymlinks`). An unreadable path makes every tally that
  contains it `bytes: null` and keeps `knownBytes` as the lower bound — never 0. A missing path is a known 0.
  Each `content-database` / `chat-database` path gets separate `-wal` and `-shm` targets, reported as
  `database-wal` / `database-shm` (class `report-only`) and per database in `databases[]`.
  A relative path or one outside the website folder is refused in plain words. Nothing opens a DB or writes
  (a test snapshots the tree before and after).
- **Tests (plan names):** `categories add up to the walked total`; `a symlink is not followed`; `an
  unreadable folder is reported unknown, not 0`; `WAL is reported apart from the main file`; plus class
  table, read-only, plain-words refusals. Jini adds symlinked root, nested targets, `content.db-wal` not
  counted as `content.db`, unreadable folder poisoning nested targets, vanished file, special files.
  The "unreadable" cases inject an `EACCES` fs because the container runs as root (chmod 000 is ignored).
- **Named mutation — follow symlinks** (`lstat` → `stat` in the default fs adapter):
  - planted in Jini source: **killed**, 2/11 red (`a symlink is not followed`, `a symlinked root is not followed either`);
  - planted in the **linked Jini `dist`** that Tovu imports: **killed** in Tovu, 1/7 red (`a symlink is not followed`).
  - Extra Tovu mutation (stop splitting WAL/SHM from the main file): killed, 5/7 red.
  - All restored by byte copy, `cmp` identical, green again. Raw: Jini `st-ready-raw/st14-jini-mutation.txt`, Tovu `st-ready-raw/st14-tovu-mutation-{a,b}.txt`.

## ST-4 · retention runner only (Jini `8c4ff50dc`, gate fix `908ff341b`)
- **Files:** `packages/platform/src/retention/runner.ts`, `…/retention/__tests__/runner.test.ts` (16 tests),
  `packages/platform/src/secrets/__tests__/exports.test.ts` (subpath list), `api-baseline/jini-ai__{platform,db}.json` (`api:update`).
- **Contract:** `createRetentionRunner({ policies, clock, scheduler, reportError }, { intervalMs = DAY, scheduledDryRun = true, onReport } = {})`
  → `{ runOnce({ dryRun }), start(), stop() }`. Policy `{ id, kind: "cache" | "derived" | "old-copy", measure(), sweep({ now }) }`;
  no `"content"`, no `"history"` (type test with `@ts-expect-error`, pinned by `tsc`; also refused at runtime for JS callers). `fs` is not injected into the runner because the runner never touches files; policies own theirs.
- **Correction 3 (mixed dry-run / live), as built:** one running pass and at most one waiting pass of the
  other mode. A request of the running mode joins it; a request of the other mode joins (or creates) the
  waiting pass, which starts when the running one finishes. So a dry run that arrives during a cleanup gets
  its **own measurement-only result** after the sweep, and a confirmed cleanup that arrives during a dry run
  gets **an actual sweep**. `stop()` clears the timer, resolves a waiting pass as `{ status: "stopped" }`
  without running it, and resolves only after the running pass finishes. After stop, `runOnce` returns
  `stopped` and `start()` refuses in plain words. Scheduled (boot + timer) passes are **measure-only by
  default**; a host must pass `scheduledDryRun: false` to clean on a timer.
- **Tests (plan names):** `boot, timer and manual passes share one in-flight pass`; `dryRun never calls
  sweep` (sweep throws); `one failing policy does not stop the next`; `stop awaits the pass in flight`;
  `type test: kind "content" does not compile`. Correction 3: `a dry run that arrives during a live pass gets
  a measurement-only result`; `a confirmed cleanup that arrives during a dry run gets an actual sweep` (also
  pins joining); `stop during a queued pass cancels it and still drains the running one`. Plus: failing
  measure, throwing `reportError`, `onReport` failure, idempotent start/stop, default interval, kind/id/interval refusals.
- **Error words:** a failed policy reads `Storage cleanup "<id>" failed while cleaning up (Error(EACCES)).`
  The first version put the raw `error.message` in that text; the log-safety and error gates flagged it, so
  the outcome now carries only `describeErrorForLog`'s class/code and the host's `reportError` gets the full
  error as `cause`. Consequence for ST-6a+: owner-facing "busy / expired / protected" words must come from
  the host's mapping of `cause` (or a later typed refusal class), not from the runner's message.
- **Named mutation — let `runOnce` start a second pass while one is running**
  (`if (!running || running.dryRun === dryRun) return begin(dryRun)`): **killed**, 2/16 red
  (`boot, timer and manual passes share one in-flight pass`, `a confirmed cleanup that arrives during a dry run
  gets an actual sweep`); re-run at the final tip, same result. Raw: Jini `st-ready-raw/st4-mutation.txt`.

## Gates (no new red)

**Jini** (final = `908ff341b` content; compared with combine-14's recorded `gates-final/` at the same base content; raw in Jini `cloud-results/st-ready-raw/gates-final/`)

| gate | base (combine-14 final) | this branch |
|---|---|---|
| `pnpm guard` | 0 | **0** |
| size (`SIZE_BASE_REF=7c4ee7881`) | 1 (BASE-RED rows) | **1, identical rows** |
| complexity (`COMPLEXITY_BASE_REF=7c4ee7881`) | 1 (BASE-RED rows) | **1, identical rows** |
| hooks | 0 | **0** |
| why-comments `--base 7c4ee7881` | 0 | **0** (9 files checked, 0 lost) |
| why-comments default (terra) | 1, 352 lost / 342 allow-listed | **1**, 351 lost / 341 allow-listed — same 10 not allow-listed |
| log-safety | 1 (BASE-RED rows) | **1, identical rows** (first pass had +1 `error-helper` row in `runner.ts`; fixed in `908ff341b`) |
| error gate (WARN) | 25 New/Worse | **25, identical list** (first pass had +1 `catch-reads-error` in `runner.ts`; fixed) |
| `api:check` | 0 | **0** after `api:update` (`./retention` + `selectDatabaseCopiesToPrune`; 696 entries, 17264 symbols) |
| `@jini-ai/platform` / `@jini-ai/db` typecheck | — | **0 / 0** |
| `npm --prefix packages/platform run test` | — | **3381 pass, 6 skipped, 0 fail** (182 files) |
| `npm --prefix packages/db run test` | — | **959 pass, 0 fail** (115 files) |
| `check:cross-package` (no snapshot) | 1, 2894 lines | **1**: same rows plus one `XP3 packages/db/src/sqlite/backup-policy.ts: absolute JINI_DECLARATION_BASELINE_DIR required` (the no-snapshot message, triggered because the file changed) |
| `check:cross-package` with snapshot | combine-14 `xp-snapshot-final.txt`: 950 rows | **950 rows, byte-identical after sorting** (snapshot rebuilt here: worktree at `35c4961af`, frozen install, core + recursive build, `--write-baseline` → 3308 mappings; `st-ready-raw/gates-final/xp-snapshot-final.txt`). The extra no-snapshot row above disappears. |

**Tovu** (base worktree `0d7f78fa4` vs final `7418cf4a5`; raw in `cloud-results/st-ready-raw/gates-{base,final}/`)

| gate | base | final |
|---|---|---|
| check:size | 1 (BASE-RED worsened rows) | **1, identical** |
| check:boundaries | 0 (68 features, 112 warnings) | **0** (69 features, same 112 warnings) |
| check:complexity | 0 | **0** |
| check:hooks | 0 | **0** |
| check:why-comments (terra) | 1 | **1, identical output** |
| check:errors | 0 | **0, identical output** |
| check:architecture | 1 (runtime-only propagation 3.06 → 3.29, BASE-RED) | **1**, same single row, 3.29 → 3.28 (one more file dilutes it) |
| typecheck (+e2e) | 0 | **0** |
| typecheck:tests | 0 | **0** |
| node tests on changed files | — | `features/storage/__tests__/measure.test.ts` 7/7 and `development/scripts/__tests__/check-feature-ranks.test.ts` 5/5 (`st-ready-raw/tovu-tests.txt`) |

## Owner rules check
- Two-object signatures with `_optional = {}` pads on every new function; no pad removed anywhere
  (`git diff` of both branches removes no `_optional` line). `Array.map` never receives a padded function directly (`toAmount` is called through an arrow).
- Every function ≤ 50 lines and complexity ≤ 10 (size and complexity ratchets unchanged).
- Why-comments on each non-obvious rule (anchor must be the newest copy; serialized modes; sink fallback; root ignores chmod in tests).
- No re-export shell: `retention/index.ts` is the package entry, and Tovu imports `@jini-ai/platform/retention` directly.
- Jini stays vendor/server neutral: no Tovu words, no server code; `platform` imports only `@jini-ai/core`.
- Plain error words throughout; no runtime under core `src/contracts`.

## Left for the next slices (not done here, by design)
- ST-6a: start the runner in the serving process (owner role, report-only until Q1), drain before storage closes.
- ST-6b: bind `selectDatabaseCopiesToPrune` into a Tovu policy under the backup-publication lock, with the read-only `quick_check` verification.
- ST-15/16: callers that resolve the real site paths for `measureSiteStorage`.
- Owner-facing busy/expired/protected words: see the ST-4 error-words note.

## Commits
- Jini `codex/st-ready-jini`: `997cad080` ST-5 · `8c4ff50dc` ST-4 + ST-14 walk · `908ff341b` gate fix + api baseline · `cb39fcf38` gate outputs + mutation rerun · `793328b79` XP snapshot output · (this report copy)
- Tovu `codex/st-ready-tovu`: `7418cf4a5` ST-14 · `b68efb79c8` gate outputs · (this report)
