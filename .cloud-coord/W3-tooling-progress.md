# W3 tooling — coordinator progress

Branch: `cloud/w3-tooling` (from origin/general-work @ 0e? see git log). Brief: `origin/cloud/w3-briefs:.cloud-coord/W3-tooling-brief.md`.

## STEP 0
`Linux vm 6.18.44-fc-v139 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux | vm | /home/user/Jini | 2026-10-20 04:30:36 UTC | node v22.22.0 (default)` → commit fa82dd80 pushed.

## Personas
Coordinator loaded: software-architect, code-inspection, security (AI-Dev-Shop cloned to /home/user/AI-Dev-Shop).

## Setup
- Node 24: default was v22.22.0; installed node-v24.22.0-linux-x64 tarball (sha256 verified) into ~/.local/node24. Shell state does not persist and ~/.bashrc is not sourced, so every command is prefixed `export PATH=$HOME/.local/node24/bin:$PATH`.
- pnpm 10.33.2 via corepack; `pnpm install --frozen-lockfile` 19 s; `pnpm --no-bail -r build` 1m41s (integrations tsc fails as expected; all 36 packages have dist).
- Base baseline (unmodified tree): `tsc --noEmit` devops 0 errors, cli 0 errors. `pnpm guard` on BASE already fails: 26 violations (none in devops/cli) — saved; merge criterion = guard violation list identical to base.
- Temp eslint config: /tmp/w3-tooling-coord/cx.config.mjs (complexity 10, sonarjs cognitive 10, noInlineConfig).
- Worktrees: ../wt-<LOT>, branch cloud/w3-tooling-<LOT>, deps offline install, dist copied.

## Lots
| lot | pkg | status | subagent | commits | before→after worst cyc/cog | coverage | verify |
|---|---|---|---|---|---|---|---|
| L060a | devops | MERGED | 173k tok / 55 calls | 97314aea a5b1844b 70d40173 a025466c 0f8f6315 a5193acd | 25/30 → 10/9 (hardwiring 10/8, -node 9/8, published-types 9/9) | 100/100/100 all 3 (coord re-run; published-types/index.ts catch lines 108-110 are reached only by the 6 base-failing published-types.test.ts tests, with --coverage.reportOnFailure) | eslint 0, tsc 0, guard = base, guard self-tests 13/13 |
| L047 | devops | MERGED | 189k tok / 56 calls | 51284ca8 4d37f3cf c7a38b85 b6e7ee5a | 27/42 → 10/9 (runner 8/9, node-adapters 8/8, transforms 10/9 = untouched outputFileForUrl) | 100/100/100 all 3 (coord re-run, 15 files 189 tests, no Errors) | eslint 0, tsc 0, guard = base |
| L090 | devops | MERGED | 152k tok / 43 calls | 844ec3ba pins, 6a0f2a92 refactor | 17/26 → 9/9 (archive 7/5, imports 5/6, staging 9/9) | 100/100/100 all 3 (coord re-run, 11 files 311 tests, no Errors) | eslint 0, tsc 0, guard = base |
| L159 | devops | MERGED a02e83fb | 139k tok / 28 calls | 576a72bc pins, c5c63f02 refactor | 20/19 → 9/8 | reachability.ts 100/100/100/100 (coord re-run, 15 files 135 tests, no Errors line) | eslint 0, tsc 0, guard = base |
| L035b | cli | MERGED | 181k tok / 65 calls | 99ceca20 fae8c94c 5aa46107 db1123eb 4170524a | 27/30 → 10/7 (http 9/7, main 10/7, prompt 9/5, run-command 10/7) | 100/100/100 all 4 (coord re-run, 26 files 417 tests, no Errors) | eslint 0, tsc 0, guard = base |
| L060b | devops | MERGED | 104k tok / 23 calls | 1c519e5c 5f624866 ebc16bbe ccfd4da1 | 15/13 → 9/7 (diff 8/7, disk 5/6, integrity 9/7; commit msgs say '<=10', coord measured these) | 100/100/100 all 3 (coord re-run, 4 files 133 tests) | eslint 0, tsc 0, guard = base |
| L124-L158-L252 | devops | MERGED (2nd try) | 162k tok / 55 calls + fix agent 60k / 7 calls | 2cb1fb9d 35c6a322 27206913 aff91a8f a033f112 174dde33 31c8bb29 + fix 468ed9e6 | 26/24 → 9/9 (registry 9/8, jobs 9/9, local-dev 7/7, commit 5/3) | 100/100/100 all 4 (coord re-run, 19 files 316 tests, no Errors) | 1st merge REJECTED before push: pnpm guard showed 1 new HW3-module-state (jobs.ts module `new Map` handler table); fresh agent typed it ReadonlyMap → guard = base; eslint 0, tsc 0 |
| L035a | cli | MERGED | 145k tok / 46 calls | 93f9a23d 040ed882 6a3fbea5 60d48317 f763f91c 81b88982 | 15/21 → 10/9 (registry 6/6, daemon-url 10/3, errors 10/6, flags 9/9) | 100/100/100 all 4 (coord re-run, all 30 cli test files 572 tests, no Errors) | eslint 0, tsc 0, guard = base |

