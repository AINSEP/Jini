# opus-codex-test-fix-3 — test, fix red, remove excess (2026-11-18)

Bases: Jini `2b19a9f2d` (integ/merge-3-2026-11-18), Tovu `db24620ee`. Node 24.22.3, Jini `pnpm install --frozen-lockfile` + `pnpm -r build` (exit 0), Tovu `npm ci` + `link-jini.mjs` + contracts/sdk build.
Per branch: build touched packages; `tsc --noEmit` of touched packages + every dependent (`pnpm -r --filter ...{pkg} typecheck`); vitest of touched packages (`--maxWorkers=2`); Jini `guard`, `check:size`, `check:complexity`, `check:hooks`, `check:why-comments --base 2b19a9f2d`; Tovu `typecheck`, `typecheck:tests`, `check:size/complexity/architecture/errors/hooks`, `check:why-comments --base db24620ee`; Tovu `apps/admin`, `apps/site-chat`, `apps/desktop` tsc against each Jini branch's built dist (via the link) for old-shape callers.

## Base results (recorded first)

- Jini: guard / size / complexity / hooks exit 0. Tests: ui 8742, cms 4419, admin 3018, vibecoding 364, sidecar 339 (+2 skipped), user-management 1291 — all pass.
- Tovu: typecheck 0, typecheck:tests 0, size/complexity/errors/hooks 0, **check:architecture exit 1 on base** (branch output compared line-for-line; no new lines on either Tovu branch).
- Tovu node tests, base failures (not the branches'): tv-misc2 test set 3828 tests / **25 fail on base** (Postgres-backed transfer tests + secret-scan-guard); `server/runtime` set 1803 / **33 fail on base**. Admin `src/features/posts` 700 pass.

## Per-branch table

| Branch (tip tested → pushed) | New type errors | New failing tests | New gate lines | Disables | Behaviour defects | Excess removed | My fix commits | Result |
|---|---|---|---|---|---|---|---|---|
| Jini `codex/ui-1` 440b5d9e → 8f32cb36 | 0 | 1 (NotificationsTab characterization: `playSound` call-shape assertion stale) | check:size 2 ("lower debt" for useAnnotationCanvas 739→737, 880→878) | 0 | none | none | `1ef46781` size debt, `8f32cb36` test call shape | GREEN |
| Jini `codex/ui-2` a539dbb9 | 0 | 0 | 0 | 0 | none | none | — | GREEN |
| Jini `codex/ui-3` 361c7f57 → 0db61efa | 13 (examples/reference-web) | 0 | complexity 2 (`dedupeToolUsesById`, `chatActivityToProgressCard` 11); why-comments 1 | 0 | **yes**: sweep rewrote `examples/reference-web` callers of the example's *own* `createEarlyMessageBuffer(maxBuffered)` (signature unchanged) to the ui package shape | 0 (the defective examples edits reverted: 12 lines) | `f6db926f` restore examples callers, `703c63d9` complexity, `0db61efa` why-comment allow-list | GREEN |
| Jini `codex/ui-4` 2571e779 → b6f6dd4b | 48 (`viewer-shell/__tests__/rules.test.ts` left on positional calls; also failed the ui build) | 0 | complexity 2 (`parseDeckStateMessage`, `groupItemsByStatus` 11) | 0 | none | none | `944e2ea3` test call shape, `b6f6dd4b` complexity | GREEN |
| Jini `codex/fs-cms` 1a409bef → aac6a8c0 | 0 | 0 | 0 | 0 | none | 1 line (`widgets/resolvers/taxonomy.ts` findTaxonomy temp) | `aac6a8c0` | GREEN |
| Jini `codex/fs-vibe` b7fe9f49 → 2c30d54c | 0 | 0 | 0 | 0 | none | 1 line (`vibecoding/src/html/regions.ts:263` `regionDeps` copy of `deps`) | `2c30d54c` | GREEN |
| Tovu `codex/tv-misc2` 84e722a7 | 0 | 0 (same 25 as base) | 0 (architecture identical to base) | 0 | none | none | — | GREEN |
| Tovu `codex/tv-fsize-runtime` 9f89d2d8 → 5beecb9f | 0 | 0 (same 33 as base) | complexity 1 (`openPeer` debt re-keyed by the hoist) | 0 | none | 41 lines (`composition/app.ts` `createMemoryRootContext`: identity function that destructured all ~80 `MemoryRootContext` fields and returned them unchanged) | `d10beedd` excess, `5beecb9f` debt re-key | GREEN |
| Jini `codex/hooks-a` (review) 74e459bb | — | — | check:hooks ok at current tip | 0 | none | 0 by me | none (see below) | GREEN on hooks gate |
| Jini `codex/hooks-b` (review) 0fbbbb86 | — | — | check:hooks ok at current tip | 0 | none | 0 by me | none | GREEN on hooks gate |

Notes:
- ui-1..ui-4: no React component or hook signature changed (AST comparison of every `use*` / capitalised `.tsx` declaration, base vs tip). ui-3's `useAssetCardRenderer` param type text changed only to the equivalent `Parameters<typeof resolveFacetLabel>[0]['labelsByValue']`.
- All test fixes only update stale call sites/expected call shapes; no assertion removed or weakened. Test counts unchanged (ui 8742 on every ui branch).
- Complexity fixes use `_optional?: Record<string, never>` (51 base precedents) or restore base's optional `options?` instead of a defaulted parameter, which ESLint counts as a branch.
- ui-3 why-comment: Codex removed `escapeJsString`'s positional string overload and its comment ("Existing string call retained for published surface builders"). No string caller exists in Jini or Tovu; allow-listed in `scripts/why-comments-debt.json` with that reason.
- hooks-a / hooks-b: at start both tips failed `check:hooks` (hooks-a 7 entries, hooks-b 17: nested `hooks: {…}` bags and `const { useXHook = useX } = props` are invisible to the gate). I fixed hooks-a locally (flat defaulted props, dropped the duplicate `hooks` seams, 2 override types, extra union arm, resolver), but the other run pushed the same fix first (`902fb97a`, `bf48d4c0`, `74e459bb`; hooks-b `c21c65f7`, `0fbbbb86`), so my commit was discarded unpushed. Remaining minor shape choices on their tips (not clear excess, left): BubbleScene/TotpSettings take a child's hook only to forward it; `BubbleHooks` type; `isTotpRemovalDisabled` helper; admin `kit.tsx` repeats the widened slot type twice.
- fs-vibe (+965/−845) and tv-fsize-runtime (+949/−644): the remaining growth is the signature + context-destructure cost of hoisting closures into ≤50-line top-level functions; no duplicated bodies or unused helpers found beyond the two removals above. 55 single-use `const { x } = context;` lines in fs-vibe were left (they keep moved bodies byte-identical).

## Tovu (db24620ee) call sites left on the old shape — not edited

From Tovu tsc against each Jini branch's built dist (base Jini: 0 errors in these configs).

- ui-2 (8): `apps/admin/src/components/AssistantDock/execution-config-write.ts:76,77,78`; `apps/admin/src/components/AssistantDock/hooks/AssistantDock.hooks.tsx:495`; `apps/admin/src/features/ai-assistant/hooks/use-visitor-credential-form.hooks.ts:427,657`; `apps/admin/src/features/ai-assistant/rules.ts:102,239`.
- ui-3 (5): `apps/admin/src/components/AssistantDock/__tests__/commit-folder-approval.contract.unit.test.ts:7`; `apps/admin/src/components/AssistantDock/hooks/AssistantDock.hooks.tsx:1791`; `apps/admin/src/features/settings/ExternalMcpSettingsPanel.tsx:202,317,461`.
- ui-4 (14): `apps/desktop/src/renderer/import-drop.ts:27`; `apps/desktop/src/renderer/use-workspace-chat-pane.hooks.ts:88`; `apps/admin/src/__tests__/render-with-jini-kits.tsx:23`; `apps/admin/src/features/fs-files/hooks/use-folder-drop.hooks.ts:288`; `apps/admin/src/features/observability/hooks/use-observability-tab.hooks.ts:12,19,22`; `apps/admin/src/integrations/jini-kits.ts:24` (×6: AdminKit `mediaProviders.rules` port still typed positional); `apps/admin/src/main.tsx:87` (same kit).
- fs-cms (4, tests only): `apps/website/src/assistant/__tests__/tool-registrations.contracts.test.ts:348`; `apps/website/src/features/trash/__tests__/entry-sql.characterization.test.ts:113`; `apps/website/src/features/trash/__tests__/member-adapter.test.ts:167`; `apps/website/src/features/trash/__tests__/trash-list-items-honesty.test.ts:9`.
- ui-1, fs-vibe: none. `apps/desktop` main/preload/renderer: 0 on base and on ui-1/2/3.

## Decisions needed

1. `_optional: Record<string, never> = {}` costs one complexity point; Codex's sweeps pushed four functions at 10 over the ratchet. I used `_optional?:`. Confirm that as the form for at-limit functions (or prefer splitting).
2. ui-3 dropped `escapeJsString`'s positional `string` overload — a published-API break for any external string caller (none in Jini/Tovu). Keep the removal?
3. Tovu's AdminKit port (`apps/admin/src/integrations/jini-kits.ts`) types the ui `mediaProviders.rules` functions positionally; landing ui-4 needs that port updated in the same Tovu bump.
