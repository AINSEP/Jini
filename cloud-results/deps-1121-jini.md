**Jini `deps/lockfile-1121` @ `3493668d`** (last code commit; the report commit follows it) · **Tovu `deps/lockfile-1121` @ `d066f29fe`** (last code commit; report commits follow it)

# deps-1121 JINI (2026-11-21): dependency and lockfile run

Unattended cloud run on Opus high. Node 24.22.3 (`/opt/node24`), pnpm 10.33.2 (corepack). Branch created from `origin/integ/merge-10-2026-11-21` (`de4e555b9`). Only `deps/lockfile-1121` was pushed. A local helper branch `wip/zod4-local` was used in a worktree; it was never pushed and its commit is on the branch. No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no `git pull --rebase`, no tags, no publish, and no `api:update` (nothing to update).

**Status: COMPLETE. Steps 2, 3 and 4 are done** (Step 1 is Tovu only). The final tree passes build 0 (0 `error TS`), full typecheck 0, scripts tsc 0, guard 0, and `api:check` 0. **The API surface is unchanged.** A fresh `pnpm install --frozen-lockfile` on the final SHA passes. Suites are compared per package against a base run on the unmodified `de4e555b9` in the table below. Every remaining red is either a known BASE-RED or a load-sensitive timeout that passes when re-run (see "Every red line").

## Setup and base
- `pnpm install --frozen-lockfile` 0 · `pnpm --no-bail -r build` 0 (0 `error TS`) · `pnpm -r typecheck` 0 + scripts tsc 0 · `pnpm guard` 0 · `pnpm api:check` 0 (40 packages, 677 entries, 17194 symbols).
- Base suites ran in a separate worktree at `de4e555b9` (fresh frozen install + build), with `npm run test -- --maxWorkers=2 --minWorkers=1` in each package (`jini-base-suites.txt`). commerce and search were re-run without the extra flags, because their scripts already pass `--maxWorkers` (`jini-base-suites-rerun.txt`).
- Base reds (unchanged from combine-10): cms 2 (forms version pin `0.7.1` vs `0.7.3-next.1`, and the pglite `create-tables.reference` timeout); cms/forms 1 (the same version pin); plugin-fixture-provider 1; provider-plugins 4 (the J4 `operation.completed` timeouts recorded in combine-10); neutral-host 1 (contribution contracts `0 >= 27`); reference-web e2e 3 (`playwright` package not installed for `node --test e2e/*.test.mjs`).

## Step 2: resolution-only security bumps (`6f0f043b`)
Lockfile only, apart from parent-scoped overrides for exact pins.

| package | before → after | how |
|---|---|---|
| brace-expansion | 2.1.2 / 5.0.7 → 2.1.6 / 5.0.11 | re-resolution |
| js-yaml | 3.15.0 / 4.3.0 → 3.15.2 / 4.3.2 | re-resolution |
| source-map-js | 1.2.1 → 1.2.2 | re-resolution |
| fast-uri | 3.1.4 → 3.1.7 | re-resolution |
| ip-address | 10.2.0 → 10.3.1 | re-resolution |
| vite (8 line) | 8.1.5 → 8.1.6 | re-resolution |
| nanoid 3.x | 3.3.16 → 3.3.19; 3.3.3 → 3.3.19 | re-resolution; `@excalidraw/excalidraw>nanoid` override (Excalidraw pins 3.3.3 exactly) |
| lodash-es | 4.17.21 → 4.18.1 | `chevrotain>`, `@chevrotain/cst-dts-gen>`, `@chevrotain/gast>lodash-es` overrides (exact 4.17.21 pins) |
| undici (8 line) | 8.10.0 → 8.12.2 | `e2b>undici8` = `npm:undici@8.12.2` (e2b pins its optional alias to 8.10.0 exactly) |
| devalue, svgo, @tiptap/\* | not in this lockfile | — |
| @modelcontextprotocol/sdk | already 1.32.2 | — |

Files: `package.json` (pnpm.overrides), `pnpm-lock.yaml`. Rebuild of the packages resolving a changed dependency (mcp, ui, sandbox, chat, reference-web): 0 errors. Their suites are part of the final comparison below.

