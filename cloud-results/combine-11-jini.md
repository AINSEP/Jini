**`integ/merge-11-2026-11-21` @ `373c4b7e`** (last content commit; the commit on top only adds this report) · **READY TO PUBLISH: YES** for `0.7.3-next.2`. Nothing new is red in build, typecheck, guard, plugin guards, the packed guard, the publish plan or the package suites. The open reds are all BASE-RED, plus 1 new why-comments ratchet row from deps-1121 and 3 script tests that time out only under load. All are listed below. The coordinator pushes the tag.

# combine-11 JINI (2026-11-21): `integ/merge-11-2026-11-21`

Unattended cloud run, 19:01–~20:45 UTC (about 1 h 45 m of the 3.5 h cap). Branch created from `origin/integ/merge-10-2026-11-21` (`de4e555b9`). Node v24 (`/opt/node24`), pnpm 10.33.2 (corepack).
- **Not used:** subagents, codebase-memory tools, force-push, `--no-verify`, `git pull --rebase`, publish, tags.
- **Pushed:** only this branch, always as a plain push after `fetch` plus `merge-base --is-ancestor`. The remote never moved.
- **Untouched:** `main`, `refactor/terra`, `plan/*`, `release/*`. `origin/main` and `refactor/terra` were only fetched (main to merge it, terra as the why-comments default base). Tovu `plan/commit-plans-1120` was only read.

**Summary: all 8 merges are done, nothing left.**
- **Conflicts:** none in merges 1–7. `origin/main` (merge 8) had 47 conflicts, all resolved (table).
- **Sheet tests:** every new or changed test passes after the merge.
- **Mutations:** 27 named by the sheets. **25 ran and all 25 are RED.** The 2 that need GitHub Actions are NOT-RUN (ci J1, J2). ci J3 and both J4 mutations ran as local stand-ins and are RED.
- **Final tree:**
  - Build: full `-r build` 0 (0 `error TS`).
  - Typecheck: full 0, scripts tsc 0.
  - Guard: 0.
  - `api:check`: 0 after `api:update`. The change is additive (3 cms subpaths, optional fields).
  - Plugin guards: `guard:plugins` 0, `guard:plugins:packed` 0, `guard:plugins:catalog` 68/68.
  - Ratchets: identical to base except **1 new why-comments row** (deps-1121 deleted the comment of the Vitest-2 polyfill it removed). Listed, not fixed.
  - Error gate: 24 New + 1 Worse, identical to base (all BASE-RED), so `--update` was NOT run.
- **Full suites (50 packages/examples):** counts equal deps-1121's final run plus the new sheet tests. Reds are BASE-RED only, after **1 fix commit**: the cms `subpath-isolation` contract timed out under Vitest 3. It got the same 60 s timeout deps-1121 gave core's twin test.
- **Catalog drift:** 1 row (jx-gh `commit-site.mjs`), committed.
- **Release prep:** all **41** public packages pack differently from their **npm** `0.7.3-next.1` tarballs (file-by-file comparison), so all 41 are now `0.7.3-next.2`. `publish-pending --plan`: 41 of 41 pending. A packed-candidate consumer install of the 41 next.2 tarballs passes the jx-ci J4 assertions and imports the 3 new w4 subpaths.

