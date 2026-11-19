# combine-4 JINI (2026-11-19) — `integ/merge-4-2026-11-18`

Unattended cloud run, 02:27–05:20 UTC. Branch created from `origin/integ/merge-3-2026-11-18` (`d37821a46`). Node v24.22.3, pnpm 10.33.2, `pnpm install --frozen-lockfile` exit 0 (lockfile and `minimumReleaseAge` untouched). No subagents, no force-push, no `--no-verify`. Every `codex/*` branch in the list existed and was merged (`--no-ff`, one merge each); **none skipped**.

**Summary: all 34 branches merged; final tree green on build, typecheck, guard and every ratchet, with no output line beyond base. 6 reds found and fixed in 6 commits on the integ branch: 2 stale call shapes / type-predicate wrappers (args-db, daemon-args), 1 bundle budget break (fn-jini-a), 1 complexity row lost in a file move (fsplit-j-cms), 1 why-comment allow-list hole (wc-fix-jini), plus 1 excess removal (fs-daemon).**

## Method

- Per merge, run from the repo root: `pnpm --no-bail --filter "...[<pre-merge>]" build`, then `pnpm --no-bail --filter "...[<pre-merge>]" --if-present typecheck` (the changed packages and every dependent), `tsc -p scripts/tsconfig.json --noEmit` when `scripts/` changed, then the 7 gates below. Each gate's output was diffed against the base output with counts normalised, so a gate that exits 0 but prints a new line would show up as new.
  - To fit the budget, clean merges of **already tested** branches were checked in pairs or triples (args-db+ar-protocol, ar-skills+ar-rest, ap-gw+ap-rest+small, platform+jini-small2, cms-admin+daemon-args, the 5 fsize-*, fs-cms+fs-vibe, ui-1+ui-2, hooks-a+hooks-b).
  - Every conflicted merge and every untested branch was checked on its own.