## Step 3: vitest 2.1.9 → 3.2.7, vite 5.4.21 → 6.4.5 under vitest (`a942586c`, `1100c013`, `68638b94`, `a1cda3ba`, `3493668d`)
- Every `vitest` spec `^2.1.0` / `^2.1.9` / `^3.2.4` → `^3.2.6`, and every `@vitest/coverage-v8 ^2.1.9` → `^3.2.6` (39 manifests). Both resolve to 3.2.7.
- vitest's own `vite` range (`^5 || ^6 || ^7`) kept reusing the locked 5.4.21, so parent-scoped overrides were added: `vitest>vite`, `vite-node>vite` and `@vitest/mocker>vite` = `^6.4.4`, resolving to 6.4.5. vite 5 is gone from the lockfile, and esbuild 0.21.5 is gone with it.
- **Config and test breaks fixed** (each verified on the affected suite):
  1. **Build (3 TS errors in platform and http-kit)**: vitest 3's `optional-types.d.ts` re-exports `jsdom` types. pnpm's hidden hoisting exposed `@types/jsdom`, whose `lib="dom"` reference replaced the global `BodyInit`/`RequestInit` in node-only packages whose tsconfig includes tests. Fix: `pnpm-workspace.yaml` `hoistPattern: ['*', '!@types/jsdom']`. Packages that test with jsdom declare `@types/jsdom` themselves.
  2. **Two vitest instances**, which break Vitest 3's snapshot client ("snapshot state … is not found"). (a) `@testing-library/jest-dom/vitest` imports `vitest` without declaring it. A `packageExtensions` entry gives it an optional `vitest` peer, so it links the importer's vitest. (b) admin, agent-plugins, agentic, chat, cms and ui had jsdom `^25.0.1` devDeps. In base they ran DOM tests on the *root* vitest's jsdom 26 because they have no vitest of their own. Vitest 3 resolved a jsdom-25 peer variant for them, which gave them a second instance and an older DOM (no `AbortSignal.any`, so 12 ui tests went red). Fix: their jsdom devDep goes `^25.0.1 → ^26.1.0`, which is the environment base actually ran. A fresh install now gives them no local vitest bin.
  3. **Vite 6 applies `server.fs.allow` to Vitest module loads**, so `.mjs` files that the plugin-host and artifact tests write under `os.tmpdir()` were refused ("Failed to load url"). Fix: `server.fs.allow = [workspace root, os.tmpdir()]` in the root `vitest.config.ts` (used by config-less packages such as plugins), `agent-plugins/vitest.config.ts`, and `provider-plugins/vitest{,.coverage}.config.ts`.
  4. **Vitest 3 fakes every timer API by default** (rAF and `performance` included). In agentic and ui, `fakeTimers.toFake` is set back to Vitest 2's default list. Before the fix, agentic's `settle` tests timed out because their own rAF stubs were replaced, and ui's boot-timing tests lost `getEntriesByType`.
  5. **`toThrow(errorInstance)` now compares class and own props**. agent-runtime `native-permissions.test.ts:66` and integrations `openrouter.test.ts:207` now assert `expect.objectContaining({ message })` (integrations also checks `name: 'TypeError'`). A wrong-message mutation still turns all 14 agent-runtime cases red.
  6. **admin `src/comments/__tests__/test-runner.ts`**: the Vitest 2 polyfill for `toHaveBeenCalledExactlyOnceWith` was removed. Vitest 3 ships the matcher, and the redeclaration was a duplicate-identifier build error.
  7. **diagnostics `playwright-runtime.test.ts:65`**: a module that is not installed now fails with Node's own message, `Cannot find package '…' imported from`. Vitest 3 no longer routes it through vite-node's "Failed to load url …".
  8. **Vitest 3 fails a synchronous test that overruns its timeout**, which Vitest 2 could not preempt. core `settings-subpath-isolation` (21 s in base), plugins `host-entry-purity` (11 s) and minimal-host `health-boot` (170 s) now carry explicit timeouts of 60 s / 60 s / 300 s. minimal-host's harness call is now awaited (`execFile`) instead of `execFileSync`: the blocked worker had made Vitest 3's `onTaskUpdate` RPC time out (exit 1 with all 3 tests passing).
  9. platform `fetch-text-details.test.ts:72`: `toThrow(new RangeError(..))` against a `ResponseLimitExceededError` with `limitBytes`. It now asserts `toBeInstanceOf(RangeError)` and the exact message.