## Method
- **Setup / base first** (unmodified `de4e555b9`):
  - `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (0 `error TS`).
  - Typecheck 0 + scripts tsc 0; `pnpm guard` 0; `api:check` 0.
  - Every ratchet gate recorded in `combine-11-jini-raw/gates-base/`. The base equals combine-10's final state exactly (list below).
- **Sheets read before merging**: Tovu `origin/plan/commit-plans-1120` `commit-plans/jx-{w4,w5,proto,gh,w6,ci}.{COMMIT-PLAN,REFRESH,report}.md`; `cloud-results/combine-10-jini.md`; `deps-1121-jini.md` (on the deps branch). The `r62t-*.plan.md` sheets were not needed beyond the COMMIT-PLANs, which name every mutation.
- **Merges**: `git merge --no-ff`, in the given order, in the main tree. Gates after each merge (`combine-11-jini-raw/gates-m<N>/`):
  - `pnpm --no-bail --filter "...[<pre-merge>]" build`;
  - `tsc -p tsconfig.json --noEmit` in each changed package (+ scripts tsc when `scripts/` changed);
  - `pnpm guard`;
  - `SIZE_BASE_REF=de4e555b9 check-size`; `COMPLEXITY_BASE_REF=de4e555b9 check-complexity`;
  - `check-hook-injection`; `check-why-comments --base de4e555b9` and default (terra);
  - `check-log-safety`; `check-error-gate`.

  Each run was diffed against base. Sheet tests and mutations ran right after each merge.
- **Mutations**: one plant per run (perl substitution or JSON edit). The file was restored with `git checkout` (or a byte-copy for the consumer archive), and each diff is recorded with its result in `mutations.txt`.
- **Debt files**: none changed on any merged side, so no 3-way merge was needed. No debt file was edited.
- **Clean reinstall after merge 1**: deps-1121 changed `pnpm-workspace.yaml` `hoistPattern` (`!@types/jsdom`). An incremental `pnpm install --frozen-lockfile` did **not** apply it, and `@types/jsdom` stayed hoisted. All `node_modules` were removed and reinstalled frozen, which matches a fresh clone. Every later step ran on that tree.
- **Full suites**: separate worktree `/home/user/jt11` at `7e55920c` (fresh frozen install 0, `pnpm --no-bail -r build` 0, 0 `error TS`). Each package ran `npm run test -- --maxWorkers=2 --minWorkers=1` (commerce and search set workers themselves). Package source differs from the tip only by catalog/versions and the cms test-timeout fix, which was re-run separately.
- **Tarball comparison**: `pnpm pack` of all 41 public packages (main tree, current builds) vs `npm pack <name>@0.7.3-next.1` from the registry, compared file by file with `package.json` key-sorted (`pack-canon.mjs`, `pack-diff-vs-npm.txt`). next.1 has no git tag, so the registry is the reference.

## Base (`de4e555b9`), identical to combine-10's final state
| gate | base |
|---|---|
| build | 0, 0 `error TS` |
| typecheck (+scripts) | 0 / 0 |
| guard | 0 (HW3 34, 0 new; HW9 env 70, 0 new; advisory 491) |
| size | **BASE-RED** 3 lines: `cms/src/redirects/redirects.ts (513)` and `launch.ts (952)` / `createAgentExecutor (418)` |
| complexity | **BASE-RED** 4 (`handleRpcError 12`, `drainRunFramesToAgUi 12`, `readConfirmationResume 11`, `ErrorNotice 11`) |
| hooks | 0 |
| why-comments `--base de4e555b9` | 0 |
| why-comments default (terra) | **BASE-RED** 4 not allow-listed |
| log-safety | **BASE-RED** 10 lines |
| error gate | 0 WARN, **BASE-RED** 24 New + 1 Worse (`diagnostics/.../fanout.ts 7 -> 8`), 11 improved |
| api:check | 0 |

## Per branch
| # | branch (tip) | merge commit | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | `origin/deps/lockfile-1121` `1befd8179` | `8c3cff49` | none | Filtered build 0, tsc 0 (40 packages), guard 0. **why-comments NEW row** (`--base` 1 lost; default 4 → 5): `packages/admin/src/comments/__tests__/test-runner.ts:10-11 [8559987223a2]`. deps fix 6 removed the Vitest-2 polyfill, and its comment went with it. The comment is obsolete. LISTED (debt row or accept). Hoist config needed a clean reinstall (Method). | — | GREEN (1 listed ratchet row) |
| 2 | `codex/jx-w4` `c495a1e85` | `eeb23199` | none | none (build 0, tsc cms 0, ratchets = merge 1) | — | GREEN |
| 3 | `codex/jx-w5` `e849c74d7` | `6d8fe175` | none | none (tsc agent-plugins/core/plugins 0) | — | GREEN |
| 4 | `codex/jx-proto` `7bfd293f7` | `0d27312f` | none | none (tsc agent-runtime/chat/daemon 0; complexity unchanged; the base `handleRpcError` row is still the only one in that file) | — | GREEN |
| 5 | `codex/jx-gh` `e066cb6f0` | `c3defe3e` | none | none (tsc agent-plugins 0); catalog integrity drift, committed `e70b25be` | — | GREEN |
| 6 | `codex/jx-w6` `4812c63e1` | `f4a3db41` | none | none. Filtered build exit 1 = `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` (only `scripts/` changed), not a red. scripts tsc 0. | — | GREEN |
| 7 | `codex/jx-ci` `e12b8dace` | `bafdbf0d` | none | none. YAML parses for all 4 workflows (`js-yaml`). Every referenced script exists: `quality:{sonar,knip,depcruise,properties}`, `test:scripts:node`, `guard:plugins{,:catalog,:packed}`, `scripts/publish-pending.ts`. So do `scripts/lib/pack-jini-packages.ts` with `assertJiniPackagePublicationAllowed({name})` / `discoverJiniPackages({workspaceRoot})` → `{dir,pkg}`, the exports `@jini-ai/cms/presentation/html` and `@jini-ai/agent-plugins/cloudflare/lib/forms.mjs` (`./cloudflare/*`), `steps.build` (`id: build`), and branch `general-work`. Actions not triggered. | — | GREEN |
| 8 | `origin/main` `131a68bd7` (merge base `f6fa96ae3`) | `76be2178` | **47 conflicts.** (a) 45 `package.json` version/range hunks, 3 provider-plugins README "npm release is" lines, both `catalog.json` files, `pnpm-lock.yaml`: **integ side** (the 0.7.3-next line; catalogs regenerated and versions bumped in release prep). Auto-merged hunks were kept: main's 0.7.2 CHANGELOG sections, private example version bumps, `plugin-fixture-provider` (private) → 0.7.2. (b) `chat/src/react/components/MessageList.tsx`: main's up/down `JumpArrow` (`scrollable`/`jumpToTop`) is wired through integ's injected `hooks.useMessageListAutoScroll`. Integ's `useTHook` injection stays on the new `JumpArrow`. | none. Frozen install 0 on the resolved lockfile; build 0; tsc 0; ratchets = merge 1. MessageList tests 67/67 (jump-to-latest 7/7, hook-injection sweep2 16/16). | — | GREEN |

After all merges: `7e55920c` = `api:update` + gate outputs · `e70b25be` = catalog drift · `6c207c90` = `chore(release): 0.7.3-next.2` · `373c4b7e` = cms test timeout fix.

## Per-sheet tests and mutations
Raw: `combine-11-jini-raw/sheet-tests.txt`, `mutations.txt` (each plant's diff and result). Every listed mutation was run separately and restored.
| sheet | new/changed tests after merge | named mutation → result |
|---|---|---|
| w4 WORKER-JINI (cms narrow exports) | `cms integration-package.contract.test.ts` 5/5 (+1). Self-import from the source tree and **packed-candidate** import of `renderHtmlTaxonomy` / `fieldMaxChars` / `renderMediaRawHtml`: all `function` | remove `./taxonomy/render-entry` → **RED**; remove `./forms/field-length-caps` → **RED**; remove `./widgets/html/media-html` → **RED** (each fails the new case + "keeps exports and entry runtime metadata synchronized") |
| w5 GATE-ABORT-J | `core gateway.test.ts` 31/31 (+3) | remove confirm check → **RED** ("abort during confirm authorization skips token save"); move execute check above `computePlan` → **RED** ("abort during final plan verification leaves the token minted"); signal check between redemption and `executeMutation` → **RED** ("abort after redemption still applies the verified plan") |
| w5 tv-rjk T2-J | `core plugin-directory.test.ts` 46/46 (+3) | remove legacy selection → **RED** ("reads a legacy identity extension only when explicitly configured"); select legacy first → **RED** (2: null-current refusal + current precedence); nullish selection (`??`) → **RED** ("refuses a null current extension even when the legacy extension is valid") |
| proto AG-J1 | `chat run-frames.test.ts` 6/6 (extended) | remove `closeAgUiRun` emission → **RED**; remove early return → **RED** |
| proto AG-J2 | `daemon frontend-session-ag-ui.test.ts` 5/5 (extended) | remove `entry.runId !== runId` → **RED**; remove run-binding guard → **RED** |
| proto ACP-J1 | `agent-runtime session.test.ts` 140/140 (+1) | bypass initialize refusal → **RED** ("closes the ACP child when initialize reports an unsupported version") |
| proto ACP-J2 | `agent-runtime models.test.ts` 63/63 (+1 by parameterization) | bypass probe refusal → **RED** ("negotiates ACP protocol version 2 before model discovery") |
| gh GH-J1 | `agent-plugins github/source-control/__tests__/commit-site.test.mjs` (node:test) 9/9 (6 → 9) | skip predecessor read → **RED** (missing-canonical case); empty canonical treated as absence → **RED** (empty-canonical precedence); fallback broadened to any non-OK → **RED** (rejected-canonical case) |
| w6 J-RATCHET | `scripts/__tests__/check-error-gate.test.ts` 107/107 (+4) | write before growth refusal → **RED**; remove scoped refusal → **RED**; reject a legitimate shrink → **RED**; assume ledger exists → **RED** |
| ci J1 / J2 | workflow only | **NOT-RUN** (need GitHub Actions: `guard:drift` forced to exit 1 must fail the summary; failing Vitest must still run the Node scripts) |
| ci J3 | workflow only | local stand-in: provider-plugins export `./catalog` → missing target, then `guard:plugins:packed` → **RED** (`exported paths missing from tarball: ./catalog-missing.json`) |
| ci J4 | workflow only. Local stand-in of the "Install and import candidate" step on the 41 next.2 tarballs: `npm install` 0 (241 packages, 133 MB); 41 `@jini-ai/*` lock entries all `file:` candidate archives, version `0.7.3-next.2`; imports `cms/presentation/html` and `agent-plugins/cloudflare/lib/forms.mjs` pass (`packed-consumer-check.{mjs,txt}`) | remove the `./presentation/html` export from the installed cms archive → **RED** (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Omit the cms-forms archive → install **still exits 0** (nothing depends on the deprecated `@jini-ai/cms-forms`), so the rejection comes **only** from the explicit presence assertion → **RED** ("Nested CMS forms must be installed from the candidate") |
| main (chat jump button) | `MessageList.*` 67/67 | no sheet |

API-baseline rows the sheets name were all observed in `api:check` (below).

## Decisions for the owner
1. **why-comments row** `admin/src/comments/__tests__/test-runner.ts:10-11 [8559987223a2]` (deps-1121 fix 6 removed the polyfill and its comment). The comment is truly obsolete, so add a debt row `{ "id": "8559987223a2", "reason": "Vitest 3 ships toHaveBeenCalledExactlyOnceWith; the polyfill it explained is gone (deps-1121)" }`, or accept. Not edited here.
2. **Vitest 3 now times out repo-wide subpath audits** (deps-1121 class, fix 8). `auditSubpathIsolation` takes ~12.5 s on this host whatever the cms manifest is (base manifest timed the same; 0 findings).
   - Fixed (it blocked a merged sheet package's suite): `cms subpath-isolation.contract.test.ts` gets `60_000`, exactly like core's twin (`373c4b7e`).
   - **Not fixed (scripts tests, no sheet):** `check-error-disclosure-callers` "the real tree has no caller outside the reviewed lists"; `fetch-query-isolation` "keeps TanStack out of the default runtime closure…"; `leaf-import-closures` "keeps SEO and its HTTP adapter free of React…"; and `coupling-isolation`'s `beforeAll` (10 s hook).
   - With `--testTimeout=180000 --hookTimeout=180000` these pass. The only real failures left are coupling-isolation's 6 BASE-RED cases (`scripts-vitest-longtimeout.txt`).
   - CI's nightly `pnpm exec vitest run scripts/__tests__` will show these timeouts. The same 60 s timeouts would fix them.
3. **jx-ci J1 narrows CI**: `push: branches: [main]`, `pull_request: branches: [main, general-work]`. Pushes to `integ/*`, `deps/*` and `codex/*` no longer run CI, and the report-only quality steps move to nightly. Confirm the required-status settings and the default-branch rollout (sheet). J1/J2 cloud proofs are still owed.
4. **jx-ci J4 forms check**: in a real consumer install, nothing pulls `@jini-ai/cms-forms`. The workflow's explicit presence assertion is what catches an omitted archive (verified), not "resolution rejection" as the sheet words it.
5. **Release scope**: all 41 public packages differ from npm next.1 (`pack-diff-vs-npm.txt`). Every one has main's 0.7.2 CHANGELOG section and/or deps-1121 `package.json` changes, and most have changed `dist`. Code-level differences include merge-10's work, so next.1 was **not** cut from merge-10, consistent with combine-10 decision 7. Notable runtime changes:
   - protocol and ui ship `zod/v3` imports with `zod ^4.6.6`;
   - core: gated-mutation `signal`, `legacyNamespace`;
   - cms: 3 subpaths;
   - agent-runtime: ACP version refusal;
   - plugins: legacy identity namespace;
   - agent-plugins: GitHub predecessor ownership;
   - chat: jump arrow.

   A semantics-only bump list does not exist: every tarball differs.
6. **cms-forms `package-boundary` (BASE-RED, changed text)** now reads `expected '0.7.2' to be '0.7.3-next.1'`, because main's 0.7.2 CHANGELOG heading is now on top. Note: the test's `^## (\d+\.\d+\.\d+)\b` cannot match a prerelease heading as a whole (`0.7.3-next.2` → `0.7.3`). Even a next.2 CHANGELOG heading would not turn it green without changing the regex. Carry-over of combine-9 decision 5.
7. **Carry-overs unchanged**: combine-10 decisions 1 (engaps J4 makes 4 provider-plugins tests time out; still red), 2 (redirects.ts 513), 3 (fanout Worse), 4, 5, 8 (`pnpm pack` key order), 9; combine-9 decisions 2–5.
8. **J-RATCHET makes error-gate `--update` refuse growth.** With 24 New + 1 Worse on the tree, `check-error-gate --update` now exits 1 without writing. This run used `--update` only under the "0 New and 0 Worse" rule, so the gate was not updated. Cleaning the 25 rows, or deciding to accept them, is now a prerequisite for any baseline refresh.
9. **w4's commit title** names "legacy plugin identity namespace read", but its tree contains only WORKER-JINI. T2-J landed in jx-w5 (as its sheet says). This is a cosmetic history note.

## Final gates (at `373c4b7e`; the release commit `6c207c90` was gated, and the later commit only changes a cms test timeout)
| command | base `de4e555b9` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (main tree after the version bump; also 0 in fresh worktree `jt11` at `7e55920c`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 `error TS`) |
| `pnpm guard` | 0 (HW3 34; HW9 env 70; advisory 491) | **0** (HW3 34, 0 new; HW9 env 70, 0 new; advisory 491) |
| size | 1, 3 lines | **1, identical 3 lines** (BASE-RED) |
| complexity | 1, 4 | **1, identical 4** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base de4e555b9` | 0 | **1, NEW**: 1 lost (`test-runner.ts:10-11 [8559987223a2]`, decision 1) |
| why-comments default (terra) | 1, 4 not allow-listed | **1, 5 not allow-listed** = base 4 + the same row |
| log-safety | 1, 10 lines | **1, identical 10** (BASE-RED) |
| error gate | 0 WARN, 24 New + 1 Worse | **0 WARN, identical 24 New + 1 Worse** (BASE-RED), 11 improved → `--update` **not run** |
| `pnpm api:check` | 0 | **0** (after `api:update` in `7e55920c`; 40 packages, 680 entries, 17204 symbols) |
| `guard:plugins` / `guard:plugins:packed` / `guard:plugins:catalog` | — | **0 / 0 / 0 (68/68)**, before and after the version bump |
| `pnpm install --frozen-lockfile` | 0 | **0** |

Every final line of the BASE-RED ratchets is identical to `combine-10-jini.md` "Final gates" (same files, same values). Raw: `combine-11-jini-raw/gates-final/`.

## Tests
Full suites (`combine-11-jini-raw/suites/_summary.txt`, `reds-and-counts.txt`):
| suite | combine-11 | deps-1121 final | Δ |
|---|---|---|---|
| core | 2953/2953 | 2947 | +6 (w5 +3 gateway, +3 plugin-directory) |
| plugins | 1017/1017 | 1017 | = |
| agent-plugins | 2188 + 2 skipped (vitest) + commit-site node:test 9/9 | 2188 | = (gh tests are node:test, 6 → 9) |
| cms | **2 failed** / 5008 (5010) | 2 failed / 5007 (5009) | +1 (w4). Reds: forms `package-boundary` (BASE-RED); `subpath-isolation` timeout (fixed in `373c4b7e`, 1/1 green at 13.2 s). The base pglite timeout passed this run. |
| cms/forms | **1 failed** / 156 (157) | same | = (BASE-RED `package-boundary`) |
| chat | 4489 + 1 skipped (4490) | 4486 + 1 | +3 (main's jump-to-latest cases) |
| daemon | 4854 + 1 skipped | same | = (AG-J2 extended an existing case) |
| agent-runtime | 4539 + 1 skipped (4540) | 4537 + 1 | +2 (ACP-J1 +1, ACP-J2 +1) |
| provider-plugins | **4 failed** / 914 (918) | same | = (BASE-RED engaps J4 timeouts) |
| examples/neutral-host | **1 failed** / 38 / 13 todo | same | = (BASE-RED contribution contracts) |
| plugin-fixture-provider | **1 failed** / 1 | same | = (BASE-RED) |
| examples/reference-web | 54/54 vitest; `node --test e2e` **3 fail** (`playwright` not installed) | same | = (BASE-RED) |
| all other 38 (admin 3074, agentic 1149, analytics 226, artifacts 242, capability-providers 198, cli 605, commerce 11 + 1421/1 skip, cookie-consent 221, db 950, desktop-host 749/1, devops 1327, diagnostics 1090, http-kit 750, infra 155, integration-tests 0, integrations 2077, mcp 1885, memory 409, node-adapters 35, oauth 824, platform 3354/6, plugin-catalog 68, protocol 794, registry 392, sandbox 179, search 371, server 469/1, sidecar 408/3, sqlite 10, ui 8818, ui-kit 232, user-management 1353, vibecoding 364, minimal-host 3, nlweb-demo 18, notes-app 0, reference-desktop 4) | green | equal | = |
| `vitest run scripts/__tests__` (main tree, final) | **9 files failed**: 9 failed / 982 passed / 54 skipped (1045) | combine-10: 14 failed / 1000 / 33 (1047, Vitest 2) | see below |
| `test:scripts:node` | **3 failed** / 43 (46) | not run in combine-10 | see below |

Every red line:
- **provider-plugins (4, BASE-RED, engaps J4)**: `observability-opentelemetry.test.ts >` "the factory resolves a general endpoint to /v1/traces and serves the port until disposed" · "a settings card supplies no tracer name: the service name is the tracer name" · "site attribution: every exported span's resource carries the host's attributes; service.name stays the host's service" · `observability-sentry.test.ts >` "a composed tracker correlates Sentry errors to the actual active OTel span only". All 5 s timeouts.
- **cms (BASE-RED)**: `forms/src/__tests__/package-boundary.test.ts > forms keeps its own published root entry and CMS exposes no forms alias` (`'0.7.2'` vs `'0.7.3-next.1'`; with next.2 it reads against `0.7.3-next.2`, decision 6). **cms (fixed)**: `src/__tests__/subpath-isolation.contract.test.ts > keeps every CMS subpath isolated at runtime and installation` (timeout, decision 2).
- **cms/forms (BASE-RED)**: the same `package-boundary` case.
- **neutral-host (BASE-RED)**: `contribution-contracts.test.ts > contribution contracts > walks every contribution file, and each kind is in the contract table`.
- **plugin-fixture-provider (BASE-RED)**: 1 of 2.
- **reference-web e2e (BASE-RED)**: `chat-layout.test.mjs` (2 cases) and `composer-hit-targets.test.mjs` (1 case): `Cannot find package 'playwright'`.
- **scripts vitest**:
  - BASE-RED: `check-env-access` ×2; `connection-card.packed` ×1; `optional-peer-contract` ×3 (real default entries; daemon → express; ui → lexical); `check-why-comments.test.mjs` (node:test file, "No test suite found").
  - `coupling-isolation`: now a file-level `beforeAll` hook timeout. With long timeouts it shows the same 6 BASE-RED cases (model-discovery; platform command / process / proxy-env; shared secret-input owner; web entry HTML peers).
  - `extract-s3-source-contracts`: a file-level `git show 35c4961af…` failure, because **this clone is shallow** (`35c4961af` is absent). Environment; base had 2 red cases there.
  - **NEW, timing only (Vitest 3, decision 2)**: `check-error-disclosure-callers`, `fetch-query-isolation`, `leaf-import-closures` (1 each). Green with long timeouts.
- **`test:scripts:node`** (not baselined): `integration/infra-retirement.integration.test.ts` "Tovu consumers have no imports or re-exports of the retired package" (it reads `/home/user/Tovu/apps/website/src/contracts/core/events/*outbox*.ts`), "Tovu consumer manifests have no dependency on the retired package", and "j05 final state removes the infra workspace…" ("Retirement is incomplete: retain infra until its release gate and outbox ownership are resolved"). These are about the external Tovu checkout and the still-present infra workspace. No merged branch touches either.

## Release prep: 0.7.3-next.2 (`6c207c90`)
- **Reference**: npm has `latest 0.7.2`, `next 0.7.3-next.1`, and no git tag for next.1. All 41 public tarballs (current tree) were compared with `npm pack <name>@0.7.3-next.1`. **All 41 DIFFER** (`pack-diff-vs-npm.txt`):
  - `CHANGELOG.md` differs in 36 (main's 0.7.2 section);
  - `package.json` differs in 33 (deps-1121 devDeps, zod, jsdom);
  - `dist` differs in exactly 11: admin, agent-plugins, agent-runtime, chat, cms, core, diagnostics, plugins, protocol, provider-plugins, ui;
  - `catalog.json` differs in plugin-catalog.
- **Bumped `0.7.3-next.1 → 0.7.3-next.2` (41)**: admin, agent-plugins, agent-runtime, agentic, analytics, artifacts, capability-providers, chat, cli, cms, cms-forms, commerce, cookie-consent, core, daemon, db, desktop-host, devops, diagnostics, http-kit, infra, integrations, mcp, memory, node-adapters, oauth, platform, plugin-catalog, plugins, protocol, provider-plugins, registry, sandbox, search, server, sidecar, sqlite, ui, ui-kit, user-management, vibecoding. Private packages are untouched.
- **Dependents' ranges**: the literal peers `^0.7.3-next.1 → ^0.7.3-next.2`:
  - admin (core);
  - agent-plugins (core, commerce);
  - agentic (protocol, core);
  - chat (agent-runtime, ui);
  - infra (db);
  - integrations (platform);
  - node-adapters (agent-plugins);
  - server (chat);
  - user-management (ui-kit).

  `workspace:^` / `workspace:*` pack to `^0.7.3-next.2` / `0.7.3-next.2`. Not `changeset version` (pending majors would mint 1.0.0).
- **Also**:
  - provider-plugins: 10 versioned export paths in `package.json`, its hand-kept `catalog.json` (10 rows), and 3 README "npm release is" lines;
  - chat `dbpkg-chat-manifest.test.ts` and `store/__tests__/manifest.test.ts` now pin the new peer ranges (3/3 green);
  - plugin-catalog re-sealed by its generator;
  - lockfile: 1 specifier line;
  - full rebuild 0, frozen install 0.
- **Guards after the bump**: `guard:plugins:catalog` 0 (68/68), `guard:plugins` 0, `guard:plugins:packed` 0, `guard` 0 (`release-guards.txt`).
- **`pnpm exec tsx scripts/publish-pending.ts --plan`** (EXIT 0, `publish-plan.txt`):
```
pending          @jini-ai/core@0.7.3-next.2
pending          @jini-ai/admin@0.7.3-next.2
pending          @jini-ai/commerce@0.7.3-next.2
pending          @jini-ai/agent-plugins@0.7.3-next.2
pending          @jini-ai/oauth@0.7.3-next.2
pending          @jini-ai/protocol@0.7.3-next.2
pending          @jini-ai/platform@0.7.3-next.2
pending          @jini-ai/integrations@0.7.3-next.2
pending          @jini-ai/agent-runtime@0.7.3-next.2
pending          @jini-ai/agentic@0.7.3-next.2
pending          @jini-ai/analytics@0.7.3-next.2
pending          @jini-ai/artifacts@0.7.3-next.2
pending          @jini-ai/capability-providers@0.7.3-next.2
pending          @jini-ai/db@0.7.3-next.2
pending          @jini-ai/diagnostics@0.7.3-next.2
pending          @jini-ai/ui@0.7.3-next.2
pending          @jini-ai/chat@0.7.3-next.2
pending          @jini-ai/sidecar@0.7.3-next.2
pending          @jini-ai/cli@0.7.3-next.2
pending          @jini-ai/cms@0.7.3-next.2
pending          @jini-ai/cookie-consent@0.7.3-next.2
pending          @jini-ai/daemon@0.7.3-next.2
pending          @jini-ai/desktop-host@0.7.3-next.2
pending          @jini-ai/devops@0.7.3-next.2
pending          @jini-ai/http-kit@0.7.3-next.2
pending          @jini-ai/infra@0.7.3-next.2
pending          @jini-ai/mcp@0.7.3-next.2
pending          @jini-ai/memory@0.7.3-next.2
pending          @jini-ai/node-adapters@0.7.3-next.2
pending          @jini-ai/plugin-catalog@0.7.3-next.2
pending          @jini-ai/plugins@0.7.3-next.2
pending          @jini-ai/provider-plugins@0.7.3-next.2
pending          @jini-ai/registry@0.7.3-next.2
pending          @jini-ai/sandbox@0.7.3-next.2
pending          @jini-ai/search@0.7.3-next.2
pending          @jini-ai/server@0.7.3-next.2
pending          @jini-ai/sqlite@0.7.3-next.2
pending          @jini-ai/ui-kit@0.7.3-next.2
pending          @jini-ai/user-management@0.7.3-next.2
pending          @jini-ai/vibecoding@0.7.3-next.2
pending          @jini-ai/cms-forms@0.7.3-next.2

41 of 41 package(s) to publish.
```
- **Packed candidate**: the 41 next.2 tarballs install into an empty npm consumer (0, `--ignore-scripts`). The `deprecated` warnings for sqlite, cms-forms and infra are expected shims. The J4 lock assertions and the imports pass (see the sheet table). The publish path uses `scripts/publish-pending.ts` from this branch, which carries combine-10's `--tag next` fix.

## Exported signatures and subpaths for the Tovu run
`pnpm api:check` before `api:update` (`api-check.txt`, `api-baseline-diff.txt`); all **additive**:
- **@jini-ai/cms**: new subpaths `./taxonomy/render-entry` (universal; `renderHtmlTaxonomy`, `HtmlTaxonomyTerm`), `./forms/field-length-caps` (universal; `fieldMaxChars`, `capSubmissionFieldLengths`, `FORM_TEXT_MAX_CHARS`, `FORM_LONG_TEXT_MAX_CHARS`) and `./widgets/html/media-html` (node; `renderMediaRawHtml`, `sanitizePageHtml`, `MediaHtmlEvent`, `MediaHtmlReport`). Each has types/import/default targets.
- **@jini-ai/core `.` and `./gated-mutations`**: `confirm(required: { …, signal?: AbortSignal }, _optional)` and `execute(required: { …, signal?: AbortSignal }, _optional)`.
  - An abort before the token save rejects with the signal's reason and saves nothing.
  - An abort before redemption leaves the token minted and applies nothing.
  - After redemption, the mutation completes.
- **@jini-ai/core `./plugin-directory`**: `validatePluginIdentity({ manifest, namespace, legacyNamespace?: string | undefined })` and `readPluginIdentity({ manifest, namespace, name?, legacyNamespace?: string | undefined })`. The legacy extension is read only when the current key is `undefined`. A `null` current extension is still refused.
- **@jini-ai/plugins `./host`**: `ManifestHostPorts.legacyIdentityNamespace?: string` and `PluginCapabilityToolsRequired.legacyIdentityNamespace?: string | undefined`. **`./host/node`**: `PluginRuntimeHostBinding.legacyIdentityNamespace?: string`.
- **@jini-ai/agent-plugins `./connect/plugin-host`**: `PluginHostDeps.legacySiteIdentityNamespace?: string` (only `listSiteProviders` forwards it).
- **@jini-ai/agent-plugins `./github/*`** (`.mjs`, not in the API baseline): `createSiteCommitter(...)` input accepts `previousManagedManifestPath?: string`. It falls back to the predecessor only on a canonical 404, pins ownership reads to the parent SHA, and publishes canonical ownership.
- **@jini-ai/agent-runtime** (internal, no export change): ACP initialize and model probe refuse an explicit `protocolVersion` other than 1 (absent is accepted).
- **@jini-ai/chat `./react`**: `MessageList` shows an icon-only jump arrow (down = "Jump to latest", up = "Jump to top", hidden when nothing scrolls). The hook result adds `scrollable` / `jumpToTop` (internal). Tovu translations owe the `"Jump to top"` key if they translate the chat UI.
- **Versions**: every public package is `0.7.3-next.2`, and the literal peers are `^0.7.3-next.2`. No subpath was removed.

## Left / next
1. Owner: decisions 1–9 (above all 2: Vitest-3 script timeouts; 3: CI trigger narrowing; 8: error-gate refresh is now blocked by 25 rows).
2. Owed by the sheets, not done here:
   - ci J1/J2 Actions proofs (and J3/J4 on Actions; local stand-ins are RED);
   - the Tovu Chrome look for T2-J (Plugins list + same-publisher upgrade of a pre-existing site install);
   - the GH-T1 sandbox publish with nested predecessor ownership against packed Jini;
   - the Tovu V1 host authorizer binding (combine-10).
3. Not run: e2e/playwright, knip/sonar/depcruise, Actions.
4. Publish: the coordinator pushes the tag; nothing was published or tagged here.

## Raw outputs (`cloud-results/combine-11-jini-raw/`)
- `gates-{base,m1..m8,final}/`: every gate per merge.
- `sheet-tests.txt`, `mutations.txt`.
- `api-check.txt`, `api-update.txt`, `api-baseline-diff.txt`.
- `m8-merge.txt`: the main merge's conflict list.
- `suites/` (`_summary.txt`, `reds-and-counts.txt`).
- `scripts-vitest.txt`, `scripts-vitest-longtimeout.txt`, `scripts-node.txt`.
- `release-readiness.txt` (guards before the bump), `release-guards.txt` (after).
- `publish-plan.txt`, `public-packages.txt`, `pack-diff-vs-npm.txt`, `pack-canon.mjs`.
- `packed-consumer-check.{mjs,txt}`.

## Pushed SHAs (`integ/merge-11-2026-11-21`, first-parent order)
`8c3cff49` (merge deps/lockfile-1121) · `eeb23199` (jx-w4) · `6d8fe175` (jx-w5) · `0d27312f` (jx-proto) · `c3defe3e` (jx-gh) · `f4a3db41` (jx-w6) · `bafdbf0d` (jx-ci) · `76be2178` (origin/main) · `7e55920c` (api:update + gate outputs) · `e70b25be` (catalog drift) · `6c207c90` (chore(release): 0.7.3-next.2) · `373c4b7e` (cms test timeout) · report commit on top.
