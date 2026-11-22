# combine-5 JINI (2026-11-19) — `integ/merge-5-2026-11-19`

Unattended cloud run, 18:50–~21:30 UTC. Branch created from `origin/integ/merge-4-2026-11-18` (`0b0784e8`). Node v24.22.3, pnpm 10.33.2, `pnpm install --frozen-lockfile` exit 0 at base. No subagents, no force-push, no `--no-verify`.

**Summary: 28 of 29 listed branches merged (`--no-ff`, one merge each); `codex/ex-log` skipped (see below); `codex/jini-wave-a3` does not exist on origin. The final tree is green on build, typecheck, guard and every ratchet with no output line beyond base. 17 fix commits on the integ branch, plus the owner-delegated AdminKit fix, a lockfile commit and an API baseline commit.**

## Method

- Per merge (root): `pnpm --no-bail --filter "...[<pre-merge>]" build`, `pnpm --no-bail --filter "...[<pre-merge>]" --if-present run typecheck`, `npx tsc -p scripts/tsconfig.json --noEmit` when `scripts/` changed, then the gates below, diffed against base output with numbers normalised. The 13 audit-sheet branches (group 4) were merged one by one and checked together after the last (each one small and in its own package; reds attributed by file).
- Gates: `pnpm guard`; `SIZE_BASE_REF=0b0784e8 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=0b0784e8 node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base 0b0784e8` and with default base (`origin/refactor/terra`); `node scripts/check-error-gate.mjs`.
- Debt-file conflicts (`size-debt`, `complexity-debt`, `injection-debt`): 3-way per key (a row removed on either side stays removed; on both sides the lower value wins). Rows that lost their file in a move were moved with their value, same totals.
- Tests: full package suites (vitest `--maxWorkers=2 --minWorkers=1`) in a separate worktree at each group's last commit; `vitest related --run` on changed files for ui/admin/chat in group 1.

## Base (`0b0784e8`), recorded first

