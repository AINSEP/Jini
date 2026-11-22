PARTIAL b9e1f8cbf0 14ba5612b: DT-desktop-1 (find-menu, node-toolchain, shell-staleness, speech/{mac-on-device-transcriber,transcription-port,speech-ipc}), K5-desktop-1, AX-121.T, and the other desktop AX rows (AX-46–56, 58–88, 93–96, 101–103, 105–107, 109–119, 122–132)

# ex4-desktop: Desktop shell lane (2026-11-22)

Unattended cloud run, Opus high, no subagents.

**Result:** 15 desktop production files left Tovu. They now live in `@jini-ai/desktop-host` (12) and `@jini-ai/devops` (3). One more Jini entry, `./electron/handoff`, landed J-only.

**FILES-LEFT (scanner):**
- 2,486 → **2,480**.
- Excluding themes: 2,375 → **2,369**.
- 9 more desktop files left that the scanner counted as "keep": desktop keep went 235 → 226.

**Gates:** no new red in either repo. Every red gate and red test is BASE-RED: it fails identically on the unmodified tree.

**Mutations:** 8 named mutations, all killed.

| repo | branch | first SHA | last SHA |
|---|---|---|---|
| Tovu | `codex/ex4-desktop-tovu` | `0d7f78fa4` | `b9e1f8cbf0` |
| Jini | `codex/ex4-desktop-jini` | `4902a6a1a` | `14ba5612b` |

Codex should review every diff before merge.

## Setup
- **Node and pnpm:** Node 24.22.3 (`/opt/node24`), npm 11.19.1, pnpm 10.33.2.
- **Jini at `4902a6a1a`:**
  - `pnpm install --frozen-lockfile`: 0.
  - `pnpm --no-bail -r build`: 0, with 0 `error TS`.
  - The repo was unshallowed for `check:cross-package` (base `35c4961af`).
  - `origin/refactor/terra` was fetched for why-comments.
- **Tovu at `0d7f78fa4`:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0 for each.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 82 links.
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
- **Jini rebuilds:** after each Jini commit, only the changed package was rebuilt. The links point at the package directories, so no re-link was needed.
- **Base tree:** a clean `git worktree` at `0d7f78fa4` (`/home/user/tovu-base`) shares the main `node_modules`. Base test counts and the base scanner run used it.
- **Test runner (Tovu desktop):** `node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test <file>`. Each file ran alone under a 15-min watchdog, 3 in parallel.
- **Mutations:** each was applied to the Jini source and checked with vitest. Where the killing test stays in Tovu, it was applied to the linked Jini `dist/` file and checked with the Tovu test. Every file was restored by byte copy, checked with `cmp`, and the tests were re-run green.

## Steps

