# GREEN run 2026-10-27: Sonnet 5.5, REPORT ONLY (owner approved cloud testing 10-27)

## HARD CAPS (top priority. When the first one is hit: write DONE/BLOCKED in RUN-LOG.md, push RESULTS.md, END)
- Model Sonnet 5.5. Max **120 min wall clock**. Start **no new batch after minute 100**. Max **~2M tokens**. **No subagents.**
- **REPORT ONLY.** Never fix product code or tests. You write only `RUN-LOG.md` and `RESULTS.md` in this folder. The only source edits allowed are the scripted mutations (`mutate.mjs`), and each one must be restored before anything else runs or gets committed.
- Push ONLY to Tovu branch `cloud/green-1027-results` (create it from `cloud/green-1027`). Never push `cloud/green-1027`, never push to Jini, never main, never force-push, never npm publish, never create/update/run a RemoteTrigger, never reschedule yourself.
- Commit with explicit paths only: `git add ADS-memory/reports/cloud-runs/2026-10-27-green/RUN-LOG.md ADS-memory/reports/cloud-runs/2026-10-27-green/RESULTS.md`. Before every commit, `git status --porcelain` must show nothing except those two files. A mutated source must never be committed.
- Minor findings (setup quirks, warnings, slow tests) get LISTED in RESULTS.md. Never act on them.

## Protocol
Read `ADS-memory/reports/cloud-runs/RUN-PROTOCOL.md` first, for the run-log and push rules. Its branch section is out of date: use the branches named here.
- In your first 2 minutes, before setup: create `ADS-memory/reports/cloud-runs/2026-10-27-green/RUN-LOG.md` with a STARTED entry (UTC time, both HEAD SHAs), commit it, and push to `cloud/green-1027-results`.
- Push at least every 5 minutes, with a heartbeat entry if nothing changed. Log every failing command with its exit code and the first ~20 lines of stderr.
- Update and push RESULTS.md after every batch. A run that dies must leave its partial results pushed.

## Inputs (in this folder on the branch)
- `LOTS.json`. Its `lots[]` list 30 lots, each with `test_files[]` (path, runner, `names_added_or_changed`), `named_from_manifest`, `guards_green_both_ways`, `exclusive_sources`, `shared_sources`, `mutation`, `regression[]` and `notes`. It also holds `recheck` (step d) and `sweep.files[]` (step c, with tier 1 or 2).
- `mutate.mjs`. `node ADS-memory/reports/cloud-runs/2026-10-27-green/mutate.mjs <lot> apply|restore [--extra]` puts a lot's mutation paths back to the BASE commit (the parent of the fix commit), or back to HEAD. `ALL apply|restore` does the same for every Tovu lot source. `--list` lists the lots. Env: `TOVU_ROOT=/home/user/Tovu JINI_ROOT=/root/Jini`. `restore` exits 4 if anything is left dirty. If that happens, stop and log BLOCKED.
- BASE SHAs: Tovu `03d9d1c051fadd63ee7d59064e04576b318a4964`, Jini `2934b5452cd869fd9e2295810cb51e6c701516c0`.

## Setup (last night's setup, with its fixes; it worked)
- Node 24: `mkdir -p ~/.local && curl -fsSL https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-x64.tar.xz | tar -xJ -C ~/.local && mv ~/.local/node-v24.22.0-linux-x64 ~/.local/node24`. Prefix every command with `export PATH=$HOME/.local/node24/bin:$PATH;`, then run `corepack enable --install-directory $HOME/.local/node24/bin`.
- Jini: `git clone --branch cloud/green-1027 https://github.com/AINSEP/Jini.git /root/Jini && cd /root/Jini && pnpm install --frozen-lockfile && pnpm --no-bail -r build`. Log every package that fails. Last night `@jini-ai/memory` (TS2352) and `@jini-ai/cookie-consent` (gzip budget) failed. Lot jini-small fixes both, so report whether they pass now, with the client.min.js gz size from the build output. Confirm that `packages/sidecar/dist`, `packages/server/dist` and `packages/daemon/dist` exist.
- Tovu at /home/user/Tovu: `git fetch origin cloud/green-1027 cloud/red-1026-night-results && git checkout -B results origin/cloud/green-1027`. Save last night's results for comparison: `git show origin/cloud/red-1026-night-results:ADS-memory/reports/cloud-runs/2026-10-26-red-night/RESULTS.md > /tmp/red-results.md`.
  - `npm ci` 404s on `@jini-ai/cookie-consent@^0.6.12`. Workaround, never committed: point that one root dependency at `file:/root/Jini/packages/cookie-consent`, run `npm install`, then `git checkout -- package.json package-lock.json`.
  - Build `@tovu/sdk` first: `npm run build --workspace @tovu/sdk`. Last night this failed, so run `JINI_PACKAGES_DIR=/root/Jini/packages npm run link:jini`, build the sdk, then run link:jini again. Log which path you took.
  - Link: `JINI_PACKAGES_DIR=/root/Jini/packages npm run link:jini`.
  - Desktop: `(cd apps/desktop && npm ci && npm run build:preload)`. Then make sure every `apps/desktop/node_modules/@jini-ai/<pkg>` is a symlink to `/root/Jini/packages/<pkg>`, and symlink any that are not. This is an env fix only.
  - If argon2, better-sqlite3 or esbuild fail to load, run `npm rebuild argon2 better-sqlite3`. Never run `npm rebuild esbuild` at the root.
- There is no Postgres server, browser, display or IPv6. Failures caused by those are ENV: list them, don't fix them.