- `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 (0 errors); `tsc -p scripts/tsconfig.json --noEmit` 0.
- guard 0 (zero violations); size 0 (89 entries); complexity 0 (6); hooks 0 (ok); why-comments vs base 0; vs terra 0 (169/169 allow-listed).
- check:errors exits 0 but is **BASE-RED** (WARN mode, "24 new or worse entries").

## Per branch

| # | branch (tip) | merge | conflicts → resolution | red found | fix commit | status |
|---|---|---|---|---|---|---|
| 1 | wc-fix-jini2 `ba98be8c` | `62f2afab` | devops `coverage/integrity.ts`: restored why-comments + HEAD's args signatures | guard N-consumer-identity: restored comment named a consumer (`.tovu.zip`) | `a03281ab` | GREEN |
| 2 | jini-szcx `ad938785` | `f4b5c1e5` | size/complexity debt 3-way | size: `tool-executor.ts` file > 500, `run-lifecycle.ts` worsened (helpers added lines). Left open on purpose: fs-j-daemon / dx-events split both files; green after #22 | — (resolved by #22/#24) | GREEN |
| 3 | jini-fsplit2 `1ff48eb5` | `106e10dc` | `daemon/http/attachments.ts`: took fsplit2's move; re-applied szcx's `createDiskAttachmentStore` split in `disk-attachment-store.ts` (its new positional helpers turned into args objects); size row retired | injection-debt / error-gate rows lost in the move | `a03281ab` (rows moved, same totals) | GREEN |
| 4 | claude-ab/cookie-consent-cloud `15c17fbb` | `19cf98b8` | `client/runtime.ts`: branch's `purge({ doc }, { storage })` + HEAD's `onState({ state, purge })` | `client.min.js` 4658 B gzip: under the 4672 budget but short of the 32 B headroom `bundle.smoke.test.ts` requires (1 test red). Reworded `@example` | `15440449`: `purgeStorage` was a forwarder to `purge` (owner rule); one implementation in `dom.ts` → 4637 B, 181/181 | GREEN |
| 5 | wave4/admin-j4-inject `21ad8f96` | `6f95f72e` | Playground/SecurityPage: J4 `TabbedPageProps` + HEAD's injected `use*PageHook` prop | — | — | GREEN |
| 6 | jm-forms `59f3617f` | `042fc261` | — | lost why-comment (ApiError moved). Case count 19 = 15 + 4 (moved to new integration file) | `9af0f7b3` | GREEN |
| 7 | jm-seo-redir `9ddc36c4` | `9fa03b2f` | — | admin build TS2742 (seo harness `render()` inferred type). Case counts equal | `9af0f7b3` | GREEN |
| 8–20 | a04-a52 `a667e12e`, a05 `853dfc22`, a12-b09 `f3d92670`, a13 `df12f279`, rf2-a13 `b2f9353b`, a57 `7273a8a6`, a61 `bfd24005`, b12 `3864ff9e`, env-j1 `3f3bd591`, rf-b09 `2cf44e17`, rf-a67 `523bc3e0`, rf-a51 `792047ef`, rf2-a50 `bb5207f5` | `8cccf5bb` `4bc4bf96` `9fa08ad9` `3a4b00ec` `43ea13c5` `d4f33806` `bcfe63a6` `b327845d` `cc9e00ca` `9ddddfa3` `3324854f` `cf5db079` `ccc2b7c6` | rf2-a13: `subscribeOutsideClickOrEscape({ container, onClose }, { escapeCapture })` (args shape + its new option; 2 tests, api.spec) | see list below | `2158d753`, `013a26bc`, `516d02c3` | GREEN |
| 21 | fs-j-daemon `83f3fff3` | `f0783d02` | attachments.ts split a second time: kept fsplit2's split (already < 500), dropped the 8 duplicate `attachment-*` modules; took the tool-executor split (szcx's helpers are all in it) | 2 importers pointed at the dropped module (TS2307, guard SI-resolution); tool-executor catch rows | `9199c9d7` | GREEN |
| 22 | fs-j-hooks `c48b6830` | `ca94ff00` | — | error-gate rows lost in hook splits; user-management `public-args.test` red on 3 new positional helpers | `0065040e`, `bf50ecea` | GREEN |
| 23 | dx-events `96ec2664` (incl. dx-runlife) | `a5920a75` | `agent-executor/events.ts` modify/delete: took the split, re-applied daemon-args call shapes (`createModelReceiptTracker`, `errorMessage`, `translateAcpError`, `bridgeUnavailableMessage`, `writePromptToStdin`) in the new files | catch rows moved between split files (3→3); `launch.ts` size debt must be lowered to 1044 | `0c0274e5` | GREEN. Driver cancel-during-close: daemon full suite 4828 pass at `62484795` |
| 24 | dx-hstore `93715cbb` | `62484795` | `mcp/federation/hosted/store.ts`: took the split, re-applied args-jini-core-mcp's 15 hunks in `store-*.ts`/`access.ts`/`vault.ts`; its new characterization tests converted to the args shape | (in-merge) | in merge | GREEN |
| 25 | ex-css `27faa0f4` | `03a581ae` | — | chat ChatSettingsDialog CSS tests (9) failed: jsdom `import.meta.url` | see final fix commit | GREEN |
| 26 | **ex-log `4f7d4d37`** | — | **skipped** (`git merge --abort`), see below | | | SKIPPED |
| 27 | ext-j2 `84e769d9` (incl. ext-j1) | `f479e406` | injection-debt 3-way; `scripts/lib/self-test.ts`: kept HEAD's helper split, applied ext-j2's retired `cms/settings/express` fixture there (expectation now asserts it is forbidden) | 36 TS errors: taxonomy imports from pre-split `write-service.ts`, required `reportInternalError` not supplied in tests, `SettingDefinitionRecord` path, stale `sqliteKernel(db)`; guard HW-module-state; 16 why-comments; lockfile importer; new remote-run-events test expected 404 (contract says 405) | `3741ddd8` (lockfile, `pnpm install` not frozen), `bf50ecea`, `0445585e` | GREEN |
| 28 | ext-r11b2 `8576159d` | `6c0f1534` | injection-debt 3-way | 1 why-comment (default filesystem gone) | `46cbb7d4` | GREEN |
| 29 | ext-media `fc8128b3` | `d179102e` | — | `./media/cover-image` (universal) imports parse5 (forbidden) and reaches widgets domain; HW-module-state; TS2375 | `46cbb7d4`: entry declared `node` (like `./widgets/html`), marker scanner listed shared, ReadonlySet, optional types | GREEN |

Group 4 reds (`2158d753`, `013a26bc`, `516d02c3`):
- rf2-a13 / a13: `escapeCapture`, `doc`, `activeSelector` options accept `undefined` (exactOptionalPropertyTypes broke ui build). Its new `./browser` subpath made `src/browser` a domain that sketch-editor and admin-widgets cross → `src/browser` listed shared.
- a04-a52, rf-a51: module-level Sets typed `ReadonlySet` (guard).
- a05: `renderA2uiSurface` put the optional `@jini-ai/protocol` peer on the default path → moved to its own opt-in subpath **`@jini-ai/agentic/render-surface`** (removed from the root/core barrel; changeset updated).
- a57: `toRouteTemplate` moved `src/browser` → `src/core/routing` (used by `./react` and `./browser`); catch assigns its fallback (error gate).
- rf-a51: a refused bootstrap's error was dropped → new optional `onBootstrapFailed({ error })` on `readInitialSession` (failing test first). Its loopback test expected `host` for `not-127.0.0.1`, which WHATWG URL refuses as invalid IPv4: row corrected, still refused.
- rf-b09 (`satisfies` → annotation), a61 (fake event cast), contract tests missing rf-b09 `./secrets/root-key` and rf-a51 `./session-bootstrap`, a12-b09 test named a consumer app.
- **env-j1 parser change: kept, judged intended.** `parse-env` issue values now go through the shared `echoEnvValue`, which runs `redactSecrets` on allow-listed shown values before truncation. Stricter than before (secret-shaped text in a non-secret value is redacted), no caller relies on the raw echo; core 3102 pass. Revert = restore the local `echo()` in `parse-env.ts`.

## EXTRA FIX (owner-delegated)

`721ac2a4`: `@jini-ai/admin` `AdminMediaProvidersKit.rules` now declares ui's one-object shapes: `sortProvidersByConfigured({ catalog, providers }, { pinnedIds })`, `isEntryPresent` / `isMarkerOnlyEntry` / `maskedKeyLabel` / `isProviderBaseUrlInvalid` `({ entry })`, `invalidBaseUrlProviderIds({ providers })`. ProvidersTab, the testing kit and tests follow. **Tovu can pass ui's functions directly** in `apps/admin/src/integrations/jini-kits.ts` (drop the adapter lambdas and the "still positional" comment).

## Skipped

- **codex/ex-log** (contains ex-hookinj, ex-hw): 57 conflicted files / 69 hunks. (1) **Design-level clash with ext-r11b2**: ex-log gives `readMcpConfig`/token store an optional default Node `filesystem` port plus `report`, ext-r11b2 made the files port required — needs an owner call (suggest: keep r11b2's required port, take only ex-log's `report` option). (2) Three hunks are ex-log edits inside code that other merges moved (`cms/widgets/resolver-service.ts` 1204 lines → fsplit-j-cms files; `ui/panel-kit/use-settings-slice.hooks.ts` and `user-management/react/users/Users.tsx` → fs-j-hooks files); these need the move-and-reapply treatment. (3) ~30 hook-injection hunks duplicate injections already on the branch (hooks-a/b, J4) — take HEAD. (4) `provisionAgentPluginMcpServers` and others need HEAD's args shape plus ex-log's `report` option. Not finishable inside the budget with tests.
- **codex/jini-wave-a3**: not on origin.
- Not merged by instruction: `codex/ex-env*`, `codex/ex-err-jini`, `wave2/chat-deps`.

## Group tests (full suites, worktree)

- G1 `a03281ab`: daemon 4808, core 3074, cli 592, desktop-host 718, devops 1279, ui-kit 232, user-management 1291; related: ui 1969, admin 34, chat 641.
- G2/G3 `9af0f7b3`: admin 3059, core 3074, cookie-consent 181.
- G4 `013a26bc`: agent-runtime 4512, agentic 1146, cli 604, cms 4422, core 3102, admin 3087, ui 8775; platform 2 + user-management 1 red (contract lists) → fixed `516d02c3`, then platform 3288, user-management 1348.
- G5 `62484795`: daemon 4828, mcp 1861, platform 3288, ui 8775, user-management 1 red (public-args) → fixed `bf50ecea`.
- G6/7 `46cbb7d4`: cms 4565, mcp 1872, http-kit 735, server 468, user-management 1348, agent-plugins 2178, integrations 2071, daemon 2 red → fixed `0445585e`. core 2941 (was 3102): ext-j2 moved the 8 `core/settings/express` test files to http-kit with the code, not lost.
- Final `0445585e`: admin 3087, ui 8794, daemon 4821, chat 9 red: ex-css's new ChatSettingsDialog CSS test read the stylesheet via `new URL(..., import.meta.url)`, which is not a file URL under jsdom → fixed (path.resolve, the package's existing idiom), 16/16; chat otherwise 4464 pass.

## Final gates (tree `a13d1bc2`, repo root)

| command | base | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` |
| `pnpm -r --no-bail --if-present run typecheck` | 0, 0 | **0**, 0 |
| `npx tsc -p scripts/tsconfig.json --noEmit` | 0 | **0** |
| `pnpm guard` | 0, zero violations | **0**, zero violations |
| `SIZE_BASE_REF=0b0784e8 node scripts/check-size.mjs` | 0, 89 entries | **0**, 71 entries (59 functions, 12 files) |
| `COMPLEXITY_BASE_REF=0b0784e8 node scripts/check-complexity.mjs` | 0, 6 | **0**, 2 |
| `node scripts/check-hook-injection.mjs` | 0, ok | **0**, ok |
| `node scripts/check-why-comments.mjs --base 0b0784e8` | 0 | **0**, ok (allow-listed with reasons: 1 cookie-consent, 1 rf2-a13, 16 ext-j2, 1 ext-r11b2) |
| `node scripts/check-why-comments.mjs` (terra) | 0, 169/169 | **0**, ok |
| `node scripts/check-error-gate.mjs` | 0, BASE-RED 24 | **0**, the same 24, none new |
| `pnpm api:check` | 0 | **0**; 496 hash drifts not attributable by name left on the old baseline |

