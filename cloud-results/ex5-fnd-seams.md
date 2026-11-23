PARTIAL 1a99406f12 6fdc55562: K4-seam-2 (BLOCK, B7 HTTP ABI cutover), K4-plugins-1 (STOP: persisted publisher "tovu-core"), K4-seam-5 publish-ports target (closure too large), K4-contracts-headless-1 assistant-tool-approval-policy + secret-form-cards (need K4-seam-1.T / host seam), K4-contracts-core-4 (no step sheet exists); lane-owned seam targets left to their lanes

# ex5-fnd-seams — FOUNDATION K4 seam splits (2026-11-23)

Unattended cloud run, Opus high coordinator plus 11 Opus-high batch subagents, 4 at a time. Started 23:45 UTC, report at about 01:35 UTC, so about 1 h 50 m of the 3.5 h cap.
- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`. Tovu `origin/integ/merge-13-2026-11-22` `f7185f153`. Tovu's tip is `0d7f78fa4` plus one docs-only commit, the combine-13 report.
- **Branches, plain `git push` only:** Jini `codex/ex5-fnd-seams-jini`, last content commit `6fdc55562`. Tovu `codex/ex5-fnd-seams-tovu`, last content commit `1a99406f12`.
- **Not used:** codebase-memory tools, force-push, `--no-verify`, tags, publish, RemoteTrigger.
- **Not touched:** `main`, `integ/*`, `plan/*` and `release/*` were only fetched.
- **Setup:** followed combine-13's Setup.
  - Node 24.22.3, pnpm 10.33.2.
  - Jini: frozen install 0, `pnpm --no-bail -r build` 0.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, all 0. `link-jini.mjs` linked this Jini branch. contracts tsc 0, sdk build 0.
  - PostgreSQL 16: role `la`, databases `jini_chat_test_ex5` and `commerce_test`.
  - The Jini clone was unshallowed so the XP and why-comments bases resolve.
- **Method (speed mode):**
  - Each batch worked in its own pair of git worktrees (`/home/user/wt/j<X>`, `t<X>`).
  - Subagents never committed, built or ran gates.
  - The coordinator reviewed each diff and resolved overlaps between batches: a single copy of `AdminSurfaceActionSchema` and `PluginConflict`, and the cherry-pick conflicts.
  - The coordinator wrote every core `package.json` export centrally, built, typechecked and tested each wave, then pushed.

## Owner-rule decisions taken in this run (please confirm)
1. **XP4 beats the sheet for K4-contracts-core-5.** The nine tool-metadata maps are runtime `const`s, so they went to `packages/core/src/tool-metadata/site/<name>.ts` (`@jini-ai/core/tool-metadata/site/<name>`), not `src/contracts/site/tool-metadata/`. XP4 forbids runtime statements under `core/src/contracts`.
2. **Jini-internal seam targets follow the landed K4-seam-1 pattern.**
   - Each gets an additive verbatim type copy in `core/src/contracts/site/<slug>.ts`.
   - The owning package keeps its declaration and exports until the paired cutover.
   - The Jini-bound Tovu users are not repointed; they repoint when they move.
   - The exception is **K4-seam-3**, where the fix doc mandates the paired cutover (see the batch table).
3. **Unions that the owning package derives from runtime tuples** (`(typeof X)[number]`, `keyof typeof REGISTRY`) are written in core as the identical literal unions, with a "Mirrors …" note. XP4 permits no values.
   - This affects cookie-consent, cms-forms `FieldType`, platform-mail activity, admin-surface actions and `RunFrameOutcome`.
4. **`SecretsVaultService` (K4-seam-13)** is a class upstream. Core declares its public method surface as an interface, with the same 10 signatures and the doc comments verbatim.
5. **Lane ownership (P9F-check line 63) was respected.** Lane-owned targets of seams 7/8/9/11/13/14–23 were skipped (listed below). The seam-13 Dashboard `daemon-tool-audit` contract had already landed in wave 1; it is additive and stays.

## Batch table

| batch | steps | Jini commit(s) | Tovu commit | Tovu files deleted | result |
|---|---|---|---|---|---|
| A | **K4-contracts-core-5** (9 of 10: files-copy, forms, identity, mail-status, media, media-import, navigation, observability, pages) | `00db92090` | `b0c358311d` | 9 | DONE. `media-generation` stays per fixcheck. Index plus 17 importers repointed. New core test `site-tool-metadata-identity.unit.test.ts` (4 tests) |
| B | **K4-seam-10** (daemon, plugins-host, db-data-modules, assistant-tool-contributions) | `5b38e563b` | `a0fb0ad344` | 1 (`assistant/tool-contributions.ts`, type-only) | DONE. mcp-ui secret-card and surfaces already in `@jini-ai/core/contracts/cards` (reused, no copy). |
| B | **K4-plugins-1** | — | — | 0 | **STOP**: both manifests carry `provenance.publisher: "tovu-core"`, persisted in `_plugin_identity` and compared strictly (a rename refuses as `consent-required`). Needs an owner decision: host-injected provenance (factory) or a P9-BREAKS migration |
| C | **K4-seam-5** (credential-token, user-management, agentic-core) | `7814f5421` | — | 0 | PARTIAL. `KyselyKernel` dropped (kysely type, K4db). `TovuPublishPorts` dropped: its closure is about 30 port types over 12 `@jini-ai/cms/*` subpaths plus host `PostRepoPort`/theme/media types, which is not "small, structural"; it needs the cms ports in core or a generic ports bag first |
| D | **K4-seam-4** (platform-mail) and **K4-seam-13** (protocol-mcp-ui, secrets-credential-sets, devops-deploy, cms-media, daemon-tool-audit) | `6d5835199` | `4790ffaa4d` | 0 | DONE/PARTIAL. 29 of 45 mail names already in `core/contracts/mail` (not duplicated). `MailTestModeSetting` reused from there (9 Tovu importers repointed). `DeployFile` (Buffer) and `PluginDeployHostKit` (typeof runtime helpers) dropped |
| E | **K4-seam-6** (user-management-react ports, cookie-consent, cms-forms) and **K4-seam-14** (agent-runtime, http-kit-settings, nav, agentic, events-outbox, agent-plugins-manifest, user-management-server) | `3714c9aeb` | `5ca90e5355` | 0 | DONE. React controller types dropped (no React in core). Admin `nav.ts` keeps `getNav`, and 7 importers repointed |
| F | **K4-seam-7** (agent-plugins-lifecycle), **-8** (admin-surfaces, admin ai-assistant API types), **-9** (runtime-mode, cookie-consent-react), **-11** | `ad38a80c4` | `8ace423af7` | 0 | DONE (shared targets). seam-11 `SealedSecret` already in `core/contracts/vault`. 32 Tovu import repoints |
| G | **K4-seam-12** (platform-site-dir), **-15** (search, agent-plugins-connect, daemon-http, consent-refusal; OAuthClient reused), **-16** (host-tools, analytics, host-node, public-page-security-headers, theme-slots) | `0caf9c6f5` | `f295e005bf` | 0 | PARTIAL. `SitesWorkspace`/`CreateSitePort` (runtime-derived, kernel closure), `outboxEventValues` and `zipFolderFiles` (runtime) dropped. 28 importers repointed |
| H | **K4-contracts-headless-1** (5 of 7) | `10b687788` | `89e907a8b3` | 6 (5 headless files + type-only `features/forms/delivery-status.ts`) | PARTIAL. `assistant-tool-approval-policy` stays: it needs the host rule union and K4-seam-1.T. `secret-form-cards` stays: its runtime values come from the host catalog. 61 importers repointed. The barrel drops the moved type exports (no `@tovu/headless` consumer used them) |
| I | **K4-seam-18** (chat-core, core-run-events, core-commands, assistant-mcp-services), **-19** (recovery-operation-lock, cms-core, http-kit-rate-limit, daemon-tool-recovery, permanent-deletes policy), **-20** (dev-restart) | `9ad5ccc24` | `e1a167dd36` | 0 | PARTIAL (shared only). seam-17: no shared target survived. Admin-theme hook types dropped (`HTMLElement`; core has no DOM lib) |
| J | **K4-seam-21** (platform-server-logs), **-23** (assistant-host-ports, boot-lifecycle, sandbox-node-worker, site-status) | `9e676a713` | `4590ff466f` | 1 (`features/tool-audit/tool-gaps.ts`, type-only) | PARTIAL. All seam-22 targets are lane-owned. Several targets dropped as runtime-derived or Buffer/kysely-typed |
| K | **K4-seam-3** (B4 paired diagnostics cutover) | `20e00fb99` | `9363e5f94c` | 0 | DONE. `Tracker` and its 5 span/context types plus `CaptureEvent` **moved** to `core/contracts/site/diagnostics-observability`. Diagnostics imports them from core and keeps a deprecated type-only re-export of the 6 public names (no API break, removed at the next major). 52 Tovu files / 54 import sites repointed, including 5 desktop files |
| — | export subpaths, API baseline, why-comments | `12180e05b`, `78954396e`, `6fdc55562` | `1a99406f12` | — | 69 new core subpaths: 55 `contracts/site` (including diagnostics-observability), 5 `contracts/headless` and 9 `tool-metadata/site`. `api:update`: 40 packages, 764 entries. 17 why-comments debt rows, all "Moved to Jini …, reworded neutral" |

**Tovu files deleted: 17.** **New core files: 69** (55 `contracts/site`, 5 `contracts/headless`, 9 `tool-metadata/site`). Every new file under `contracts/` is type-only and passes XP4.

## Steps skipped / not finished, and why
- **K4-seam-2:** BLOCK per fixcheck. It is deferred to B7 and needs the paired HTTP ABI migration: positional `send(request, options)` → core `send({ request }, options)`. The caller and fake inventory is still NOT-CHECKED. `HttpRequest`/`HttpResponse`/`EgressPolicy` already live in core.
- **K4-plugins-1:** STOP. The persisted publisher `"tovu-core"` is the issue. Owner decision needed (see batch B).
- **K4-seam-5 `TovuPublishPorts` → `PublishPorts`:** dropped, because the closure is too large. Prerequisite: the cms port contracts move into core first (a new step), or `PublishPorts` becomes a host-generic bag.
- **K4-contracts-headless-1:** `assistant-tool-approval-policy.ts` waits for **K4-seam-1.T** (not in this lane's scope). `secret-form-cards.ts` needs a host-injected secret-form catalog seam.
- **K4-contracts-core-4:** there is no step sheet and no `k-work.json` row on `plan/whats-left-1122`. Nothing to run.
- **K4-contracts-core-5 `media-generation`:** stays in Tovu, per fixcheck (vendor names in search copy).
- **Lane-owned targets (P9F-check line 63), left to the lane:**
  - Operations: gated-mutations `ports`/`gateway` (seam-7), `publish-content/ui/sections` (21), static export (18).
  - Comments: `capability-providers/comments` (8).
  - Security: `sites-api.types` (9), site-key-state (22).
  - Settings: `visitor-tools-management` (11).
  - Integrations: `admin-surfaces/connections`, `custom-credential-categories` (15), provider-config-source (22).
  - Pages: agentic DOM (17).
  - Desktop: packaging-electron, platform-process (17), desktop resources and durable-json (18).
  - Seam-20: DNS, MCP/vault, media providers, member trash, SDK/provider (20).
  - Commerce, Sites evidence and Add-ons skill install (22).
  - Feature-only by `rg`, to Add-ons/Sites: `sites-port.hooks` (17), credentialed-http, widgets-html, api-connections (19), seo-content-analysis (20).
- **Dropped as not core-eligible**: listed per batch above (kysely, Buffer, React, DOM, `typeof` runtime, huge closures).

## Which ex4 lane steps are now unblocked (K4 side)
These K4 prerequisites cited in the ex4 skip lists are now **landed**. Most steps still also wait on K5-contracts-core/headless, X-*, A-* or RT-K1-0.T, which are not this lane's work.
- **Add-ons:**
  - `K5-agent-plugins-1`: seam-6 is landed; it still needs seam-1.T.
  - `K5-plugin-runtime-1`: seam-7 is landed. seam-5 is partly landed: the shared types are in, publish-ports is not. seam-20 is lane-owned.
  - `K5-skills-1` and `K5-plugin-runtime-3`: headless-1 is landed, 5 of 7.
  - `K4-plugins-1`: seam-10 is landed, but the step itself is STOP (owner).
- **Integrations:**
  - `K5-platform-mail-1/2`: seam-4 is landed, seam-9 shared is landed; seam-2 is still BLOCK.
  - `K5-mail-1` / `K5-mail-status-1/2`: seam-4/13 and contracts-core-5 are landed; seam-5 is partial.
  - `K5-api-connections-1/2`: seam-13/8/15 shared targets are landed.
  - `K5-external-mcp-*`: seam-11 is reused from core; seam-5 is partial; seam-20 is lane-owned.
  - `K5-custom-credentials-*`: seam-10 and seam-15 shared are landed.
- **Media:**
  - `K4-asset-transfer-1` and `K4-image-transform-1`: contracts-core-5 is landed.
  - `K5-media-1`: contracts-core-5, seam-10 and seam-15 are landed; seam-5 is partial.
  - `K5-object-storage-1`: seam-13 is landed.
- **Settings:**
  - `K5-settings-1`: seam-4/13 are landed; seam-21 is landed (server-logs). It still needs seam-11's Settings-owned visitor-tools target (its own lane) and the held `site-title.ts`.
  - `K5-analytics-1`: seam-3/6 are landed.
- **Desktop:** `K5-desktop-1` still needs the Desktop-owned seam-17/18 targets (its own lane).
- **Security:** `SEC-8` has seam-5.J landed (shared part).

## Gates (base-diff; no new red)
**Jini** (base = `4902a6a1a`, final = `6fdc55562`):

| gate | base | final |
|---|---|---|
| build (`-r`) | 0 | core and diagnostics rebuilt clean, 0 `error TS` |
| typecheck | 0 | 0 |
| guard | 0 (HW advisory 492) | 0, identical |
| `api:check` | 0 | 0. All additions are subpaths; baseline updated to 764 entries |
| guard:plugins (3) | 0 | 0 |
| check:size / check:complexity | exit 1 (base rows) | exit 1, **identical** |
| check:hooks | 0 | 0 |
| check:why-comments (terra) | 10 not allow-listed (combine-14) | the same 10, none in this run's files |
| check:cross-package, **with declaration snapshot** (built at `35c4961af`, 3308 mappings) | combine-14: XP1 39 / XP2 33 / XP3 112 / XP4 760 / XP5 6 | **39 / 33 / 112 / 760 / 6, identical**. No row names a file this run added |

- **Package tests:**
  - core vitest: 86 files, 1402 tests, all green.
  - diagnostics vitest: 68 files, 1090 tests, all green.
- **Mutations:**
  - The contracts-core-5 identity pin `direct` → `plan` turns 3 of 4 tests red; restored green.
  - Seam-3 `TrackerSpan.setOutcome` rename gives 15 diagnostics type errors; restored clean.

**Tovu** (base = `f7185f153`, final = `1a99406f12`):

| gate | base | final |
|---|---|---|
| `npm run typecheck` (+e2e) | 0 | 0 |
| `typecheck:tests` | 0 | 0 |
| admin tsc | exit 2, 4 errors (Jini merge-14 `AdminKit` vs this Tovu base) | the **same 4** |
| desktop tsc preload / renderer / main / live-verify | 0 | 0/0/0/0 |
| check:size, check:complexity, check:hooks, check:errors | base | **identical** |
| check:boundaries | 0 | 0; 3 `no-deep-imports` and 2 `no-circular` warnings fewer |
| check:architecture | exit 1 | exit 1, improved: cross-feature edges 309 → 307, propagation 12.45% → 12.18% (runtime-only 3.29% → 3.27%) |
| check:why-comments | 80 open | **80 open**, after 17 "Moved to Jini" debt rows in `1a99406f12` |

**Tovu tests.** Each file was run alone with `node --test` using the root `npm test` imports, Postgres configured. Reds were re-run at base in a worktree that shares `node_modules`.
- **A+B:** 137 files. 134 green; 3 reds, all BASE-RED (`automatic-agent-plugins`, `domain-no-direct-tool-registration`, `mcp-ui-allowlist-completeness`).
- **D–J:** 856 files (the changed tests plus every test importing a changed file by basename). 814 green.
  - Of the 42 reds, 11 pass with Postgres (also at base).
  - 1 was a load timeout: `serve-command.integration`, 17/17 green alone in 382 s.
  - **30 are BASE-RED with identical pass/fail counts.**
- **K:** 128 files. 121 green; 7 reds, all BASE-RED with identical counts (e.g. `resolve-html-page-embeds`, `forms-submit`, `byok-message-attachments`).
- **Admin vitest:** 162 affected files, 4831 passed and 2 skipped, 0 failed.
- **Desktop:** the telemetry tests pass 18/18.

**Tovu mutations** were planted in the linked Jini `dist/*.d.ts`, then the Tovu tsc was run, then the file was restored and checked identical with `cmp`. Every one went red:

| mutation | Tovu type errors |
|---|---|
| seam-12 `SiteBinding.switcherCompatible` | 7 |
| seam-9 `RuntimeMode` `local→dev` | 11 |
| seam-21 `ServerLogEntry.seq` | 1 |
| seam-3 `setOutcome` | 13 |
| seam-19 `allowedToolIds` | 15 |
| headless-1 `pluginDataDir` | 4 |
| seam-10 `DuplicateResourceHandler.permission` | 5 |
| seam-13 `MailTestModeSetting.to` | 4 |

## FILES-LEFT
Measured with `plans/P9-data/tools/scan.mjs` and `plan.mjs` from `origin/plan/whats-left-1122`, on a clean worktree of each commit. FILES-LEFT = moving + shells.

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (theme 86 + adm-themes 25) | ready / blocked |
|---|---|---|---|---|---|
| base `f7185f153` | 2,483 | 3 | **2,486** | **2,375** | 541 / 1,942 |
| final `1a99406f12` | 2,467 | 3 | **2,470** | **2,359** | 543 / 1,924 |

That is **−16** files. Most of this lane's value is prerequisites, not file removals: 18 scanner steps moved from blocked to unblocked.

## Notes for review (Codex)
- **Test removed:** `plugin-boundaries.test.ts` dropped the two loop entries for `plugin-host.ts` and `plugin-export-catalog.ts`, which no longer exist in Tovu (4 → 2 tests). Core's XP4 gate now holds those files to a stricter rule.
- **Barrel change:** H removed moved type re-exports from `contracts/headless/index.ts` (`@tovu/headless`). An `rg` over admin found no consumer of those names.
- **Test artefacts:** the known `C13-test-writes-dev-site` artefact (`sites/tovu-dev/agent-plugins/`) reappeared after the suites and was deleted before committing.
- **Duplicate declarations in core:** none. `AdminSurfaceActionSchema` is declared once (admin-surfaces) and `PluginConflict` once (plugins-host); the other files import them.
- **Doc comments copied verbatim** keep a few `{@link}`s to names that live only in the owning package. These are text only.
