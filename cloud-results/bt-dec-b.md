PARTIAL e5e4a943b 79cfef81: left = A425 owner question (userMcp counted as write); AFTER-MERGE wiring for C026, xAI, B224, A212, G7-1, G7-4, G7-9, G7-11; G7-6/7 belong to the YES-item lane

# bt-dec-b — owner 11-23 "apply the recommendation" items

- Branches: Tovu `codex/bt-dec-b-tovu`, Jini `codex/bt-dec-b-jini`. Both are based on `integ/merge-16-2026-11-23` and merged with its latest head again before the final push (Jini +1 commit, Tovu +3, both clean). This report commit sits on top of `e5e4a943b`.
- Read first, as instructed: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5). Its rules were applied: red first, then green, a named mutation, the architecture audit and the pre-completion checklist. Each subagent got a shared brief that carried those rules.
- Method:
  - 7 subagents (Opus high for security, data-loss and cross-package work; Sonnet for small items), at most 4 at a time, none of them committing.
  - The coordinator reviewed each diff and committed and pushed.
  - Some items landed in the `wip(bt-dec-b)` checkpoint commits rather than in commits of their own. The stop hook forced a commit while the subagents were still editing. The commit column gives the SHA where each item's files first landed.
- AVOID list: files changed on `origin/codex/w3-*` against their merge-base with merge-15 (Jini 2528 files, Tovu 4017). No AVOID file was edited. Every change that needs one is listed below as AFTER-MERGE.

