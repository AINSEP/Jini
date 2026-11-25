PARTIAL bf1519bba7 ad71bf68d | FILES LEFT 1059 (excl. themes) / 526 | left: final gates have reds that were not compared with merge-22 (Tovu admin vitest 17 red / 8 files, node tests 61 not-ok in the 4688 run before the 40-min cap, Jini why-comments 2, Jini vitest commerce / daemon characterization / provider-plugins artifact); FIX 4 legacy sink (7 callers left); FIX 19 H2 general seam; bug 1 needs a real-app check; 6 tovu-theme 1.1.4 tests need an owner decision

> Code tips tested by the final gates: Tovu `bf1519bba7`, Jini `ad71bf68d`. This report's commit is on top of them. Wall-clock cap reached (14:30 → 16:55 UTC), so the gate reds below are reported, not triaged.

# combine-23 continuation (2026-11-25): Tovu + Jini `integ/merge-23-2026-11-25`

Unattended cloud run. Opus coordinated, with up to 4 workers at a time. Every fix, port and security item went to an Opus-high worker. Sonnet handled mechanical complexity refactors, the stale test imports and the FILES LEFT count.

**Programmer skill confirmed.** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer v1.7.5) first. Every worker brief carried its rules:
- root cause first;
- failing test first, plus a named mutation;
- never drop or soften a test;
- inject everything;
- hooks as required props;
- fn ≤ 80, complexity ≤ 10;
- no re-export shells;
- Jini stays neutral;
- themes untouched;
- features stay dark;
- never `--no-verify`.

**Setup:**
- Node 24.22.3.
- Jini: `pnpm install --frozen-lockfile` and a full build.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat. `link:jini` needed `JINI_PACKAGES_DIR=/home/user/Jini/packages`. Then hooks and a build of `packages/{contracts,sdk}`.

**Rules held:**
- No force-push, no `--no-verify`, hooks untouched.
- No tag, no publish, no codebase-memory tools, no RemoteTrigger.
- Only `integ/merge-23-2026-11-25` was written to.
- Every Tovu push passed the desktop pre-push gates. Two pushes were refused (3/6 and 4/6) while workers had files in flight. Both were fixed and re-pushed green. Nothing was bypassed.

## Fixes table