## Findings (bugs / security / cross-package)
- L159 SEC (pinned, reported not fixed): reachability.ts `classifyProbeResponse` reads 401 / GET-error bodies in full with no size cap (only the probe timeout bounds it); any 3xx counts as reachable without checking Location (not followed, so not SSRF); reachable response body never read/cancelled (connection held until GC).

## Next

- L047 deleted check (non-security, accepted): private `rewriteHtml` `if (!basePath) return html` — only caller `rewriteRouteBodyForBasePath` already returns early without basePath; pinned by "rewriteRouteBodyForBasePath leaves every body untouched without a base path".
- L047 bug (pinned): runner.ts `redirectBody` returns before cancelling the body when a redirect route answers without 3xx (stream left open).
- L047 SEC (reported): node-adapters ensureDirectory checks ancestors then opens later (only final file O_NOFOLLOW) — ancestor-swap TOCTOU, documented as needing host isolation; transforms.ts safeHref passes any http(s) Location into redirect stubs (open redirect if Location attacker-influenced).
- L035b bugs (pinned): http.ts exitForDaemonError — daemon error code that is an Object.prototype key (`toString`) passes `in exitCodes` and exit gets a function (root lookup in errors.ts, L035a); unserializable POST body (BigInt) reported as daemon-not-running without fetch.
- L035b SEC (pinned): daemon-url.ts sanitizeDaemonUrlForDisplay strips only user:password — a `?token=` query param is printed in error messages; resolveDaemonUrl accepts non-URL values (low). Auth token pinned absent from stderr on every failure path.
- L060a bug (pinned): hardwiring-node wildcard export `./*` → `./dist/*` finds no files because sourceFiles skips dist/ — entries silently drop out of the HW5 inventory.
- BASE FAILURE (not this wave): 6 tests in devops published-types.test.ts fail on unmodified base under Node 24 — packages/devops/src/checks/node.ts:23 copyDirectory uses cpSync(errorOnExist:true) and Node 24 refuses the destination createShadow pre-creates → operation-error.
- L060b: `export interface TestPass` in disk.ts unused in repo, left (public barrel) — owner decision.
- L090 bugs (pinned, fakes): staging.ts stageBundledNpm overlap check misses outDir '/' (`startsWith('//')` never matches) → step then removes '/'; same check uses path.resolve not realpath → outDir under a symlink into the npm source passes and is removed. Same '/' gap outside lot at packaging/electron/node.ts:23 copy adapter.
- L090 SEC (pinned): imports.ts undeclaredDistImports follows ../ and absolute imports outside distDir and reads them; stripNonRuntimeFiles / pruneNativePrebuilds follow a symlinked staged package and delete its coverage dir outside outDir.
- L035a removed (non-security): private `RegisteredCommand.name` (stored, never read); redundant `data !== undefined` in errors.ts (implied by the object/null check); daemon-url no-op `warn` default + `report()` closure. No URL/scheme/loopback check touched; 81-row truth table + 12,960-case temp differential.
- L035a SEC (pinned): daemon-url.ts sanitizeDaemonUrlForDisplay (~L102) unparseable-URL fallback regex stops at '/' — password containing '/' printed in full; only first '@' segment stripped (`http://u:x@y@bad host` → `http://y@bad host`, partial password leak); daemonUrlPolicyWarning gives no warning for an unparseable URL (fail-open, matches doc); policy only warns and trusts any `localhost` hostname.
- L124 removed check (non-security, accepted): listenServer trailing unreachable `throw 'Listener range exhausted'` — validListenRange refuses attempts<1 (pinned 'Invalid listener port or attempt range'), last loop pass always returns/rethrows.
- L124 note: commit 174dde33 does not typecheck alone (exactOptionalPropertyTypes); fixed by next commit 31c8bb29.
- L124 bugs/SEC (pinned, reported not fixed), registry.ts: a path policy answering differently on re-check silently drops reservedPaths/workflowPaths (fail-open); same provider id from two trusted plugins not refused (first by plugin id wins get()); catalog item with unknown state imported as trusted (fail-open). Outside lot: devops source-control/repository-target.ts:6 BRANCH_PATTERN accepts leading '-' and '..' (matters if an adapter passes branch to git argv). jobs.ts error reasons echo raw agent event JSON.