- Gates: `pnpm guard`; `SIZE_BASE_REF=d37821a46 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=d37821a46 node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base d37821a46` **and** the default base `origin/refactor/terra`; `node scripts/check-error-gate.mjs` (WARN mode).
- Untested branches: vitest `related --run --maxWorkers=2 --minWorkers=1` on the changed source files of every touched package. The two daemon-touching branches and fsplit-j-cms also got full suites.
- Group tests (full package suites, vitest `--maxWorkers=2 --minWorkers=1`, or the package's own script for commerce, notes-app and reference-web) ran in a separate worktree at the group's last commit.

## Base (`d37821a46`), recorded first

- `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 (0 errors); `tsc -p scripts/tsconfig.json --noEmit` 0.
- guard 0 (zero violations); size 0 (139 entries); complexity 0 (17); hooks 0 (78 direct calls); why-comments vs merge-3 0 (0 lost); why-comments vs terra 0 (170 lost / 170 allow-listed).
- check:errors exits 0 but is **BASE-RED** (WARN mode, "24 new or worse entries").

## Per branch

"tested" = covered by codex-test-fix-1/2/3. "untested" = branches not named in those reports.

| # | branch (tip) | merge | conflicts → resolution | red found | fix commit | status |
|---|---|---|---|---|---|---|
| 1 | args-integrations `6fc00d9a` (tested) | `5f7d2565` | — | — | — | GREEN |
| 2 | args-commerce `e0f5cf11` (tested) | `2c5c2548` | — | — | — | GREEN |
| 3 | args-db `c3bc0b5e` (tested on terra) | `81b0b2e9` | — | db typecheck TS2345: the S6a `events-tables.fixture.ts:30` from merge-3 still called `sqliteKernel(new Database())`. A runtime break too: the 3 events dialect suites use it | `7325c10f` `sqliteKernel({ source })`; 3 suites 25/25 | GREEN |
| 4 | args-ar-protocol `ce1ebdef` | `1d0d2ed5` | — | — | — | GREEN |
| 5 | args-ar-skills `2705bf7d` | `4e86f689` | — | — | — | GREEN |
| 6 | args-ar-rest `049e762f` | `83003101` | — | — | — | GREEN |
| 7 | args-ap-gw `6fce9a40` | `34debf76` | — | — | — | GREEN |
| 8 | args-ap-rest `dc2f817f` | `df6c0a1c` | — | — | — | GREEN |
| 9 | args-small `c484e91a` | `37e816d3` | — | — | — | GREEN |
| 10 | args-platform `9f2d9a78` | `be37300b` | — | — | — | GREEN |
| 11 | args-jini-small2 `29803fa1` | `a00f6174` | — | — | — | GREEN |
| 12 | args-jini-core-mcp `6b750d7e` | `70e18f23` | `db/docs/spec/api.spec.md` kernel table: args-db's rows kept, core-mcp's `toBool`/`toBytes`/`isUniqueViolation` rows taken | — | — | GREEN |
| 13 | args-jini-cms-admin `8441a452` | `6e44e2c4` | — | — | — | GREEN |
| 14 | daemon-args `9a9c7418` (**untested**) | `66f102a9` | — | daemon build and typecheck: 11 TS errors. It made `isRecord` (agent-executor `values.ts`, http `resource-request.ts`) a wrapper guard on `{ value }` but left 3 callers positional. check:size: `createLiveSessionState` 103 > 100 | `83db29ef` turns isRecord back into a positional type predicate (type predicates are exempt) and removes the `{ value: x }` boilerplate the branch had added at every caller. The branch's other conversions (asString, asOptionalString, errorMessage, translateAcpError, …) stay. Size is back under its debt (99) | GREEN |
| 15 | fsize-commerce `e88ada2b` | `34b9d6a4` | — | — | — | GREEN |
| 16 | fsize-integ `a294d391` | `ad4ca2a6` | — | — | — | GREEN |
| 17 | fsize-platform `4df5318f` | `a01ef721` | — | — | — | GREEN |
| 18 | fsize-small `951771dd` | `a3799770` | — | — | — | GREEN |
| 19 | fsize-small2 `5dcc98cf` | `8e3cafda` | `size-debt.json`: 3-way merge (an entry removed on either side stays removed; on both sides, the lower value wins) | — | — | GREEN |
| 20 | fs-cms `aac6a8c0` | `78acf614` | — | — | — | GREEN |
| 21 | fs-vibe `2c30d54c` | `7ff3b026` | `sidecar/supervision/supervisor.ts`: fsize-small and fs-vibe **both** split `createDaemonSupervisor`, keeping the same export. Kept fsize-small's split, which sits on args-small's call shapes and already meets fs-vibe's ≤50-line intent. fs-vibe's vibecoding splits merged unchanged | — | — | GREEN |
| 22 | fs-daemon `1b878ca6` (**untested**) | `63ac4ae6` | `agent-runtime/model-discovery-config.ts`: fs-daemon's `configuredSelection` split plus args-ar-rest's `readModelConfiguration({ agentId, context, deps, signal })`, `modelSettingsRaw` and `scalar({ value })`. `daemon live-session-state.ts` and `store/event-log/sqlite.ts`: fs-daemon's hoisted functions plus daemon-args' `omitKeys({ source, keys })`, `resolveMaxEntriesPerRun({ value })` and `assertValidReplayCursor({ afterCursor })`. `complexity-debt.json`: 3-way | none. Excess removed: two single-use `const x = 0` locals that only fed the returned state object | `be38f3fa0`. Daemon full suite 4808 pass; agent-runtime related 621 pass | GREEN |
| 23 | jm2-seo `ca38f9a3` (**untested**) | `0183949d` | — | none (new test file 8/8; it exports 4 seo sub-components for that test) | — | GREEN |
| 24 | hooks-a `74e459bb` | `c283554d` | — | — | — | GREEN |
| 25 | hooks-b `0fbbbb86` | `dd6969f9` | `hook-injection-debt.json`: 3-way | — | — | GREEN |
| 26 | ui-1 `8f32cb36` | `38581e2e` | — | — | — | GREEN |
| 27 | ui-2 `a539dbb9` | `f3e11a5c` | `ui/docs/spec/api.spec.md`: row by row (each row from the side that changed it; no row changed on both sides) | — | — | GREEN |
| 28 | ui-3 `0db61efa` | `cc604006` | `browser-chrome/rules.ts` `sameUrl`: ui-3's `{ left, right }` plus the other side's `trimTrailingChars({ value, chars })`. api.spec row-wise. `why-comments-debt.json` 3-way | — | — | GREEN |
| 29 | ui-4 `b6f6dd4b` | `57827849` | `file-dropzone/rules.ts` `fileDropzoneFontFamilyName`: ui-4's `{ file, index }` plus `trimChars({ value, chars })`. api.spec row-wise | — | — | GREEN |
| 30 | fn-jini-a `b7bd4232` (**untested**) | `b7b591fd` | `size-debt.json`, `complexity-debt.json`: 3-way | **`@jini-ai/cookie-consent` build failed**: splitting `createCookieConsent` into 5 closure factories pushed `client.min.js` to 4955 B gzip against its 4672 B budget | `835b3eb1` keeps `runtime.ts` unsplit (4609 B) and keeps its existing size-debt row (133, same as base, not raised). Related tests: admin 989, agent-plugins 1258, agent-runtime 215, agentic 500, analytics 49, capability-providers 83, cms 1708, all pass | GREEN |
| 31 | fn-jini-b `e4ddab7c` (**untested**) | `2b058e58` | `size-debt.json` 3-way | none. Related tests: db 75, desktop-host 120, devops 159, diagnostics 192, http-kit 51, mcp 671, oauth 689, platform 220, plugins 387, provider-plugins 97, search 260, ui 938, user-management 355, vibecoding 52, all pass | — | GREEN |
| 32 | fsplit-j-cms `f3671f91` (**untested**) | `736d4f0d` | `size-debt.json` 3-way | check:complexity red: the debt row of `forEachDocNode` (13) moved to `document-embed-refs.ts` and the ratchet counts a row under a new path as added. check:errors: 3 rows "New" because catch blocks moved files | `43d6ec7e`: a `visitDocNode` step helper brings `forEachDocNode` under the limit and retires the row. The 3 `catch-reads-error` rows move with their code, same total (gate back to base 24). cms full suite 4419 pass. No new re-export shell: `resolver-service.ts`'s `export { isPageEmbedType }` predates the branch; importers resolve (typecheck 0) | GREEN |
| 33 | fsplit-j-misc `653e81b1` (**untested**) | `94488b00` | `size-debt.json` 3-way | none. No re-export shell: `plugins/host/node/index.ts` is the package barrel. integrations 2071 and plugins 1011 full suites pass | — | GREEN |
| 34 | wc-fix-jini `6e31651f` (**untested**) | `96e8c3df` | `why-comments-debt.json` 3-way | check:why-comments vs `origin/refactor/terra` went from 170/170 allow-listed to **31 open blocks**. The branch deleted 33 allow entries but restored most of those blocks only as reworded text, which the checker does not match | `507f4c1c` restores exactly those 31 entries as they were on base (each already names its deleting commit and containment path). The comments the branch put back stay. Now 169 lost / 169 allow-listed | GREEN |

### Fix commits (all on `integ/merge-4-2026-11-18`, all pushed)
`7325c10f5` (args-db), `83db29ef8` (daemon-args), `be38f3fa0` (fs-daemon, excess), `835b3eb12` (fn-jini-a), `43d6ec7e7` (fsplit-j-cms), `507f4c1c1` (wc-fix-jini).

API baseline commits: `95f9526eb` and `c6faba2d5`.

## Group tests (full suites, separate worktree)

All counts are equal to or above the codex-test-fix reports; no failures.

- **Group 1** at `83db29ef`:
  - minimal-host 3, neutral-host 66 (+13 todo), notes-app 112 (node:test).
  - reference-web vitest 54. Its `node --test e2e/*.test.mjs` fails with `Cannot find package 'playwright'`: an environment gap, the same as in codex-test-fix-1.
  - admin 3018, agent-plugins 2178, agent-runtime 4485, agentic 1143, analytics 224, artifacts 242, chat 4459, cms 4419.
  - commerce 11 + 1413 (vitest + kernel).
  - core 3074, daemon 4808, db 943, devops 1279, infra 155, integrations 2071, mcp 1849, memory 409, oauth 824, platform 3216, plugins 1011, protocol 794, provider-plugins 898, registry 391, sandbox 179, server 468, sidecar 339, sqlite 10, ui 8742.
- **Groups 2+3** at `dd6969f9`: admin 3026, agent-runtime 4485, cms 4419, commerce 11 + 1413, integrations 2071, platform 3216, plugins 1011, sandbox 179, sidecar 339, ui 8742, user-management 1291, vibecoding 364. daemon ran in full after the fs-daemon merge (4808).
- **Group 4** at `57827849`: ui 8742, chat 4459, admin 3026, reference-web vitest 54 (e2e: same playwright gap).
- **Groups 5–7**: the related tests and full suites listed in the table. integrations 2071, plugins 1011 and commerce 1424 were re-run on the final tree.

## Final gates (tree `c6faba2d5`, run from the repo root)

| command | base | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` |
| `pnpm -r --no-bail --if-present run typecheck` | 0, 0 errors | **0**, 0 errors |
| `npx tsc -p scripts/tsconfig.json --noEmit` | 0 | **0** |
| `pnpm guard` | 0, zero violations | **0**, zero violations |
| `SIZE_BASE_REF=d37821a46 node scripts/check-size.mjs` | 0, 139 entries | **0**, 89 entries (71 functions, 18 files) |
| `COMPLEXITY_BASE_REF=d37821a46 node scripts/check-complexity.mjs` | 0, 17 | **0**, 6 |
| `node scripts/check-hook-injection.mjs` | 0, 78 direct calls | **0**, ok |
| `node scripts/check-why-comments.mjs --base d37821a46` | 0 | **0**, 1 lost / 1 allow-listed (ui-3's `escapeJsString`, allow-listed by ui-3) |
| `node scripts/check-why-comments.mjs` (base `origin/refactor/terra`) | 0, 170/170 | **0**, 169/169 |
| `node scripts/check-error-gate.mjs` | 0, BASE-RED "24 new or worse" | **0**, the same 24 lines, none new |
| `pnpm api:check` | (exit 0 on merge-3 per combine-3-fix) | **0**. 532 "changed export" lines remain: hash drift not attributable by name to the merged diff, left on the old baseline (see below) |

## API baseline / exported signatures that changed

`pnpm api:update` was run, then every symbol whose name appears in no changed line of its package's `d37821a46..HEAD` diff was put back to the old hash. 664 entries were reverted that way.

The 29 "removed" symbols were also kept on the baseline. The update reported them removed from `admin` `.`/`./core` (AdminApiError, describeApiError) and `agent-runtime` `.`/`./model-discovery` (RuntimeAgentDef, ModelDiscoveryContext, …), but their exports are still in the sources, so they are not attributable to the merged branches. **Needs a look:** this is a d.ts-surface reading, not a confirmed break.

**1015 changed export entries** are committed. The full list (package, entry#symbol) is in `cloud-results/combine-4-jini-api-changes.txt`. By package:

| package | changed exports |
|---|---|
| ui | 562 |
| agent-runtime | 151 |
| devops | 65 |
| platform | 53 |
| db | 40 |
| agent-plugins | 18 |
| core | 14 |
| sidecar | 14 |
| admin | 11 (incl. jm2-seo's 4 newly exported seo components) |
| commerce | 11 |
| mcp | 11 |
| memory | 10 |
| protocol | 10 |
| cms | 9 |
| artifacts | 8 |
| registry | 7 |
| sandbox | 5 |
| server | 4 |
| analytics | 3 |
| daemon | 2 |
| integrations | 2 |
| sqlite | 2 |
| infra | 1 |
| plugins | 1 |
| user-management | 1 |

Almost all of them are the `(required, optional = {})` conversions of the args-* and ui-* branches.

## Decisions / left

1. **Type-predicate wrappers.** I reverted daemon-args' `isRecord` wrappers because the owner rule exempts type predicates. `@jini-ai/core`'s `isRecord` (wrapper since before merge-3) and mcp's `isPlainObject` (args-jini-core-mcp) still use the `{ value }` wrapper form. I left them because they are not in a file this run touched; revert them the same way if the exemption is meant to be applied retroactively.
2. **cookie-consent split.** `createCookieConsent` keeps its size-debt row (133). A ≤50-line split has to fit the 4672 B gzip budget, which needs its own design.
3. **Tovu.** The callers listed in codex-test-fix-1/2/3 still need updating. The parallel Tovu run owns that; I did not touch Tovu.
4. **Not run:** Jini `pnpm test:scripts` (base-red per codex-test-fix-1); e2e (no playwright).

## Next step
Owner review of decisions 1–2 and of the 29 "removed" api entries, then the Tovu half (parallel run) against this tip, then fast-forward `refactor/terra`.