- **No test was skipped, removed or weakened.** Test counts per suite are in the table below.

## Step 4: zod 3.25.76 → 4.6.7 (`673ab136`) and Electron example 43.2.0 → 43.8.7
- Manifests: protocol (dependency), agentic (dependency and peer), chat (dev), ui (dev and optional peer), and reference-web (`^4.0.0`): all `zod ^3.25.76` → `^4.6.6`, resolving to 4.6.7. `examples/reference-desktop` electron `^43.2.0 → ^43.8.1` resolves to 43.8.7. Its build is 0 as part of `-r build`.
- **Source: 30 files changed one import specifier each (`from 'zod'` → `from 'zod/v3'`). No schema call changed.** The files are:
  - protocol `src/{registry,a2ui/agent-to-renderer,a2ui/renderer-to-agent,a2ui/catalog,a2ui/common-types}.ts` and tests `__tests__/registry.boundaries.test.ts`, `a2ui/__tests__/interpreter.test.ts`
  - ui `features/interactive-ui/{types,providers/shadcn/{select-field,action-button,data-table,checkbox-field,radio-group-field,text-input-field,content-card}.manifest,providers/native/data-table.manifest}.ts`, `features/charts/{catalog-manifests,wire,registry,contract}.ts`, and tests (`interactive-ui/__tests__/registry`, `a2ui/__tests__/{renderer-characterization,provider-actions.integration,renderer,catalog-from-registry}`, `charts/__tests__/{catalog-registry,chart-spec-contract,contract}`)
  - chat tests `react/__tests__/fake-chat-surfaces.tsx`, `react/components/__tests__/A2uiSurfaceCard.registry.test.tsx`
- **Why `zod/v3` instead of the v4 API**: the brief asks for identical runtime behaviour and error text. `protocol/src/__tests__/registry.test.ts:179` pins the exact v3 issue JSON (`received: 'undefined'`, `message: 'Required'`), and `a2ui` `reason` strings come from `issues[0].message`. The v4 API changes both (`"Invalid input: expected array, received undefined"`, and no `received` field). zod 4.6.x ships the full zod 3 API at `zod/v3`, and its copy carries the upstream security fixes (emoji regex ReDoS, `__proto__` in intersection merge). The array/map/set size-cap fix in 4.6.6 lives only in the v4 core and does not affect v3 schemas, which behave exactly as before. A rewrite to the v4 API, with changed error text, is a separate owner decision.
- Result: build 0, typecheck 0, guard 0, `api:check` 0 (declared types unchanged). protocol 794 = base, agentic 1149 = base, and chat and ui at base (table).

## Suites: base (`de4e555b9`) vs final (`3493668d`)
Each package ran `npm run test` (with `-- --maxWorkers=2 --minWorkers=1` unless its script already sets workers). The final values come from `jini-final-suites.txt`. platform, core, plugins and minimal-host were re-run after `a1cda3ba`/`3493668d` (`jini-final-suites-rerun.txt`). **All 49 suites have exactly the base counts. No test was skipped, removed or added.**

