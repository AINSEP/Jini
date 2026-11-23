PARTIAL cb9e8d4304 5b01f58a8: X-plugin-runtime-1/X-agent-plugins-1/X-skills-1 done as far as the owner rules allow (6 files moved, 14 STAYS); K4-plugins-1, K5-plugin-runtime-1–3, K5-agent-plugins-1/3–8, V-agent-plugins-2, K5-skills-1, A-K2-plugins-1–4, A-K2-skills-1, RT-K1-adm-{plugins-1–5,agent-plugins-1–5,skills-1/2,plugin-hook-error-1}, RT-K1-pub-{agent-plugin-surfaces-1,plugin-contributions-1}, BX-24–26, RN-J1/T1/J2 left (prerequisites not landed or owner-held), C-contracts-core-1 owner-held

# ex4 — Add-ons lane (plugins, agent-plugins, skills), 2026-11-22

Unattended cloud run, Opus high. No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish. `main`/`integ/*`/`plan/*`/`release/*` were only fetched.

- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`; Tovu `origin/integ/merge-13-2026-11-22` at `0d7f78fa4` as instructed (the branch tip `f7185f153` adds only the combine-13 report).
- **Branches pushed (plain `git push`, `git pull --rebase` before each):**
  - Jini `codex/ex4-addons-jini`: `62b0ebe7a` (X-plugin-runtime-1.J), `5b01f58a8` (X-agent-plugins-1.J), then the report-copy commit.
  - Tovu `codex/ex4-addons-tovu`: `f11e63bdb` (X-plugin-runtime-1.T), `9d92dbb5b6` (X-agent-plugins-1.T), `cb9e8d4304` (why-comments debt rows), then this report's commit.
- **Setup:** as combine-13. Node 24.22.3, pnpm 10.33.2 (corepack shim, since the global pnpm 10.28 fails Jini's `engines`), npm 11.19.1.
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0. Jini was unshallowed so `check:cross-package`'s base `35c4961af` resolves. `origin/refactor/terra` was fetched for why-comments.
  - Tovu: `npm ci --ignore-scripts` in root/admin/desktop/site-chat 0/0/0/0. `link-jini.mjs` was run against **this run's Jini branch**. The changed packages were rebuilt after each Jini commit, and the links point at the live package dirs. `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Spec read:** `P9F-check.md` (Add-ons row), `P9F-feature-lanes.md` (Add-ons section, Foundation-owned feature steps), the step sheets, `k-work.json`, `P9-extraction.md` §1, `P9K-extraction.md` §2, `P9K-fix-B1-B3.md`, `P9U-check-v2.md`, `P9K-codex-verify-mech.md` (Codex's B14 BLOCK on X-agent-plugins-1 and its screen-out of X-plugin-runtime-1/X-skills-1), `P9-BREAKS.md`, `reviews/*.md`.

## What was runnable
Every Add-ons step (lane selector plus the P9F-check additions, 205 files in `k-work.json`) was checked: do its sources still exist in Tovu, are its destinations free in Jini, and are its prerequisites landed in these bases. Nothing in the lane had landed before this run.

Only the three zero-dependency X sheets were unblocked: X-plugin-runtime-1, X-agent-plugins-1 and X-skills-1. Codex had already flagged all three as carrying host bindings. So each file was judged under STOP-3: product copy, policy, persisted vocabulary and host bindings STAY. The neutral files moved, and the rest of each step continued as allowed.

## Steps

| step | files moved (Tovu → Jini) | importers repointed | tests | mutation | status |
|---|---|---|---|---|---|
| X-plugin-runtime-1 | 2 of 7: `plugin-runtime/install-consent.ts` → `@jini-ai/plugins/runtime/install-consent`; `plugin-runtime/plugin-tool-ids.ts` → `@jini-ai/plugins/runtime/plugin-tool-ids` (both `universal`) | 5 (`cli/commands/plugin/install.ts`, `install-tool-binding.ts`, `host-tool-binding.ts`, `source-tools.ts`, `tool-registrations.ts`) | moved: `install-consent.unit.test.ts` → Jini `runtime/__tests__/install-consent.test.ts` (import lines only), 4/4. Tovu: 65 files (sheet list + every test importing a changed file), **748 pass / 8 fail in 3 files, all BASE-RED** (identical at `0d7f78fa4`) | sheet's target `agent-tools.ts` STAYS, so the plant went in the moved code: `if (p.hasCode)` → `if (!p.hasCode)` in `install-consent.ts` → **4/4 red**; restored (byte copy), 4/4 green | DONE (5 STAYS) |
| X-agent-plugins-1 | 4 of 12: `admin-surfaces/capabilities.ts`, `admin-surfaces/forms.ts` → `@jini-ai/agent-plugins/site/admin-surfaces/*`; `descriptor-i18n.ts`, `memory-i18n.ts` → `@jini-ai/agent-plugins/site/*` (all `universal`; the two admin-surface entries take the `admin-surfaces` isolation domain, see below) | 8 (3 production: `composition/agent-plugin-connections.ts` ×2, `source-control/provider-registry.ts`, `agent-plugins/uninstall-confirmation-ui.ts`; 5 test import lines) | moved: `capabilities.unit.test.ts`, `forms.unit.test.ts` → Jini `site/admin-surfaces/__tests__/` (import lines only), 12/12. `descriptor-i18n.unit.test.ts` and `memory-i18n.unit.test.ts` stay in Tovu as the sheet says (repointed). Tovu: 52 files, **711 pass / 4 fail in 3 files, all BASE-RED** (assertion diffs byte-identical to base) | sheet's target `bundled-source-root.ts` is a fixture for the STAYS catalog, so: `workspaceId !==` → `===` in `forms.ts`'s guard → **2/12 red**; restored, 12/12 green | DONE (8 STAYS) |
| X-skills-1 | 0 of 3 | — | — | — | STAYS (all 3, below) |

Admin vitest (no admin file changed): 64 files, **889 pass / 0 fail**. That covers every `apps/admin` test importing `@jini-ai/plugins` or `@jini-ai/agent-plugins`, plus all `features/plugins` and `features/skills` tests.

Raw outputs: `cloud-results/ex4-addons-raw.txt`.

### STAYS (STOP-3), with reasons
- **X-plugin-runtime-1:**
  - `agent-tools.ts` and `plugin-tool-messages.ts`: model-facing guidance copy that names the product ("Tovu has two unrelated systems…", "restart Tovu"). It is product copy with no args object to inject into.
  - `built-ins/content-analyzer/index.ts`: the persisted extension id `extensions.tovu` / `"tovu/content-analyzer"`. Renaming it changes stored identity.
  - `sdk-resolver.ts`: `resolveDefaultSdkModulePath()` does `require.resolve('@tovu/sdk')` from its own file location. From a Jini package dir it would resolve against Jini's `node_modules`, not the host's bundled SDK. That is a behaviour change, and the default would need a new injected path.
  - `source-tool-catalog.ts`: tool copy names the host env var `TOVU_PLUGIN_LOCAL_INSTALL=1`. It is a const with no args object.
- **X-agent-plugins-1:**
  - `bundled-catalog.ts`, `bundled-id-upgrade.ts`, `admin-surfaces/public-config.ts`: Codex B14. They hold the host's seeded plugin set, the `tovu/`→`jini/` id migration with its host-digest guard, and the host env allowlist.
  - `soon-lock.ts` and `retired-plugin-tool-aliases.ts` import the bundled catalog.
  - `deploy-split-activation.ts`: a vendor-named, host-specific activation migration (Cloudflare Pages → Cloudflare, `migration:cloudflare-plugin` actor, interacting with host `system:seed` seeding).
  - `executable-tools/approval-bindings.ts`: its own doc says "Exact approval-card copy belongs to the host".
  - `executable-tools/approval.ts`: binds that host copy into Jini's `createAgentPluginDisclosure`. It would need to import the host file.
- **X-skills-1:**
  - `install-adapters.ts` injects the vendor libs `yauzl` and `js-yaml` into `@jini-ai/agentic/skills/install`. `@jini-ai/agentic` declares neither, and the Jini API takes them injected by design.
  - `state.ts` pins the persisted `.tovu-install.json` filename. Renaming it would orphan every installed skill's state.
  - `live-registration.ts` is the host binding that supplies the product's inactive-skill wording to Jini's `createLiveToolRegistration({ inactiveError })`.

### Skipped steps (prerequisite not landed in these bases, or owner-held)
Checked by source/destination existence for `k-work.json` steps, and by destination files for the K4 seams.
- **K4-plugins-1** ← K4-seam-10 (no `core/contracts/site/{plugins-host,daemon,mcp-ui-secret-card,…}.ts`).
- **K5-plugin-runtime-1** ← K4-seam-5/7/20.
- **K5-plugin-runtime-2** ← K5-plugin-runtime-1, K5-contracts-core-3/6/10, K4-contracts-core-5, K5-contracts-headless-2, K4-seam-1 (partly landed: `integrations-webhooks` target missing), K4-seam-16, C-platform-html-1 (2 of 3 dests), C-contracts-core-1 (owner-held).
- **K5-plugin-runtime-3** ← the same, plus K4-contracts-headless-1, K4-seam-3 and V-post-5.
- **K5-agent-plugins-1** ← K4-seam-6 (no `core/contracts/site/{user-management-react,cookie-consent,…}`), K4-seam-1 (partial).
- **V-agent-plugins-2** ← K5-contracts-headless-2.
- **K5-agent-plugins-3/4/5/6/7/8** ← the V-agent-plugins-2 / K5-agent-plugins-1 chain, plus K4-seam-3/10/14/15/19, K5-contracts-core-2/4/10, K4-contracts-headless-1, K5-api-connections-1 (1 of 9 dests).
- **K5-skills-1** ← K5-contracts-core-6, K4-contracts-headless-1 (X-skills-1 itself is all STAYS).
- **A-K2-plugins-1–4, A-K2-skills-1** ← A-K2-0 kit, K4-seam-8, K4-i18n-common, A-K2-shell-lib-1/4, A-K2-shell-components-2/3/8, A-K2-shell-hooks-3, A-K2-integrations-1, A-K2-providers-1, A-adm-shell-components-1/2, A-adm-shell-lib-1/3, A-adm-shell-hooks-1, A-adm-other-2/3/5. None of those is landed.
- **RT-K1-adm-{plugins-1–5, agent-plugins-1–5, skills-1/2, plugin-hook-error-1}, RT-K1-pub-{agent-plugin-surfaces-1, plugin-contributions-1}** ← RT-K1-0 (no `core/contracts/server/route-refusal.ts`), plus each sheet's K5/K4 deps.
- **BX-24–26** (SDK type dedupe into `core/contracts/plugin-sdk`): no step sheet or `k-work.json` file list exists. The public SDK ABI change needs a sheet first.
- **RN-J1 → RN-T1 → RN-J2:** RN is sequenced as "the last slot of a night, so in-flight P9 sheets are not rebased onto renamed names". Other ex4 lanes are in flight tonight.
  - RN-J1 also drops `LEGACY_PLUGIN_SDK_SPECIFIER`/`PLUGIN_SDK_SPECIFIERS`' `@tovu/sdk` alias from Jini `plugin-format.ts`. Tovu's `sdk-resolver.ts`, which stays, imports exactly those constants. So RN-J1 needs a paired Tovu change that the sheet does not list.
- **C-contracts-core-1:** owner-held (guard regex).

## Owner-rule notes on the diffs
- **Moves:** verbatim. The only edits are:
  - same-package `@jini-ai/<pkg>/x` imports became relative `.js`;
  - test `node:test` → `vitest` import lines;
  - two comment rewordings: `capabilities.ts` "Tovu's" → "The host's" (N1), and `descriptor-i18n.ts`'s two host path citations named in words (N2).
  - Every `_optional = {}` pad and every why-comment moved unchanged.
- **Two `why-comments-debt.json` rows** (`99d57d50db5a`, `37e1c39b50ae`) record those two reworded headers as "Moved to Jini". This is the same practice as ex-export, and the gate is back to the base 80.
- **Isolation:** `pnpm guard`'s SI-domain rule puts an entry in the domain of its first export segment, `site`. `site/admin-surfaces/forms.ts` constructs `AdminSurfaceActionError` from `src/admin-surfaces` at runtime. Both admin-surface entries are therefore declared in `jini.isolation.entries` as domain `admin-surfaces`, the same mechanism `./manifest` → `lifecycle` uses. No new cross-package edge (XP gate unchanged).
- **No re-export shells.** No new layer or port. No function grew. No new `@jini-ai/*` dependency or lockfile change.
- **Changesets:** `.changeset/p9-x-plugin-runtime-1.md`, `.changeset/p9-x-agent-plugins-1.md` (patch).
- **api-baseline deltas:** only added entries.
  - `@jini-ai/plugins`: `./runtime/install-consent` {`PLUGIN_INSTALL_STAYS_OFF`, `pluginInstallConsent`, `pluginInstallRiskSentence`} and `./runtime/plugin-tool-ids` {`pluginManagementToolIds`, `pluginSourceToolIds`}.
  - `@jini-ai/agent-plugins`: `./site/admin-surfaces/capabilities` {`createAdminSurfaceCapabilities`}, `./site/admin-surfaces/forms` {`createSurfaceForms`}, `./site/descriptor-i18n` {`DescriptorI18n`, `parseDescriptorI18n`} and `./site/memory-i18n` {`memoryText`}.

## Gates (base → final; no new red)
- **Jini** (base `4902a6a1a`):
  - guard 0→0, api:check 0→0, typecheck 0→0, hooks 0→0, errors 0→0, `pnpm -r build` 0.
  - Red at base, output identical at final: size 1, complexity 1, why-comments 1 (10 blocks), cross-package 1 (XP5 rows).
  - vitest plugins 1,017 → 1,021 (+4 moved), agent-plugins 2,195 → 2,207 (+12 moved), all green.
- **Tovu** (base `0d7f78fa4`, Jini branch linked):
  - typecheck (+e2e), typecheck:tests, desktop tsc ×4, boundaries, complexity, hooks, errors, worker-import-graph: 0 → 0.
  - Red at base and equal at final: admin tsc 2 (Jini merge-14 kit fields `Icon`/`useT`/`values` absent from Tovu merge-13's `jini-kits.ts`; not this run), typecheck:scripts 2, size 1, why-comments 1 (80 → 80 after the debt rows), architecture 1.
  - Architecture: runtime-only propagation 3.29 → 3.30. This is the same single ratchet row as base, moved by the smaller denominator (2,271 → 2,265 files). Cross-feature edges 309 → 308, API surface 687 → 683. Boundaries: modules 6,773 → 6,770, 112 warnings → 112.

## FILES-LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, plan ref `18f1b17c0`)
| tree | moving | shells | **FILES-LEFT** | themes excluded (`theme` 86 + `adm-themes` 25) | Add-ons areas (agent-plugins / plugin-runtime / plugins / skills) |
|---|---|---|---|---|---|
| base `0d7f78fa4` (clean worktree) | 2,483 | 3 | **2,486** | **2,375** | 65 / 34 / 2 / 7 = 108 |
| final `cb9e8d4304` | 2,477 | 3 | **2,480** | **2,369** | 61 / 32 / 2 / 7 = 102 |

Base equals combine-13's final (2,486 / 2,375). The difference is −6, one per moved source file.

## Minor findings (LISTED, not fixed)
1. `apps/website/src/features/plugin-runtime/install-tool.ts:24` comment still says "`install-consent.ts`, which the CLI prompt still uses". The file now lives in Jini `@jini-ai/plugins/runtime/install-consent`.
2. `development/scripts/check-architecture.baseline.json:245` still lists the edge `source-control/provider-registry.ts -> agent-plugins/descriptor-i18n.ts`, which no longer exists. combine-13 listed similar stale rows.
3. `plugin-tool-ids.ts` moved verbatim with its doc "Host-owned catalog ids…". The ids are shared vocabulary that Jini's `source-drafts.ts` already names, but the doc now reads oddly in Jini.
4. `memory-i18n.ts` (plugin note/uninstall dialog labels in every admin locale) moved per the sheet. It holds no product name, but Codex should confirm it counts as neutral UI copy rather than product copy (K3).
5. Base-red tests seen in this run, all identical at base:
   - `assistant/mcp-ui-allowlist-completeness` 9/1;
   - `agent-plugins/bundled-ui-ux-design-package` 3/4;
   - `composition/plugin-host.integration` 22/3;
   - `assistant/automatic-agent-plugins.integration` 41/2;
   - `api-connections/vendor-neutrality` 1/1 (C026, open);
   - `composition/wiring-identity` 5/1.
6. The global `pnpm` on the image is 10.28.0, below Jini's `engines` (≥10.33.2). Nested `pnpm -r` calls fail until a corepack shim is first on `PATH`.

## Next step
Codex review of the two Jini and three Tovu commits. After that, the Add-ons lane waits on Foundation: K4-seam-{1,3,5,6,7,8,10,14–16,19,20}, K5-contracts-core/headless, RT-K1-0, A-K2-0 and the A-adm shell sheets. The first Add-ons steps those unblock are K4-plugins-1 (after K4-seam-10) and K5-agent-plugins-1 (after K4-seam-1/6).