## Runners (always `timeout`; logs to /tmp/<name>.log; grep/tail, never cat whole logs)
- `website`, from the Tovu root: `TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json timeout 600 node --import tsx --test --test-concurrency=1 --experimental-test-module-mocks <files>`
- `desktop`, from apps/desktop: `timeout 600 node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-concurrency=1 <paths relative to apps/desktop>`
- `desktop-renderer`, from apps/desktop: `timeout 600 node --import tsx --test --test-concurrency=1 <paths relative to apps/desktop>`
- `jini-vitest:packages/<p>`, from `/root/Jini/packages/<p>`: `timeout 900 npx vitest run --maxWorkers=2 --minWorkers=1 <paths relative to the package>`
- At most 5 files per command and at most 2 test processes at once. Kill by pid only, and leave no process running at the end. `import.fixture.ts` is a helper: never run it.

## Execution order (mutations need the tree to themselves)
**Phase 1: GREEN and typecheck, 2 lanes, no mutation.**
- Lane A, step (b) GREEN: run every lot test file once. A file listed under two lots runs once.
- Lane B, step (a) typecheck, report only:
  - Jini: `cd /root/Jini && pnpm --filter @jini-ai/server --filter @jini-ai/db --filter @jini-ai/mcp --filter @jini-ai/daemon --filter @jini-ai/agent-runtime --filter @jini-ai/memory --filter @jini-ai/cookie-consent exec tsc --noEmit` (`timeout 900`).
  - Tovu website: `NODE_OPTIONS=--max-old-space-size=6144 timeout 1500 npx tsc -p tsconfig.json --noEmit`, then the same with `-p tsconfig.tests.json`.
  - Desktop: `cd apps/desktop && timeout 900 npm run typecheck`.
  - For each command, report the error count and the first 15 errors. Several manifests list likely type nits (`as never` casts, `VaultPutInput` import, `openSqliteFileKernel` generic, `DbOpsPort` implementers). Say which of those showed up.

**Phase 2: mutations, exclusive, one lot at a time.** For each lot whose `mutation.kind` is `revert-exclusive`, `shared` or `cross-repo`:
1. Run `mutate.mjs <lot> apply`. For `cross-repo` (all-clis-test), also run `mutation.rebuild`.
2. Run the lot's test files.
3. Run `mutate.mjs <lot> restore`, plus the rebuild again for cross-repo, and confirm the paths are clean.
4. If the lot has `extra_shared_step` (gem-leftovers, export-leftovers), repeat 1–3 with `--extra` and check its `expect`.
- jini-small: after apply, also run `pnpm --filter @jini-ai/cookie-consent build`, which must FAIL the 4608 B gzip budget. After restore, rebuild it, and it must pass. Report both gz sizes.
- ui-two (`mac-chrome-later`): skip it and list it under "Not tested: Mac/Chrome later".
- The order is the `lots[]` order. Push RESULTS.md after every 5 lots.

**Phase 3: rechecks and sweep, 2 lanes, no mutation.**
- Step (d): rerun the 8 `recheck.green_unexpected_last_night` names and the 2 `recheck.file_aborts_last_night` files. For each, say what it does now (pass/fail, duration, and whether the file still dies, with the last lines before it died). Compare with /tmp/red-results.md.
- Step (c) regression sweep, over `sweep.files[]`. Tier 1 runs first (177 files that import a changed module). Then tier 2 in this order: desktop and desktop-renderer files; then each touched Jini package's full suite (`npx vitest run --maxWorkers=2 --minWorkers=1` in packages/server, db, mcp, daemon, memory, agent-runtime, cookie-consent); then the website files. At minute 100, finish the command in progress and list the rest as NOT RUN (give a count).
- For each sweep failure, check /tmp/red-results.md and the lot `notes` (some failures are known pre-existing). For up to 15 failing files not explained there, run `mutate.mjs ALL apply`, rerun that file, then `ALL restore`. If it fails at BASE too, it is `pre-existing`. If it passes at BASE and fails now, it is `NEW`. Batch them: one ALL apply, rerun all candidates, one restore.

## Classification (step b), for every test name a lot file executed
- "Lot names" = `named_from_manifest` + every file's `names_added_or_changed`. Templated names (`${count}`, `%s`) match their expanded forms.
- `GREEN-ok`: a lot name passed in phase 1.
- `RED-on-mutation-ok`: a lot name failed under its lot's mutation. A load failure of the whole file under mutation also counts; say so.
- `guard-ok`: a `guards_green_both_ways` name passed both times.
- `UNEXPECTED`: a lot name failed in phase 1, a lot name (not a guard) passed under mutation, a guard failed, or any other test in a lot file failed in phase 1. Paste the first ~10 lines of the assertion error (expected vs actual) or of the load error.
- Count the pre-existing tests that pass in each lot file. No need to list them.

## Deliverable: RESULTS.md in this folder
1. A summary table: lots, test files run, LOAD-FAIL, GREEN-ok, RED-on-mutation-ok, guard-ok, UNEXPECTED, sweep files run / failed (pre-existing / NEW / unsure) / NOT RUN, and typecheck error counts per target.
2. A per-lot table with every lot name and its class. Under it, the UNEXPECTED details.
3. Typecheck results: (a).
4. Rechecks: (d).
5. Sweep failures: (c), each with file, test, the first error lines, and pre-existing/NEW/unsure with the evidence.
6. Minor findings, not acted on.
7. Not tested: skipped, ENV-blocked, cut for time, and Mac/Chrome later (ui-two, plus the UI parts of gem-ch.D T3 and shared-keys SharedKeys.tsx).
All counts are tests EXECUTED, not names listed. A file that didn't run is not a pass.

End with a DONE (or BLOCKED) entry in RUN-LOG.md. Commit, push, and quote the pushed SHA in that final entry.