| item | status | Tovu / Jini commits | test → mutation |
|---|---|---|---|
| NEW BUG P11 ST-10 chat cleanup not mounted (admin tsc 2) | **DONE** | `fd95fa372` / `6097da065` | Jini `DockHeader` gets the required injected `conversationTools` (switcher extras + accessory slot). Tovu `DockCleanupHeader` takes the required `useChatCleanup`. `chat-cleanup.unit.test.tsx` 5/5, DockHeader 9/9. **M `chat-cleanup-slot-unmounted`** 1 red, **M `kit-list-hooks-not-forwarded`** 1, **M `dock-header-tools-slot-dropped`** 2. Admin tsc 0. |
| FIX 1 recovery admission trusts the envelope | **DONE** | `8e61ac22d` | The persisted user turn must carry `routineUserTurnId(run, slot)`. **M `recovery-skips-persisted-turn`** 2 red. |
| FIX 2 pending maps to error | **DONE** | `2878d0240` | New `starting` availability, `ROUTINES_STARTING` copy, discovery stays closed. **M `pending-maps-to-error`** 2. |
| FIX 3 routines dark + marker strip | **DONE** (pins) | `e5fe58a91` | `ROUTINES_RELEASE_ENABLED === false` pin. The strip and trusted-only insert tests are green. |
| FIX 4 legacy unbound sink | **PARTIAL** | `0f9a0dfc5`, `48bd5e36a`, `4b206cb5d` | All 18 listed sites are bound to the composed reporter. No-`res` sites take it as a required dependency. Shared probe test. **M `reporter-forwards-original-error`** 5, **M `fix4-unbind-sites`** 12, **M `seo-unbind`** 1, **M `consent-unbind`** 3. **Left:** 7 more unbound callers (`admin-json-route-ports.ts:299`, `analytics/recent-hits.ts:44`, `posts/template-preview.ts:70`, `http/widgets.ts:53`, `agent-plugins/install-response.ts:79`, `publish-content/import-errors.ts:32`, `route-helpers.ts:51`). The fallback in `sendAdminFailure` is still used by about 16 admin test files. So the legacy path stays and `reporter` stays optional. |
| FIX 5 P11 live cleanup without approval (security) | **DONE** | `3a7f5ca87` | `features/storage/cleanup-gate.ts`. A live run needs a grant minted by the existing card or the Storage "Review and confirm". The grant is pinned to a sha256 of the plan, single-use (`take`), principal-bound and expiring, and shared by HTTP and the tool. **M `cleanup-live-without-grant`** 13, **M `cleanup-grant-replay`** 3. The CLI `--apply` is local-owner only and unchanged. |
| FIX 8 cache trim outside the evidence gate | **DONE** | `ecc75028b`, `e1948993f` | Unknown or no-go evidence clears nothing. Trimming happens on erase only, never on untrack, so sign-in survives a re-add. **M `trim-bypasses-interlock`** 3. |
| FIX 9 raw `Error.name` in the log | **DONE** | `ecc75028b` | Bounded errno allowlist, else `unknown-error`. **M `log-raw-error-name`** 1. |
| FIX 10 daemon preflight imports http-kit | **DONE** | — / `15d418496`, `63eb04a73` | The route is declared at the core route seam. `AgentPluginPreflightRouteSpec`. Guard is the red→green witness. |
| FIX 11 html recording without a rollback boundary in memory | **DONE** | `c581050d6` | Required `recordedHtmlWrites` (memory=`disabled`, sql=`enabled`). The new sqlite pin was already green before the change, so it records existing sqlite behaviour. **M `html-record-no-rollback`** 2. Test count in `html-undo.integration` went 25→16: the memory-root loop was removed as instructed, and its cases are now "unavailable, nothing written" pins. **Owner note:** a site on the in-memory composition now refuses assistant HTML page writes. |
| FIX 12, FIX 15 theme deltas | **HELD** (unchanged) | — | Owner decides. See the 6 tovu-theme tests in New bugs. |
| FIX 13 AG-UI raw error sinks | **DONE** | `6fb28bcf4` | A required injected reporter. One sanitized incident and the generic `RUN_ERROR`. **M `agui-raw-error-sink`** 1. |
| FIX 14 acceptance reconcile | **DONE** (pins) | `e5fe58a91` | Browser marker strip, shared Stop, durable ownership. **M `agui-accept-keeps-browser-marker`** 1, **M `stop-skips-ownership`** 2. Admin AG-UI stays default-off. |
| FIX 16 site-update apply without a handoff | **DONE** | `bbffa1101` | `canApply` requires `runtime.handoff`, so the desktop and self-hosted defaults are check-only. 15 apply tests moved onto a fake durable supervisor (now 16). **M `apply-without-handoff`** 3. **Left:** the redispatch-once-after-restart pin needs the U4b supervisor, which is not on this branch. |
| FIX 17 O1.T stays unbound | **DONE** (pin) | `37021489f` | **M `o1t-observer-bound`** 2. |
| FIX 18 migration ordinal | DONE earlier | — | (previous part of this run) |
| FIX 19 typed actor at the write seam | **PARTIAL** | `241238e74`, `d3dc3401d` / `07b36390d`, `ed1fbd9a0` | `actor` is required at the import, restore and assistant writer seams (plus 2 more writers the type exposed). **M `writer-drops-actor-kind`** 1 / 2 / 1, **M `restore-ledger-drops-actor`** 2. **H2 stays open:** `ActorIdentityInput.actor` is still optional at about 68 sites, and the restore ledger has no `actor_kind` column (that needs an ADR-066 migration). |
| FIX 20, FIX 23 xAI | **DONE** | — / `8cff6fb19` | The core peer was already declared. The real gap was L3 exempting tsc-emitted plugin-packaging sources. Fixed, and the undeclared `@jini-ai/protocol` peer is now declared. **M `xai-core-undeclared`** 45 L3 rows red (8 in xai). A duplicate `./xai/media` key in package.json was collapsed. A clean packed-install check was not run. `guard:plugins:packed` has 3 pre-existing rows (ffmpeg-transcode `plugin.json`, model-proxy-anthropic dist, cms-forms tarball). |
| FIX 21 legacy share ciphertext | **DONE** + security bug | `54c84f584` / `637c25fcd` | A frozen pre-move fixture, generated once by the historical `6b9c36568` sealing code, opens through the browser-only owner route. **New bug fixed:** an expired share still revealed its password, and now returns `EXPIRED`. **M `share-legacy-aad-changed`** 1+1, **M `share-reveal-expiry-check-removed`** 2. **Owner decision:** owners can no longer read an expired share's password. |
| FIX 22 old specifiers / shells | **DONE** | `47614e743` | `development/scripts/check-moved-specifiers.ts` and its test. Zero old-specifier importers for A01/R08/R09. **M `old-specifier-import-back`** 1. The open shells (OAuth, mail, secrets, cms/settings) are listed in open-bugs. |
| FIX 24 unprefixed admin aliases | **DONE** | `629d9e99f` / `ef631b00e` | Only `admin-layout` and `admin-content` were live host contracts. 34 Tovu files moved to `jini-admin-*`; themes needed nothing. New check test. **M `unprefixed-alias-back`** 6+2. |
| FIX 25 b-g6c compare | **DONE** | `d347d6deb` / `8ca89de51` | Tool text is byte-identical to the pre-split code (fixtures pass on both). The transport literals are identical. The double close was a latent double release, and the single close is pinned. **M `double-close`** 2. K01–K03 and K04/K06 splits are recorded as NOT delivered. |
| pending bug 1 (Source Control providers empty) | **PARTIAL** | `c1cf03a7d`, `c8684bd0e` | Not reproduced with a fresh seed or the real composed bundle. A site **held on the pre-rename `tovu/github` copy** produces exactly this symptom: an empty list and no log line. It now logs a `[source-control-providers]` refusal naming github. **M `source-control-providers-empty`** 2. **UNVERIFIABLE-IN-CLOUD:** see below. |
| pending bug 5 (pre-existing reds) | **MOSTLY DONE** | `be998112e`, `feb0cd540`, `549eb2c6a`, `8c18bf4ae`, `881aa766d`, `8a20fb178`, `bbc0b2cd9`, `d1db6136b`, `3a0205fdf`, `a7c20f22d`, `fb821ef1e`, `6dcd22500`, `7e1b8647d`, `190be8481`, `ea0768712`, `290382e63`, `9e9cfbcb4` / `8b78fb049`, `f221e8c34` | Fixed: publish-zero-setup, wiring-identity row 7, CollectionEntries pill class, 14 test files failing to load, publish-agent-tools (7 hidden reds), tw4 pins (2), AG-UI error goldens, tool-registrations contracts (plus a real bug: `media_convert_video` had no risk class), widgets embed fixtures, the MCP-UI allowlist with routine ids (proved no dark leak: exchange-only), tool-contribution domains, the allowlist-completeness scan, trashed page 409 (Jini). Jini postgres stale-save: a PGlite cold start on a loaded host, fixed by warming it in `beforeAll`. **Left:** `copy-engine.postgres` needs a live Postgres. |
| pending bug 6 (stale debt rows) | **DONE** | — / `4f1dd0850` | 2 env-access rows pruned; the HW3 row was re-pointed after the `boundLogger` rename. |
| Jini guard red | **DONE** | — / `badbb6187` … `8cff6fb19` | 0 violations, 0 stale rows. Admin's `@jini-ai/ui/core` imports were replaced by kit copies, with a type-equality test. |
| gate fixes found while running | **DONE** | `a49de7660`, `e49f07a3d`, `f4d0cd6ec`, `bf1519bba` / `b48aa134b`, `d0aa05bc9`, `ffdf5f5d3`, `ad71bf68d`, `b3c7fe321` | typecheck:e2e (`beforeAddedRows` drift). Architecture: a new `features/post <-> platform` cycle and 2 cross-feature edges, broken through contracts. Tovu why-comments (8 restored, 2 debt rows). Jini complexity (21 functions split, no behaviour change). Jini why-comments vs merge-22 (2 restored, 13 debt rows citing commits). |