| item | status | commit | test |
|---|---|---|---|
| B258 `tovu_ak_` keys in Jini redactors | FIXED. AFTER-MERGE: `redactLocalText`→`redactTovuLocalText` in `apps/desktop/src/{desktop-agent-service,tovu-server,smoke-bridge}.ts`, `apps/desktop/scripts/check-tree-quiet.ts`, `composition/product-telemetry.ts`; `pnpm api:update` for diagnostics | J `a07c31c9`, T `9b70ac68f` | J `diagnostics/src/__tests__/extra-patterns.test.ts` (red 5/6 → 6/6; mutations: drop the loop → 3 red, drop forwarding → 2 red); T `packages/contracts/src/__tests__/diagnostics-redaction.test.ts` (4/4; mutation: drop the patterns → 3 red) |
| A287 staged-destination map | FIXED (optional `rootDestinations`; still throws without one). AFTER-MERGE: `pnpm api:update` for devops | J `a07c31c9` | J `devops/.../__tests__/staging-root-destinations.test.ts` (red: version-conflict throw; mutation: drop the lookup → red) |
| C026 vendor names → plugin manifests | AFTER-MERGE: inject the bundled manifests' `publicConfig` names at `composition/agent-plugin-connections.ts:185` and drop them from `admin-surfaces/public-config.ts:15`; read `clientNamespace` from the manifest in `api-connections/contribution.ts:77`. The guard is unchanged at 27 lines | — | guard `api-connections/__tests__/vendor-neutrality.test.ts` |
| A010 raster `/original` | FIXED (by design: 404 kept, public rendition path documented in `features/media/PUBLIC-URLS.md`) | T `9b70ac68f` | existing pin "IMAGE asset 404s here" |
| A287/B258 API baselines | AFTER-MERGE: `api-baseline/*.json` are AVOID; run `pnpm api:update` | — | — |
| A310 consent off → no forwarding | FIXED (pin + doc `features/analytics/README.md`; the behaviour already held). AFTER-MERGE: why-comment at the gate in `composition/analytics-providers.ts` | T `9b70ac68f` | `composition/__tests__/analytics-consent-off.pin.unit.test.ts` (mutation: gate → true, 2 red) |
| A337 switcher-off empty state | FIXED (English only; locales follow later) | T `9b70ac68f` | admin `sites/__tests__/site-import-switcher-off.unit.test.tsx` (red → green; mutation: change the copy → red) |
| A400 authored third-party scripts | FIXED (publish-time warning in the export report; no auto-inert) | T `9b70ac68f` | `site-export/__tests__/export-preflight.{unit,integration}.test.ts` (mutation: warn without consent → red) |
| A421 contact placeholder in exports | FIXED (export pre-flight warning) | T `9b70ac68f` | same files (mutation: detector false → red) |
| A425 prelaunch card for no-write runs | PARTIAL. The card is skipped and the disclosure kept (as a status event) when every requested key is read-only (`web`, `subagents`). **Owner:** `userMcp` counts as WRITE, so default Claude/Codex runs (their only key is `userMcp`) still get the card. Counting it read-only is a one-word change in `RUN_READ_ONLY_CONSENT_KEYS`. Note: a skipped card saves those read-only switches, the same as Allow | T `a6b741b3f` | `assistant/__tests__/agent-daemon-run-tool-access.no-write.unit.test.ts`, `run-has-write-access.unit.test.ts` (red: card shown; mutation: helper → false, 2 red) |
| B280 `@mcp-ui/client` | FIXED (kept; why-note in `site-chat/src/jini-surfaces.ts`, `knip.json` ignore) | T `343132d6e` | knip no longer flags it |
| B088 Calendly export without url | FIXED (closed by design; note in J `agent-plugins/calendly/README.md`) | J `6c7aea2e` | existing `cms/widgets/__tests__/plugin-export.unit.test.ts` |
| B224 slug → id at write | Jini FIXED (`normalizeWidgetSlugMarkers`). AFTER-MERGE: Tovu wiring in `features/pages/html-document-store{,.memory}.ts` `write()`/seed, plus the `widgetSlugLookup` dep at the 3 `pagesHtmlStore:` factory sites. It protects nothing until that lands, and there is no backfill | J `a07c31c9` | J `cms/widgets/__tests__/unit/widget-slug-normalization.unit.test.ts`: (a) entry_refs row, (b) where-used sees it (mutation: skip normalisation → a, b red) |
| B230 /products via sendPublicPage | FIXED | T `4d8fb09e6`, `7aef177db` | `routes/site/__tests__/products.finalize.route.test.ts` (red 4/4; mutation: old send → 4 red) |
| A212 agent video > 10 MB | helper FIXED. AFTER-MERGE: in `features/media/tool-registrations.ts`, `.map((r) => withLargeUploadRouting(r))` | T `4d8fb09e6` | `features/media/__tests__/large-upload-routing.test.ts` |
| xAI media entries → provider plugin (read old id, write new) | AFTER-MERGE: J `integrations/src/media-providers/providers.ts` is in flight | — | — |
| admin-agent HTML tagging only on request (G7-13) | FIXED (the prompt in `contracts/core/page-html.ts`; there was no automatic pass in code) | T `9b70ac68f` | `features/pages/__tests__/webmcp-tagging-on-request.test.ts` (mutation: "always" → 2 red) |
| G7-1 new-site password | helper FIXED (`identity/first-owner-password.ts`, ERR-OWNER-PASSWORD-REQUIRED; desktop pinned byte-identical). AFTER-MERGE: call it in `identity/wiring.ts` only when seeding a new owner, and pass `ownerEnv` from `identity-settings.ts` | T `a6b741b3f` | `identity/__tests__/first-owner-password.test.ts` (mutation → 3 red) |
| G7-2 dev CORS | FIXED (off outside dev; admin Vite origins allow-list). Optional AFTER-MERGE: inject from `public-middleware.ts:45` | T `a6b741b3f` | `inbound/shared/__tests__/dev-cors.test.ts` (mutation → 2 red) |
| G7-3 menu HTML needs `pages.edit_html` | FIXED (it already held: `modules/menus.ts:82`) | — | `routes/menus/__tests__/menu-html-mode.test.ts` 10/10 |
| G7-4 trash retention 30 d | AFTER-MERGE. Apply `cloud-results/bt-dec-b/g7-4-jini-retention-30.patch` and `g7-4-tovu-trash-ui-copy.patch` together. The Jini half alone turns `member-adapter.test.ts` red, and the admin screen would still say "60 days" | T `be14ef83d` (patches) | the patch carries `retention-days.test.ts` (red 3/3 at 60) |
| G7-5 Q-M2 | FIXED (plan-only: decide it with the media single-limit step) | — | — |
| G7-6/G7-7 email retention | AFTER-MERGE: the same as the owner's YES item (sent-email 30 d / test-email 7 d / clear all), which another lane owns. Not duplicated here | — | — |
| G7-8 pre-consent cache | FIXED (`private, no-store` before consent when gated scripts are present) | T `9957b3360` | `pages/__tests__/pre-consent-cache.test.ts` (mutation → red) |
| G7-9 captions | Jini FIXED (`renderVideoTag(..., { captionsTrack })` emits a safe `<track kind="captions">`; `text/vtt`→`vtt`; `MediaCaptionsTrack` type). AFTER-MERGE: the `MediaRecord` field together with Tovu `publish-content.ts` `MEDIA_FIELDS`, a column + migration, `.vtt` upload/serve, and renderer wiring in `render/widgets/media.ts` and `render/doc/nodes-media.ts` | J `6c7aea2e`, `c826b6f8`, `79cfef81` | J `cms/widgets/__tests__/caption-track.test.ts` (mutations: allow any src → red; drop the track → red) |
| G7-10 catch-await handlers | FIXED (plan-only: P4-T4 sheet) | — | — |
| G7-11 `<<SUBAGENT_DISPATCH>>` | helper FIXED (`assistant/subagent-dispatch-marker.ts`). AFTER-MERGE: `agent-daemon-run-start.ts:378` plus 2 pinned tests | T `9b70ac68f` | `assistant/__tests__/subagent-dispatch-marker.unit.test.ts` (mutation → red) |
| G7-12 theme `/` layout | FIXED (parked) | — | — |
| G7-14 observability adapter / ffmpeg | FIXED (stay off / not bundled; no change) | — | — |

## Gates (after the final merge)
- Jini base: guard 1 violation (`HW3-module-state packages/admin/src/shell/lib/shell-failure-log.ts`, pre-existing); typecheck 0.
- Jini tip:
  - The build of core, cms, diagnostics and devops exited 0.
  - `pnpm guard`: 1 violation, the same pre-existing HW3. A new N1 hit from my own comment was fixed in `79cfef81`.
  - `pnpm typecheck`: 0 errors.
- Jini vitest:
  - diagnostics extra-patterns 6/6
  - devops packaging/electron 218/218
  - cms widgets + media 1490/1490
- Tovu base: `npm run typecheck` 0.
- Tovu tip:
  - `npm run typecheck` 0 (0 `error TS`).
  - All 14 changed node test files pass, each run alone.
  - admin `src/features/sites` vitest 513/513.
- Known reds, not from this lane:
  - 3 assistant wiring tests (executable-tools, session-resume, tool-restriction) also fail on the pre-change file.
  - `describe-error-for-log.unit.test.ts` "hostile getters" failed in a wide run. It was not re-run on base.

## Unverifiable in cloud (owner to check locally)
- G7-2: with CORS now off in plain `npm run dev`, the admin should still work through Vite's `/api` proxy. The live dev stack was not run.
- A425: the real Claude/Codex prelaunch path in a live run.