| step | files moved (Tovu → Jini) | importers repointed | tests | mutation | status |
|---|---|---|---|---|---|
| **DT-desktop-1** J `e39c65e97` / T `ae29d3c0df` | 6 of 12 → `desktop-host/src/shell/`: `find-in-page-verify`, `js-backslide-guard`, `pty-helpers`, `instance-presence`, `auto-update-controller`, `spellcheck-menu` | 20 import lines in 13 files (specifier only), listed after this table | **Moved to Jini (vitest import line only):** find-in-page-verify, js-backslide-guard, spellcheck-menu. **Stay in Tovu, repointed:** instance-presence (`t.mock.method`), auto-update-controller (`t.mock.timers`), pty-helpers (`t.after`); these need more than a one-line swap. **Must-stay-green:** find-menu 6/0, desktop-updater 32/0, sites-home-window 12/0, native-listener-disposal 3/0, preload-staleness 2/0, preload 3/0, all equal to base. preload-speech is BASE-RED (0/1, no `dist/` preload at base). | **Sheet mutation:** negating the first `if (` in `spellcheck-menu` (the removeListener guard). Jini's spellcheck test **survives** it (12/0). Tovu's `native-listener-disposal.test` **kills** it through the linked dist (2/1), restored 3/0. **Fallback (first exported function has no `if`):** `maxSuggestions` 5→4 is killed by the Jini spellcheck test (11/1). | **PARTIAL**: 6 skipped, see below |
| **AX-97/98** J `ded1abb56` / T `ae29d3c0df` | `selftest-tracker.ts` → `desktop-host/src/electron/selftest/` (new entry `./electron/selftest`) | `main/boot/boot-failure.ts`, `main/index.ts` | selftest-tracker test moved (7/0). boot-failure.test 8/0, the same as base. | Dropping the `failed ||` guard: duplicate-settlement test red (6/1), restored | DONE for the tracker. `boot-failure.ts` stays: the host owns the failure decision and exit reporting (D17). |
| **AX-91/92** (D15, verbatim-move variant) J `eeb1d17aa` / T `68343b5ff6` | `window-navigation-policy`, `webview-guest-policy`, `window-bounds-store` → `desktop-host/src/shell/` | 9 files (specifier only) | window-bounds-store test moved (13 tests). **Stay in Tovu:** webview-guest-policy.test (reads the host preload source), window-navigation-policy.test (uses website callback page and guest-navigation). app-window 8/0, guest-navigation 8/0, sites-home-window 12/0, webview-guest-policy 10/0, window-navigation-policy 31/0. | **Jini:** `readWindowBounds` returning null → 2 restore tests red. **Tovu, linked dist:** disabling the required-preload throw → webview-guest-policy.test 9/1. Both restored. | DONE (see finding F3) |
| **AX-99/100** (D18, part) J `d70fcd0b4` / T `afb0939b26` | `quality-gates`, `complexity-debt`, `live-verify-checks` → `devops/src/checks/` (`./checks/*`) | `scripts/{check-gates,check-complexity,verify-find-in-page,verify-site-power}.ts`; removed 1 stale HW5 row in `hardwiring-debt.json` | 3 tests moved (44 tests). Desktop `check-complexity.ts` equals base apart from the file count (275→262). | `isFailure` accepting an unknown exit code → null-exit test red (24/1), restored | DONE for these three. `admin-dev-proxy` stays (TOVU_* env contract). `move-to-applications` not attempted (needs durable-json K5). |
| **AX-89/90** (D14, part) J `bd97a47e6` / T `77ad56a027` | `main/windows/guest-navigation.ts` → `desktop-host/src/shell/guest-navigation.ts` | `main/index.ts`, `window-navigation-policy.test.ts` | guest-navigation test moved (8) | Applying the policy to non-webview contents → 1 red, restored | DONE for guest-navigation. `app-window` (default title `"Tovu"`) and `dock-icon` (product log copy) stay: K3 copy with no injection decision. |
| **AX-104/108** (D20, part) J `bd97a47e6` / T `77ad56a027` | `project-ipc.presence.ts` → `desktop-host/src/shell/site-presence.ts` (entry `./shell/site-presence`) | `project-ipc.ts`, `project-ipc.types.ts`, `project-ipc.test.ts` | No test of its own; covered by Tovu `project-ipc.test` 159/0, the same as base | **Linked dist:** removing `owners.delete(sender)` → project-ipc.test 156/3, restored 159/0 | DONE for presence |
| **AX-120** J `14ba5612b` | none (new Jini entry `./electron/handoff`: `registerHandoffForwarding`, Tovu's `import-handoff-ipc` body verbatim, with channels, parser and refusal copy injected as fields) | — | New vitest (4 tests, neutral data) | Letting an untrusted sender through → refusal test red (3/1), restored | J DONE |
| **AX-121** T | — | — | — | — | **BLOCKED and reverted (not committed).** `import-handoff-ipc.test.ts:105` pins `main/index.ts` source with `/sitesHomeWindows/`. The Jini field is `windows`. Changing that assertion is outside the step contract. Owner/Codex: approve the one-regex update, then T is ready: about 4 lines in `main/index.ts`, the refusal constant moves to `contracts/import-handoff.ts`, and the test's two register calls gain the host bindings. |
| **K5-desktop-1** | — | — | — | — | **SKIPPED, prerequisite not landed.** K4-seam-17/18 are not in the Jini base: no `core/contracts/site/{packaging-electron,platform-process}` and no resources/durable-json DTOs. Also, every one of its 5 files is a host binding of host policy: the `desktop-v*` release-tag convention, the `"tovu desktop"` lock notices, and the deployed Find channels (K01). |

The 20 DT-desktop-1 importer lines, in 13 files:
- `scripts/verify-find-in-page.ts`: 2
- `scripts/check-js-backslide.ts`: 1, plus 4 comment citations
- `scripts/verify-package.ts`: 1
- `stage-payload-lib.ts`: 1
- `main/index.ts`: 2
- `main/updates/desktop-updater.ts`: 2
- `desktop-updater.test.ts`: 1
- `main/windows/sites-home-window.ts`: 1
- `sites-home-window.test.ts`: 1
- `native-listener-disposal.test.ts`: 2
- `instance-presence.test.ts`: 1
- `auto-update-controller.test.ts`: 3
- `pty-helpers.test.ts`: 1

Two more edits go with them:
- `verify-package-cli.test.ts`: the closure fixture no longer copies the deleted `src/pty-helpers.ts`. `verify-package.ts` now loads it from the linked `node_modules`. The test is 12/0, the same as base.
- `quality-gates.json`: the `_comment` citation was updated.

The Jini packaging follows the same pattern in every step:
- Every new entry has the dist triple, a `jini.entries` runtime, a changeset `.changeset/p9-*.md` (patch) and `pnpm api:update`. Only added entries appear in `api-baseline/jini-ai__{desktop-host,devops}.json`.
- The `./shell/*` files that bind `electron/*` declare `jini.isolation.entries` = `electron`. Without it the guard's SI-domain rule fails, because the default domain is the first segment, `shell`.
- `/tovu/i` and `apps/…` comment words became "the host" / "the host's desktop app". No runtime literal was renamed, so there are **no P9-BREAKS rows**.

**Why-comments:** 15 moved blocks were recorded in `development/why-comments-debt.json`, each with its Jini destination and commit (Tovu `b9e1f8cbf0`). `check:why-comments` is back to the base set of 80.

## Steps skipped and why

**DT-desktop-1, 6 of 12 files left in Tovu:**
- `find-menu.ts`: it defines the deployed `runner:find:toggle` channel literal. P9K-combined K01/D1 rejects moving deployed Find channels. Its reusable half is already `desktop-host/electron/usability` `findMenu`.
- `node-toolchain.ts`: it names `TOVU_NODE_TOOLCHAIN_DIR` and `TOVU_BUNDLED_NPM_ROOT`, a cross-process contract with the MCP stdio launch resolver, plus the generated-launcher banner.
  - The sheet says to rename these literals to the jini form. That would silently send children to system tooling.
  - The sheet also says never to inject product strings.
  - **Owner decision needed.**
- `speech/speech-ipc.ts`, `speech/transcription-port.ts` and `speech/mac-on-device-transcriber.ts`:
  - `"tovu:speech"` is the IPC namespace shared with `preload-speech.cts`.
  - `DEFAULT_BINARY_PATH` resolves `tovu-speech-helper` relative to the module's own `dirname`. Moving the file into Jini `dist/` changes that path.
  - They also hold product error copy.
  - Renaming breaks the ABI, and injecting is forbidden by the sheet. **Owner decision needed.** The reusable halves already exist in `desktop-host/speech`.
  - The listed test `native-speech-adapter.test.ts` stays with them.
- `shell-staleness.ts`: it collides with Jini `devops/packaging/electron/policies.ts` (`isBundleInput`, `shellStalenessFailure`), which behaves differently:
  - The Jini version has a shorter message.
  - It treats a leading `__measurements__/` segment differently.
  - This is STOP 4. A DEDUPE needs a choice of which message wins.

**Other audit rows not done:**
- **AX-57 (D5):**
  - `folder-drop.ts` is a dead duplicate: production already uses `@jini-ai/ui/core` `folderPathsFromDataTransfer`.
  - Its 10 tests call the old `getPathForFile` shape, and `@jini-ai/ui` has no rules-level test of its own. Moving or repointing would need a call-shape test edit.
  - `Spinner.tsx` → `ui` `Spinner` changes markup and the accessible name.
  - Both are listed, not done.
- **AX-53–56, 58–68, 79, 87, 105, 107, 109–111, 118–121 renderer hooks:** `@jini-ai/desktop-host` has no React dependency. These hooks need either a new dependency (a lockfile change) or a decision to target `@jini-ai/ui`.
- **The rest:** not attempted in this run because of the call budget. Most also wait on prerequisites:
  - BX-19/20 for AX-114/115/128/129.
  - AX-81/82 for AX-86–88.
  - K5-desktop-1 / durable-json for AX-93–96, 101/102 and 118/119.

## FILES-LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, Jini linked)

| tree | moving | shells | **FILES-LEFT** | themes excluded (`theme` 86 + `adm-themes` 25) | desktop src (Jini-bound) | desktop keep |
|---|---|---|---|---|---|---|
| base `0d7f78fa4` | 2,483 | 3 | **2,486** | **2,375** | 17 | 235 |
| tip `b9e1f8cbf0` | 2,477 | 3 | **2,480** | **2,369** | 11 | 226 |

−6 Jini-bound plus −9 scanner-"keep" files = the 15 production files deleted. The audit ADD rows (AX-89/91/97/99/104) cover files the scanner still classes as desktop STAYS.

## Gates (base-diff; raw logs in the run's scratchpad, summarised here)

### Jini, tip `14ba5612b`
| gate | base `4902a6a1a` | tip | verdict |
|---|---|---|---|
| build (desktop-host, devops) | 0 | 0 | equal |
| guard | 0 | 0 | equal |
| typecheck | 0 | 0 | equal |
| api:check | 0 | 0 | equal |
| check:hooks | 0 | 0 | equal |
| check:size | 1 | 1 | equal set (daemon `createAgentExecutor` worsened + 3 stale sidecar rows) |
| check:complexity | 1 | 1 | equal set (4 base violations) |
| check:why-comments | 1 | 1 | equal set (10 base blocks) |
| check:cross-package (XP) | 1 | 1 | equal set (3 base XP5 rows) |
| desktop-host vitest | 749 / 0 (1 skipped) | **807 / 0** (1 skipped) | +58 tests |
| devops vitest | — | **1,375 / 0** | all green |

### Tovu, tip `b9e1f8cbf0`
| gate | base | tip | verdict |
|---|---|---|---|
| typecheck | 0 | 0 | equal |
| typecheck:tests | 0 | 0 | equal |
| typecheck:scripts | 2 | 2 | equal (same 3 `error TS`) |
| check:boundaries | 0 | 0 | equal |
| check:size | 1 | 1 | equal (3 base worsened rows) |
| check:complexity | 0 | 0 | equal |
| check:hooks | 0 | 0 | equal |
| check:architecture | 1 | 1 | equal (1 base metric) |
| check:errors | 0 | 0 | equal |
| check:why-comments | 1 (80) | 1 (80) | equal set, after 15 "Moved to Jini" rows |
| desktop typecheck (tsc ×4) | 0 | 0 | equal |
| admin tsc | 2 | 2 | equal (same 4 `error TS`, `jini-kits.ts`/`main.tsx` vs linked Jini merge-14 kit types) |
| hardwiring (`check-hardwiring.mjs`) | 1 | 1 | improved: HW5 41 → 21; the "14 stale debt" count is unchanged |
| desktop `npm test`, node half | 2,205 / 3 of 2,218 | 2,103 / 3 of 2,116 | the 3 are BASE-RED (root-user chmod tests in `site-child-registry`, `site-dir-store`, `tracked-sites`). −102 tests = exactly the tests that moved to Jini |
| desktop renderer half | 912 / 2 | 912 / 2 | equal: the same 2 BASE-RED tests (`use-site-folders` dropdown, `use-workspace-chat-pane` raw primitives) |
| desktop check-complexity | 1 (3 NEW) | 1 (3 NEW) | equal set |

The desktop `npm test` chain stops after the node half fails. The renderer half was therefore run separately at base and tip, with the same command line.

## Findings (listed, not fixed)
- **F1 (coverage gap):** for some moved files, the only tests stay in Tovu because they use `t.mock`/`t.after`, or the code has no test of its own:
  - `shell/{instance-presence,auto-update-controller,pty-helpers,webview-guest-policy,window-navigation-policy,site-presence}`.
  - `desktop-host` `test:coverage` (100% thresholds) will report these. Porting those Tovu tests to vitest needs more than an import-line edit.
- **F2:** Jini's `spellcheck-menu` test does not cover the native listener disposal guard. Only Tovu `native-listener-disposal.test` kills that mutation.
- **F3 (for Codex):**
  - D15 says DEDUPE onto the current `electron/*` APIs. This run moved the host adapters verbatim, as DT-desktop-1 does.
  - As a result, `desktop-host/shell/*` now holds positional-to-object adapters over `electron/*`, and several basenames are duplicated (`shell/window-navigation-policy` vs `electron/navigation-policy/window-navigation-policy`).
  - If the owner prefers the DEDUPE shape, the Tovu callers should call `electron/*` directly and `shell/*` should shrink.
- **F4:** on `webview-guest-policy`, a weaker mutation survived: `preloadPath.length === 0` → `=== 1`. No test passes an empty-string preload path.
- **F5:** HW5 false positive: `validateManifest` was matched to `@jini-ai/plugins`' unrelated function. The stale debt row was removed with the move.
- **F6:** comments that cite now-moved Tovu paths remain in:
  - `.github/workflows/desktop-release.yml:25`
  - `apps/desktop/electron-builder.yml:140`
  - `apps/desktop/src/main/windows/{app-window,sites-home-window}.ts`
  - `apps/desktop/src/speech/preload-speech.cts:20`
  - `development/e2e/desktop/settings.desktop.ts:16`
  - `contracts/import-handoff.ts:10` (cites `import-handoff-ipc.ts`, which is still present)
- **F7 (environment):** admin tsc and typecheck:scripts are red at base with Jini merge-14 linked. combine-13 recorded admin tsc green with merge-13. The cause is kit type drift (`Icon`, `useT`, `values` now required in `AdminKit`). It is not caused by this lane.
- **F8:** `preload-speech.test` is red on a fresh tree until `npm run build:preload` has run. `npm test`'s `pretest` builds it.

## Owner decisions
1. **node-toolchain and speech/*:** keep them as host bindings (reclassify as STAYS), or allow host-injected product literals, or approve a coordinated `TOVU_*` → `JINI_*` / `tovu:speech` → `jini:speech` rename with the preload and MCP resolver.
2. **shell-staleness:** which staleness message wins (the host's long message or Jini devops' short one) for the DEDUPE.
3. **AX-121:** approve updating the `/sitesHomeWindows/` source-pin regex in `import-handoff-ipc.test.ts`.
4. **D15 shape (F3):** keep the `shell/*` verbatim adapters, or DEDUPE the callers onto `electron/*`.
5. **Renderer hooks (AX-53/55/62/64/118/120 …):** add a React peer to `desktop-host` (a lockfile change), or target `@jini-ai/ui`.

## Commits
**Jini `codex/ex4-desktop-jini`, base `4902a6a1a`:**
- `e39c65e97` DT-desktop-1.J
- `ded1abb56` AX-97.J
- `eeb1d17aa` AX-91.J
- `d70fcd0b4` AX-99.J
- `bd97a47e6` AX-89.J + AX-104.J
- `14ba5612b` AX-120.J
- the copy of this report (next commit)

**Tovu `codex/ex4-desktop-tovu`, base `0d7f78fa4`:**
- `ae29d3c0df` DT-desktop-1.T + AX-98.T
- `68343b5ff6` AX-92.T
- `afb0939b26` AX-100.T
- `77ad56a027` AX-90.T + AX-108.T
- `b9e1f8cbf0` why-comments rows
- this report (next commit)