## Jini exported signatures that changed (for the Tovu run)

292 attributable entries in `cloud-results/combine-5-jini-api-changes.txt` (admin 63, cms 51, daemon 35, core 28, ui 25, http-kit 22, user-management 15, platform 14, mcp 12, agent-runtime 12, cookie-consent 8, cli 3, agentic 3, chat 1). Changed (not just added):
- **admin**: AdminKit `mediaProviders.rules` (above); J4: every domain's `create*Controller` / module binding (`bindReact`, `ReactViews`, `agentPlugins`, `comments`, `forms`, `media`, `redirects`, …) and kit slots (`ConfirmDialog`, `Dialog`, `ErrorNotice`, `HtmlEditor`, `InfoTip`, `Lightbox`, `Select`, `TabBar`, `WidgetSelect`, `OverlayHost`); `toRouteTemplate` (new in `./browser`).
- **cookie-consent**: `boot({ win })`, `browserPorts({ win })`, `installOpeners`, `purgeStorage` (storage now optional), `parityCss`, `resolveCopy`, `safeHref({ url })`, `scopedSelector({ selector })`.
- **daemon**: every `*HttpDeps` now requires `reportInternalError` for direct handler use; `*Routes({ deps, host })` take `deps` without it (ext-j2). `AgentExecutorRunInput`, `AttachmentsHttpDeps`.
- **mcp**: `readMcpConfig`/`writeMcpConfig`/token functions take the required files port (ext-r11b2); hosted store `parseEnvBlock({ text, ports })`, `parseArgs({ raw })`, `parseAllowedToolNames({ raw })`, `parseWriteAllowedToolNames({ raw })`, `parseOAuthScopes({ raw })`, `sealExternalMcpOAuthPayload({ deps, identity, payload })`, `readEnabledExternalMcpConfigs`/`listExternalMcpServerViews({ deps, workspaceId })`, `toResolvedFederatedConnections({ configs }, { readOnlyRemoteNamesByServer })`; `createFetchMcpHttpExchange`, `InMemoryExternalMcpServerRepo`.
- **ui**: `subscribeOutsideClickOrEscape({ container, onClose }, { escapeCapture })`; `useSettingsSlice`, `useStandingDraftAutosave` (hook injection), `TabBar`, `Icon`; new `@jini-ai/ui/browser` subpath.
- **user-management**: `useUsers`; `readInitialSession(ports, { onBootstrapped, onBootstrapFailed })`; new `./session-bootstrap` subpath.
- **agentic**: `renderA2uiSurface` / `DEFAULT_RENDER_REJECTION_GRACE_MS` only from `@jini-ai/agentic/render-surface`.
- **core / http-kit / cms**: settings/express moved to `@jini-ai/core/settings/express` and http-kit; `@jini-ai/cms/settings/express` retired. `planFormDeliveries` (b12). `chat`: `CHAT_BUBBLE_STYLE`.

## Left / next step

1. **ex-log**: owner decision on the mcp files-port clash with ext-r11b2, then merge on this tip (take HEAD for duplicate hook injections; re-apply its edits in the fsplit-j-cms / fs-j-hooks split files).
2. fs-j-hooks left more positional exported helpers in `user-management/react/users/hooks/*` (`createUsers*Action(state)`, `useUsersResetMutation(port, …)`, `createUsersErrorDescriber(translate)`) — the public-args test accepts them (TypeReference params), the owner rule does not.
3. Tovu: drop the media-providers adapter lambdas; update callers for the signatures above.
4. Not run: e2e (no playwright), `pnpm test:scripts` (base-red per earlier runs).