## Gates (final, Tovu `bf1519bba7` + Jini `ad71bf68d`; Jini built once at 16:04, no rebuild during tests)

**Jini:**
- build: 0.
- typecheck (strict): **0**.
- guard: **0** (merge-23 start: 12).
- api:check: **0**.
- hooks: **0**.
- complexity: **0**.
- why-comments `--base 311494d55` (merge-22): **2 blocks** deleted by the last complexity refactors (16:00 commits). Not fixed, out of time.
- changed vitest (every test file changed since merge-22, per package): **35 packages green.** 3 are red and were **not compared with merge-22**:
  - **commerce:** exit 1 with no FAIL line; probably a load error.
  - **daemon:** `http/__tests__/characterization/*` (22 tests). A worker saw the same 22 failing before its refactor, so they are probably pre-existing. The cause is `harness.ts` `mountEverything`.
  - **provider-plugins:** `artifact.integration` pack/install-outside-the-workspace tests. These are probably environmental (npm pack/install in the cloud) or a result of FIX 23's new peer declarations. Needs checking.

**Tovu:**
- root typecheck (incl. e2e): **0**.
- admin tsc: **0** (merge-23 start: 2).
- hooks: ok.
- boundaries: 0 errors.
- architecture: **OK**. merge-22 was red on 43 edges; this run is green. Runtime propagation cost 3.06→3.48 is a warning only.
- why-comments `--base d4a934da86 --other-root ../Jini`: **ok**.
- admin vitest (297 files changed since merge-22 plus direct importers, `--maxWorkers=2`): **6971 pass / 17 fail in 8 files**:
  - `request-volume.measurement`
  - `app-sites-section-visibility`
  - `panels-render`
  - `security/rules`
  - `admin-screens-manifest`
  - `api-request-shapes.characterization`
  - `panel-access-parity`
  - `panel-access`

  Not compared with merge-22. Most look like manifest/panel parity drift from the new P11 Storage screen and the routines screen.