| suite | base | final | |
|---|---|---|---|
| examples/minimal-host | Tests 3 passed (3) | Tests 3 passed (3) | same |
| examples/neutral-host | Tests 1 failed / 38 passed / 13 todo (52) | Tests 1 failed / 38 passed / 13 todo (52) | same |
| examples/nlweb-demo | Tests 18 passed (18) | Tests 18 passed (18) | same |
| examples/notes-app | exit 0 | exit 0 | same |
| examples/reference-desktop | Tests 4 passed (4) | Tests 4 passed (4) | same |
| examples/reference-web | Tests 54 passed (54) | Tests 54 passed (54) | same |
| packages/admin | Tests 3074 passed (3074) | Tests 3074 passed (3074) | same |
| packages/agent-plugins | Tests 2188 passed / 2 skipped (2190) | Tests 2188 passed / 2 skipped (2190) | same |
| packages/agent-runtime | Tests 4537 passed / 1 skipped (4538) | Tests 4537 passed / 1 skipped (4538) | same |
| packages/agentic | Tests 1149 passed (1149) | Tests 1149 passed (1149) | same |
| packages/analytics | Tests 226 passed (226) | Tests 226 passed (226) | same |
| packages/artifacts | Tests 242 passed (242) | Tests 242 passed (242) | same |
| packages/capability-providers | Tests 198 passed (198) | Tests 198 passed (198) | same |
| packages/chat | Tests 4486 passed / 1 skipped (4487) | Tests 4486 passed / 1 skipped (4487) | same |
| packages/cli | Tests 605 passed (605) | Tests 605 passed (605) | same |
| packages/cms | Tests 2 failed / 5007 passed (5009) | Tests 2 failed / 5007 passed (5009) | same |
| packages/cms/forms | Tests 1 failed / 156 passed (157) | Tests 1 failed / 156 passed (157) | same |
| packages/commerce | Tests 11 passed (11); Tests 1421 passed / 1 skipped (1422) | Tests 11 passed (11); Tests 1421 passed / 1 skipped (1422) | same |
| packages/cookie-consent | Tests 221 passed (221) | Tests 221 passed (221) | same |
| packages/core | Tests 2947 passed (2947) | Tests 2947 passed (2947) | same |
| packages/daemon | Tests 4854 passed / 1 skipped (4855) | Tests 4854 passed / 1 skipped (4855) | same |
| packages/db | Tests 950 passed (950) | Tests 950 passed (950) | same |
| packages/desktop-host | Tests 749 passed / 1 skipped (750) | Tests 749 passed / 1 skipped (750) | same |
| packages/devops | Tests 1327 passed (1327) | Tests 1327 passed (1327) | same |
| packages/diagnostics | Tests 1090 passed (1090) | Tests 1090 passed (1090) | same |
| packages/http-kit | Tests 750 passed (750) | Tests 750 passed (750) | same |
| packages/infra | Tests 155 passed (155) | Tests 155 passed (155) | same |
| packages/integration-tests | exit 0 | exit 0 | same |
| packages/integrations | Tests 2077 passed (2077) | Tests 2077 passed (2077) | same |
| packages/mcp | Tests 1885 passed (1885) | Tests 1885 passed (1885) | same |
| packages/memory | Tests 409 passed (409) | Tests 409 passed (409) | same |
| packages/node-adapters | Tests 35 passed (35) | Tests 35 passed (35) | same |
| packages/oauth | Tests 824 passed (824) | Tests 824 passed (824) | same |
| packages/platform | Tests 3354 passed / 6 skipped (3360) | Tests 3354 passed / 6 skipped (3360) | same |
| packages/plugin-catalog | Tests 68 passed (68) | Tests 68 passed (68) | same |
| packages/plugin-fixture-provider | Tests 1 failed / 1 passed (2) | Tests 1 failed / 1 passed (2) | same |
| packages/plugins | Tests 1017 passed (1017) | Tests 1017 passed (1017) | same |
| packages/protocol | Tests 794 passed (794) | Tests 794 passed (794) | same |
| packages/provider-plugins | Tests 4 failed / 914 passed (918) | Tests 4 failed / 914 passed (918) | same |
| packages/registry | Tests 392 passed (392) | Tests 392 passed (392) | same |
| packages/sandbox | Tests 179 passed (179) | Tests 179 passed (179) | same |
| packages/search | Tests 371 passed (371) | Tests 371 passed (371) | same |
| packages/server | Tests 469 passed / 1 skipped (470) | Tests 469 passed / 1 skipped (470) | same |
| packages/sidecar | Tests 408 passed / 3 skipped (411) | Tests 408 passed / 3 skipped (411) | same |
| packages/sqlite | Tests 10 passed (10) | Tests 10 passed (10) | same |
| packages/ui | Tests 8818 passed (8818) | Tests 8818 passed (8818) | same |
| packages/ui-kit | Tests 232 passed (232) | Tests 232 passed (232) | same |
| packages/user-management | Tests 1353 passed (1353) | Tests 1353 passed (1353) | same |
| packages/vibecoding | Tests 364 passed (364) | Tests 364 passed (364) | same |

