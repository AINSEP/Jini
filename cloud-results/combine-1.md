# combine-1 (Jini): `integ/merge-2026-11-17`

Cut from `origin/refactor/terra` = `65d73b0d5`. Companion Tovu branch of the same name (cut from `232764af5`). Node 24.22.3, pnpm 10.33.2. Setup: `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (exit 0 on the unmodified base). Base ratchet outputs recorded before the first merge. Never force-pushed; `refactor/terra`, `main`, `plan/*` not touched.

## Merges (one `--no-ff` each, in the requested order)

| # | Branch | Merge SHA | Result |
|---|---|---|---|
| 1 | integ/wave1-merge-2026-11-17 | `f2cf71df2` | merged, clean (new package `@jini-ai/node-adapters`) |
| 2 | wave1/xpkg-G-TESTS-0-R12d | `2d167f0b7` | merged, clean |
| 3 | wave1/xpkg-R10a-R12a | `b574f7085` | merged, clean |
| 4 | wave1/xpkg-C9c-C12OBS | `595de2862` | merged, clean |
| 5 | wave1/hooks-sweep-1 | **SKIPPED** (merge was made locally, gates run, then reset with `git reset --hard HEAD^1`; never pushed) | see below |
| 6 | fix/b07-copy-overwrite | `1eaad7487` | merged, clean |
| 7 | ci/why-comment-gate | `5121c4363` | merged, clean |
| 8 | fix/vendor-names-out-of-core | `7cc807e6e` | merged; report-only (its `fixes-2.md` is byte-identical to the one the why-comment-gate merge already added), so an empty-tree merge commit |
| 9 | wave2/daemon-r7 | `92b5f8bd9` | merged, clean |
| - | api baseline regeneration (separate commit) | `6c52ae449` | see below |

No merge had a conflict.

### Skipped: `wave1/hooks-sweep-1` (86cbf7753), reason: adds ratchet lines
Clean merge, build/typecheck/tests green (chat, ui changed tests pass), `pnpm guard` 0 and `check:hooks` flipped from red to green (448/584 -> 207/287 direct hook calls). But the branch's own report already says so: the default-parameter injection adds branches and lines, and **`pnpm check:size` and `pnpm check:complexity` fail on it** (both passed with no new line on the tree before). Measured on the merge:
- `check:complexity`: 15 New violations: chat `QuestionsPanel` 11, `TodoCard` 11; ui `AssetCard` 13, `AssetGrid` 12, `ByokProviderForm` 12, `LocalCliAgentCard` 12, `ExternalMcpTab` 11, `FileDropzone` 12, `ClientPicker` 11, `IntegrationsTab` 12, `SkillRow` 11, `SkillsTab` 12, `VersionMetadata` 11, `VersionPreviewFrame` 12, `MarkdownSplitPane` 11.
- `check:size`: 2 New + 7 Worsened `max-lines-per-function` (`AssetCard` 81, `AssetGrid` 82, `AppearanceTab` 82, `ConnectorDetailDrawer` 101, `MemoryList` 93, `MemorySettingsPanel` 95, `NotificationsTab` 97, `SkillRow` 107) and `max-lines` `MemoryConnectedPanel.tsx` 530 (baseline 513).
Fixing needs the hook-calling part of ~18 components extracted into small child components (the way Tovu's `SkillsOverlays` was done), which does not fit "<= 3 commits". Output kept at `/tmp/rat/skipped/J-hooks-sweep-1/` (container only). Next step: do that extraction on the branch itself, lower `scripts/hook-injection-debt.json`, then merge. The Tovu half (`wave1/hooks-sweep-1`, admin/desktop sites) merged fine in Tovu.

## Gates after each merge (build + typecheck of the changed packages and their dependents, `tsc -p scripts/tsconfig.json`, changed-file tests, `pnpm guard`, `check:size`, `check:complexity`, `check:hooks`)

Every merge 1-4 and 6-9: install 0, build 0, typecheck 0, scripts typecheck 0, changed-file tests all 0 (merge 1: admin, chat, cli, core, daemon, diagnostics, mcp, node-adapters, platform, plugins, server, sqlite, user-management and `scripts/__tests__`; merge 2: core, ui, and `node --test` on agent-plugins vercel/netlify 99/99; merge 3: agent-runtime, core, oauth, provider-plugins; merge 4: user-management; merge 6: platform; merge 7: `node --test scripts/__tests__/check-why-comments.test.mjs` 22/22; merge 9: core, daemon, http-kit, server). Output of `pnpm guard`, `check:size`, `check:complexity`, `check:hooks` diffed against the tree before each merge: **no new line**, except two advisory/total counters that are not violations: guard "injection advisory" test-import count 383 -> 392 (advisory, "not failing") and `HW9-env-access: 76 -> 77 total; 0 new` (merge 3: R10a added one baseline entry on purpose, the branch report asks the owner to accept or hand `commandShell` in from the host).
`check:hooks` exits 1 on the base too (32 entries, `useT` in `packages/ui`); the final output is identical except the counts (448 components / 584 calls vs 451 / 587 on base, from the notes-waveA admin hook injection).

## Final tree (`6c52ae449` + this report)

| command | result |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm --no-bail -r build` | exit 0 |
| `pnpm typecheck` (all packages + `tsc -p scripts/tsconfig.json`) | exit 0 |
| `pnpm guard` | exit 0 (base 0); diff vs base: advisory 383 -> 392, HW9 76 -> 77 total (0 new) |
| `pnpm check:size` | exit 0, output identical to base ("157 debt entries (133 functions, 24 files); 8 accepted exceptions") |
| `pnpm check:complexity` | exit 0, identical to base ("17 entries (3 cyclomatic, 14 cognitive)") |
| `pnpm check:hooks` | exit 1 as on base (32 entries, pre-existing); no new line (counts down 451->448 components) |
| `pnpm check:errors` (WARN mode, exit 0) | base "18 new or worse"; final **"20 new or worse"**: +2 `packages/admin/src/react/entities/FailureNotice.tsx` (`catch-reads-error`, `no-generic-failure-text`), code from the notes-waveA admin work inside `integ/wave1-merge-2026-11-17`; recorded, not fixed (not one of the required ratchets, WARN-only) |
| `pnpm check:why-comments` against `origin/refactor/terra` (recorded, NOT fixed) | exit 1: 76 files with removed lines, **3 comment blocks lost**: `packages/agent-runtime/src/invocation.ts:1-11` `[15004f5ecbb6]` (header comment reworded in place by R10a), `packages/server/src/index.ts:92-93` `[4452cb29ccc9]` (frontend-control comment), `packages/ui/src/react/__tests__/fake-ui-kit.tsx:7` `[59a948bdb122]` (file moved to `testing.tsx`, comment reworded) |
| Changed test files of every merged branch re-run on the final tree (71 files, per package) | all 0: admin 25, agent-runtime 10, chat 3, cli 4, core 63, daemon 70, diagnostics 38, http-kit 9, mcp 95, node-adapters 11, oauth 6, platform 13, plugins 3, provider-plugins 233, server 14, sqlite 5, ui 4, user-management 17 tests pass; agent-plugins `node --test` vercel/netlify 99/99 |
| **Full** package test suites of every touched package on the final tree (`npx vitest run --minWorkers=1 --maxWorkers=2` in each package) | all exit 0: admin 2871, agent-runtime 4479 (+1 skipped), chat 4434 (+1), cli 592, core 2975, daemon 4729 (+1), diagnostics 997, http-kit 570, mcp 1805, node-adapters 11, oauth 819, platform 3117 (+6), plugins 1011, provider-plugins 883, server 508 (+1), sqlite 10, ui 8584, user-management 1246; agent-plugins `node --test` (all `*.test.mjs`) 1410 pass / 0 fail |

### api baseline (`pnpm api:update`), commit `6c52ae449`
`pnpm api:check` (exit 0) printed drift for admin, core, daemon, diagnostics, mcp that did not exist on the base, plus the base's own pre-existing drift (platform/infra/cms/chat/devops/http-kit/agent-runtime/server lines). I did **not** run `pnpm api:update` as is (it would rewrite files for the pre-existing drift too). I ran it into a scratch copy, then patched only the lines `api:check` shows after the merges and did not show on the base: 35 lines in 5 files: `jini-ai__admin.json` (18: `AdminEntityListQuery`, the `EntityDetail/Edit/EditProps/List/ListProps/ScreenDependencies/createEntityPanel/missingRequiredFields` hashes under `.`, `./core`, `./react`, `./react/entities`), `jini-ai__core.json` (6: `RouteMatch`, `RouteTableOptions`, `createRouteTable`, `createInMemoryServer`, `expandBatchContexts`, subpath `./approval-batch-chain`), `jini-ai__daemon.json` (4: `registerToolCatalogRoutes` removed, `toolCatalogRoutes` added, two route hashes changed), `jini-ai__diagnostics.json` (5: `./web-evidence/capture-budget` + `./web-evidence/testing` subpaths, `TimedOutPhase`, `RenderPageOptions`, `RenderSession`), `jini-ai__mcp.json` (2: `McpServerLike`, `McpToolServerOptions`). After the commit `pnpm api:check` exits 0 and its output equals the base's except that it is shorter: the base's `platform ./runtime-ports/*` and `server` drift lines are gone because the merged wave1 branches fixed them.

## Not done / next step
- `wave1/hooks-sweep-1` (see above).
- Owner: HW9 +1 (R10a), the 3 why-comment blocks, the 2 `FailureNotice.tsx` WARN entries.
- The coordinator fast-forwards `refactor/terra` after reading this and the Tovu `combine-1.md`; the Tovu branch needs this Jini build (the Tovu `wave2/daemon-r7` commit pairs with Jini `3a712f55`).