- node tests (771 files changed in this continuation plus direct importers, concurrency 2): **4627 ok / 61 not ok** after 40 minutes. The run was cut off at the cap, so the files it never reached are not identified. Visible not-ok lines:
  - Postgres copy-engine 826–835+ (environmental: they need a live Postgres server);
  - 2 media catalog / model-view tests (433, 437; not triaged);
  - plus the rest in the log.
- desktop gates (`apps/desktop npm run gates`): **6/6 PASS**.

## UNVERIFIABLE IN CLOUD (owner must check)

- **Bug 1:**
  - On the real site, read `extensions.jini.id` in `<site>/agent-plugins/ws/workspace-local/github/package/sha256/<digest>/plugin.json`. `tovu/github` means a held pre-rename copy.
  - Read the boot line `[bundled-agent-plugins] 'github' stays on its current version …` and the new `[source-control-providers]` refusal.
  - Fix: reinstall github from Agent Plugins.
- Postgres-only tests: copy-engine (14), revision-thinning.postgres (2), the Jini migration runner.
- Packaged desktop:
  - the trim only on erase, gated on evidence (all-unknown today ⇒ nothing clears);
  - sign-in survives untrack and re-add;
  - routines stay dark.
- Storage cleanup in the real admin: preview → "Review and confirm" → live (one grant, a replay is refused). The chat approval card path.
- Share links: an expired share now refuses the owner's password reveal.
- Dev servers or e2e on the in-memory composition: assistant HTML page writes are refused (FIX 11).
- Clean packed install of `@jini-ai/provider-plugins` xai outside the workspace.
- Previous list still stands: the expired-link page, the media grid and viewer zone, the old `grok` key, AG-UI Stop in Chrome and Electron, `/llms.txt`, `tovu storage clean`.