Intermediate runs: `jini-step3-suites.txt` is the first vitest 3 run, before the fixes. It showed admin 2, agent-plugins 24, agent-runtime 14, agentic 2, diagnostics 1, integrations 1, plugins 7, provider-plugins +21 and ui 12 new reds, plus load timeouts in cms/core/minimal-host. Every one is resolved by the fixes listed in Step 3. `jini-step4-suites.txt` is the zod tree: protocol 794, agentic 1149, chat 4486/1 skipped, and ui (12 reds there were the vitest-3 ui issue, fixed later).

## Every red line
| suite | red | status |
|---|---|---|
| cms | forms `package-boundary` (`0.7.1` vs `0.7.3-next.1`); pglite `create-tables.reference` timeout | BASE-RED, unchanged (combine-10 lists both) |
| cms/forms | the same `package-boundary` version pin | BASE-RED |
| plugin-fixture-provider | 1 of 2 | BASE-RED |
| provider-plugins | 4 OTel/Sentry timeouts from engaps J4 (`operation.completed`) | BASE-RED (combine-10: removing J4's line → 91/91) |
| neutral-host | contribution contracts `0 >= 27` | BASE-RED |
| reference-web | `node --test e2e/*.test.mjs`: 3 fail, `playwright` package not installed (vitest half 54/54) | BASE-RED |
| (during the full runs only) | 5 s timeouts in cms pglite dialect tests (17) and core, under 3–4 concurrent suites | load. The final run has cms = base (2) |

## Advisories still open
- **zod 3.25.76** is still in the lockfile through third-party pins: `@ag-ui/core 0.0.58` (zod `^3.22.4`) and `@mcp-ui/client 7.1.1` (zod `^3.23.8`). Overriding them to zod 4 would run their v3-API code against the v4 API.
- **electron 43.2.0** remains as `@jini-ai/devops`'s auto-installed optional peer (`>=30.0.0`). pnpm keeps the locked version for a peer, and `pnpm up electron` does not move it. The example itself is on 43.8.7.
- **nanoid 4.0.2** is untouched (the brief scoped this run to 3.x; the 4 → 5 change needs the Excalidraw consumer check from the plan).
- **undici 7.30.2** (platform/devops `^7.30.1`) is unchanged; the 7.x line was not in scope.

## 0.7.3-next.2 publish: packages whose tarball changes
Every public package below has a changed `package.json`: the devDependency specs for vitest/coverage, plus zod/jsdom where listed. Runtime-relevant changes:
- **@jini-ai/protocol**: dependency `zod ^4.6.6`; `dist` imports `zod/v3` (5 source files).
- **@jini-ai/agentic**: dependency and peer `zod ^4.6.6`.
- **@jini-ai/ui**: optional peer `zod ^4.6.6`; `dist` imports `zod/v3` (12 source files).
- **@jini-ai/chat**: dev `zod ^4.6.6` and `jsdom ^26.1.0` (tests only; `dist` unchanged).
- devDependency-only `package.json` changes: admin, agent-plugins, agent-runtime, artifacts, capability-providers, cms, cms-forms, commerce, cookie-consent, core, daemon, db, desktop-host, devops, diagnostics, http-kit, infra, integrations, memory, node-adapters, platform, sandbox, search, server, sidecar, sqlite, ui-kit, user-management, vibecoding.
- No changeset was added; the brief asked only for this list.

## Raw outputs
`cloud-results/deps-1121-jini-raw/`: base and final gate logs, per-package suite summaries (`jini-base-suites*.txt`, `jini-step3-suites.txt`, `jini-step4-suites.txt`, `jini-final-suites.txt`), and the `api:check` output.