## New bugs (found this run)

1. **FIXED:** an expired share still revealed its password to the owner (Jini `637c25fcd`).
2. **FIXED:** `media_convert_video` had no risk classification (`6dcd22500`).
3. **FIXED:** widgets embed fixtures were missing the A14 `widgetPostWrites` (merge regression).
4. **OWNER DECISION:** 6 tovu-theme tests ("Tovuize asks exactly one…", "Tovuize reuses local Media…", "draft homepage is previewed…", "survey comes before the single choice card", "tovu-theme packages … 1.1.4", "writes carry expectedVersion…"). They expect the 1.1.4 tovu-theme content that FIX 12 held back. Either admit 1.1.4 or hold those six tests back with it.
5. `bootstrap.ts` `logBundledIdUpgrade` says a held plugin "keeps working". That is false for a pre-rename copy: all of its `tovu-*.json` declarations go unread.
6. The admin Source Control page shows an empty list with no reason. The reason is in the server log only, because the route response lacks refusals.
7. The `.jini-status-draft` pill has no style in Tovu's `jini-media.css`.
8. Jini `pnpm guard` reports false SI-resolution rows when run before `pnpm -r build`, because of the generated cloudflare `cms-forms.mjs` and `portable-validation.mjs`.
9. The HW3 shell failure log, and its six module-scope buses, still need instance ownership. The debt is tracked.
10. Jini `provider-plugins` provenance comments still mention the source project and an env name. They pass the guard; the owner may want them neutralised.
11. `mcp-ui-tool-calls-route.ts` has a stale comment: "every allowlisted id is registered" is not true for dark routine ids, which are exchange-only.

## Per-area Jini-bound list (true / planner, excl. themes; Tovu `bf1519bba7`)

FILES LEFT **1059 / 526**:
- vs merge-23 @ `c8684bd0e`, 1057 / 524: +2. They are `contracts/core/post-revision-lock.ts` and `contracts/core/publish-trust-wire.ts`, pure contracts extracted to break the architecture cycle.
- vs `abd42dae5b`, 1040 / 507: +19. The other +17 are feat-p11 and b-g6c's new files (chat cleanup 4, admin storage 7, `tool-metadata/storage.ts`, post revision thinning 2, share expiry, own-folder and retention 3).

Method: `combine-18-plan.mjs` + `plans/P9-data/tools/scan.mjs` + the KEEP_RULES from `plans/count-1124/*`. It reproduces the earlier 1040 / 507 exactly at `abd42dae5b`.

| area | true | planner |
|---|---:|---:|
| adm-other | 73 | 173 |
| public-http | 47 | 86 |
| adm-shell-components | 32 | 49 |
| admin-http | 30 | 65 |
| agent-plugins | 28 | 44 |
| site-backup | 28 | 36 |
| post | 23 | 30 |
| deployments | 23 | 28 |
| adm-posts | 15 | 38 |
| adm-security | 15 | 23 |
| adm-deployment | 14 | 23 |
| publish-content | 13 | 15 |
| media | 12 | 15 |
| contracts-core | 11 | 33 |
| adm-shell-lib | 9 | 36 |
| trash | 9 | 14 |
| adm-pages | 8 | 22 |
| custom-credentials | 8 | 14 |
| project-keys | 8 | 8 |
| external-mcp | 7 | 11 |
| pages | 7 | 11 |
| identity | 6 | 13 |
| adm-publish-content | 6 | 11 |
| site-export | 6 | 10 |
| others (≤ 5 true each; incl. planner-only areas) | 88 | 251 |
