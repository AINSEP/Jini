PARTIAL 799626bbd9 b5bef0b36: shell components-5..11 (AssistantDock body, TemplateSource, pickers), shell-hooks-2/3/4, shell-lib-1/7 rest + K2-STOP files, XC-6d, XC-1..5, BX rendering/composer, RT-K1 shared route sheets, plugin-install-source copy decision

# w3-fnd — FOUNDATION shared seams/contracts/rendering + admin kit/shell + cut #8 (2026-11-23/24)

Unattended cloud run. Opus (high) coordinated, and every implementation step went to a subagent: 19 Opus-high subagents and 1 Sonnet subagent, in waves of at most 4, on disjoint files. Subagents never committed. I reviewed every report and diff, then did the commits, the shared-ledger edits, the gate fixes and the pushes myself.

- **Programmer skills:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Its rules were applied and passed into every dispatch via a common rules file: RED-first for behaviour changes, a named mutation per moved logic file, why-comments move with the code, and the pre-completion checklist.
- **Branches:** Jini `codex/w3-fnd-jini`, Tovu `codex/w3-fnd-tovu`. Plain `git push` only. No force, no `--no-verify`, no tags, nothing published.
- **Base:** `origin/integ/merge-15-2026-11-23` in both repos. Its latest head was merged again before the final gates (Jini `60c6cd52a`, Tovu `33701312a1`; both report-only). On top of it I merged `codex/ex6-fnd-shared-a-*`, `ex6-fnd-shared-b-*`, `p12-cut7-*` and `p12-cut46-*`:
  - Jini: union-resolved conflicts in `api-baseline/jini-ai__core.json`, `media-providers/dispatch/types.ts` and `packages/admin/README.md`.
  - Tovu: site-key tuple and parity test (Core union kept, both-direction `expectTypeOf` added), `why-comments-debt.json` (JSON union), and the cut-7 escape/slug repoints over merge-15's CMS repoints.
  - The Tier-2 worker `trustedImports` now names `@jini-ai/cms/html/site/slug`. `analyze-content.ts` imports it after cut #7; leaving the old specifier would have made the allowlist refuse it.
  - No merge was skipped.
- **Setup:**
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm -r build` 0.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat (0/0/0/0); `link-jini.mjs` 0; `packages/contracts` tsc 0; `packages/sdk` build 0.
- **Codex review:** pending. Every commit below is for Codex to review before merge.

## FIX items (Tovu `origin/plan/whats-left-1122:reviews/rv1123*.md`), each verified against current code

| Review / branch | FIX | Status |
|---|---|---|
| rv1123g `p12-cut46-jini` | 1. One shared header-merge stage | **Applied** Jini `242479483`: new `core/transport/merge-headers.ts`, used by `createHttpTransport` and `buildFetchInit`. Tests first: 6 red on old code. `buildFetchInit` used to drop `Headers`/tuple headers; that bug is fixed and pinned. Mutations: precedence flip (6 red), spelling drop (2 red). |
| rv1123g `p12-cut46-jini` | 2. Two-object signatures | **Applied** `242479483` (Jini) + `0e3d9158f2` (Tovu test caller). |
| rv1123g `p12-cut46-tovu` | 1. Ledger row + zero credit | **Applied** `81749ce890`: row text recorded in `cloud-results/p12-cut46.md`, since lanes do not push `plan/*`. Unblock credit for cut #4: 0 transport files. |
| rv1123e `ex6-fnd-shared-b-jini` | 1. Engine `guardedFetch` required | **Applied** Jini `fa927e174` + Tovu `c83b44b1a3`: hosts bind `nodeMediaGuardedFetch`. Test first; mutation: restoring the `??` default makes the new test red. |
| rv1123e `ex6-fnd-shared-b-jini` | 2. Tool-turn / base-URL ports | **Applied** `fa927e174`: `modelProxy.toolTurns` and `research.baseUrlGuard` on the preset, bound by reference-web and minimal-host. Mutation: hardcoded `validateBaseUrl` makes it red. |
| rv1123e `ex6-fnd-shared-b-jini` | 3. One legacy owner-store contract | **Applied** `fa927e174`: `@jini-ai/core/contracts/site/legacy-owner-store`; `options: Partial<Options> = {}`; README examples fixed. |
| rv1123e `ex6-fnd-shared-a-tovu` | 1. No second `AdminSiteKeyState` | **Applied** in the merge: runtime tuple kept and pinned to the Core union in both directions; the Dashboard imports already point at Core. |
| rv1123e `ex6-fnd-shared-a-tovu` | 2. Why-comment parity | **Applied** Jini `148924df8`: all five per-state explanations are carried onto Core `AdminSiteKeyState`. Tovu ledger rows in `c0d9df6344` / `17439c335d`. |
| rv1123a `ex5-fnd-kit` | 1–4 | **Already satisfied** on this base: no raw-error logging in `content-refresh-bus`, nav dictionary split, no Core fallback in `browser-stream`, `admin-http/config` gone, Select pass-throughs gone. |
| rv1123a `ex5-fnd-inject` | 1 | **Already satisfied:** daemon test fixtures bind `@jini-ai/node-adapters/process` (now injected builders, see XC-6a). |
| rv1123a `ex5-fnd-routes` | 1, 2 | **Already satisfied:** no `chat.db` in the tree; `sea-runtime` takes its fallback injected; timeline takes `isTimelineValidationError` via deps. |

## Batch table

| batch | model | files moved / changed | importers | tests | status |
|---|---|---|---|---|---|
| **cut #8** AdminKit 0c `SettingsDialogTab` (F8.1–F8.4) | Opus | 8 Tovu screens take the tab type and the `Icon`/`I18nProvider`/`SettingsDialogShell` facades from the kit. A kit gap was closed: `SettingsDialogShellProps.labels` (`SettingsDialogChromeLabels` mirror). Commits: Jini `0771cae80`; Tovu `2e4913f10d`, `8034a123eb`. | 8 (multi-line census) | bidirectional assignability contract test. Mutation `kit-tab-panel-field-rename`: Tovu tsc red. 70 files / 949 tests green. | **DONE.** Skills.tsx is kit-clean. Residual `@jini-ai/ui` per file: Observability, Recovery, Authentication, AgentPlugins → `SETTINGS_DIALOG_DICTIONARIES`; use-observability-tab → `findActiveTab`/`resolveInitialActiveTabId`/`useTabbedDialog`; AiAssistant → +`ByokProviderForm`, `ExecutionTab`; SettingsUi → tab panels + config types. |
| **C-contracts-headless-1** (+ K4-seam-19) | Opus | 4 contracts moved to `@jini-ai/core/contracts/headless/*` (Jini `0771cae80`, Tovu `14172119b3`). `member-login/public-path.ts` (forwarder) deleted. | ~30 | characterization test moved (mutation: extra `AdminPost` branch → red); website node tests green | DONE. `assistant-permanent-deletes-policy` (host policy/copy) and `plugin-install-source` (product copy in a model-facing schema string) stay; see Owner decisions. |
| **K4-seam-4..13** | Opus | DbOpsPort/RestoreCapability, visitor-tools management types → core (Jini `6699c32b5`); ~270 import-only repoints; `visitor-tools-management.ts` deleted (Tovu `3482da9d77`). Duplicate core-runtime-mode export entries removed. | ~270 | 4 Tovu typechecks 0; type-level mutation red | DONE, with skips listed below. |
| **K4-seam-14..18** (+ seam-8 leftover) | Opus | SitesPort + 10 site DTOs, agentic DOM page types, desktop resource metrics → core (Jini `5da59a5eb`); `sites-port.hooks.ts` deleted (Tovu `e7fdc9563b`) | ~146 | admin 1115 tests green; mutation `listSites` rename: 27 tsc errors | DONE, with skips listed below. |
| **K4-seam-20..23** | Opus | ProviderConfigSource (+2) and TrashActor → core (Jini `4689ea60a`); 2 Tovu type forwarders removed (Tovu `188d681eb2`) | 23 | mutation `scope` rename: 5 tsc errors | DONE, with skips listed below. |
| core owner dedupe | Sonnet | plugins/host, cms/trash, db/recovery and agentic import those types from core; `plugins/host/provider-config-source.ts` deleted (Jini `319ced736`) | — | 4 packages build + tests green | DONE |
| **K4 daemon port types** | Opus | Provider tool-turn, pinned-fetch and base-URL guard ports → `@jini-ai/core/contracts/agents`. `daemon/ports/provider-http.ts` and its public subpath deleted: no importers in Jini, examples or Tovu. Jini `73f684b5e`. | 8 | server 476/1 skip; daemon 402; mutation red | DONE. XP −6. `AgentRuntimePort`/`AgentExecutorRuntimePorts` stay (Node `ChildProcess` types). |
| **XC-6a** node-adapters inject | Opus | `createFileLockPort`/`createAtomicWriterPort` builders; the `nodeProcessControl` constant is gone; kernel takes `osPorts`. Commits: Jini `ed5153dd7`, Tovu `a3180516fb`. | 9 Tovu + examples + tests | node-adapters 40/40; server 475; daemon 615; mutation red | DONE. XP 525 → 519, none added. |
| **XC-6c** (partial) | Opus | `KernelOsPorts` gains `spawn`, `commandShell` and `clock`; kernel-base no longer imports node-adapters/process or platform/system (Jini `319ced736`) | examples + tests | server 476/1 skip; injected-clock mutation red | PARTIAL. XP −2. Store/daemon implementation edges deferred to XC-6d. |
| **XC-6b** | Opus | already landed in history (`71c7d640e`, Tovu `a3c11b75fe`); verified | — | owner-store 14; Tovu owner-store 22/22; mutation red | VERIFIED (XP −6 vs the pre-change file) |
| **A-K2-shell-lib-6** (subset) | Opus | version-conflict, stored-credential-endpoint, visitor-tools, assistant-permanent-deletes become K5 factories over the injected host client. Commits: Jini `f417d0b02`, Tovu `c44159527e`. | 25 | Jini 244; Tovu 282/283 (the 1 is BASE-RED `JiniMediaPicker`) | DONE. `ledger-slice` stays: it is already the host binding over `@jini-ai/admin/core`. |
| **A-K2-shell-lib-5** | Opus | credential-submit-error, local-owner-signin, assistant-subagents, owner MFA/passkey/recovery ports. Commits: Jini `b56a4dbea`; Tovu `a9840aae8e` + `e33d2c9351` follow-up. | 18 | Jini 282; Tovu 66 files / 1400 | DONE, with skips listed below. |
| **A-K2-shell-lib-2/3** | Opus | `createAdminFailureReporter` (instance-owned) in Jini `09028dba5`. The standing-draft backup and the typed-answer and A2UI posters fold into `shell-collaborators.ts`; `sse-frames.ts` (pure re-export) deleted (Tovu `13e1cb5773`). | 17 | Jini 289; Tovu 422 | DONE, with skips listed below. |
| **A-K2-shell-hooks-1** | Opus | admin-execution-credential port (+ fake); `use-sites-sidebar-nav` with required port, snapshot hook, nav translator and `useSidebar`. Commits: Jini `319ced736`, Tovu `58c736a5c3`. | 6 | Jini 103; Tovu 124; guard SI-domain fixed by injecting `useSidebar` | DONE, with skips listed below. |
| **K3 storage keys** (ex5-fnd-kit skip list) | Opus | ChatFab position hook, assistant-agents snapshot and browser working-directory access; the host passes its unchanged keys. Commits: Jini `3b5170b30`, Tovu `956684b59f`. | 8 | Jini 16; Tovu 292; key mutations red (Jini 8, Tovu 3) | DONE. Stored user data is unchanged. |
| **A-K2-shell-components-3** | Opus | shared-components dictionary, BYOK panel hook, agent-failure, routed A2UI hook, overflow modal, plugin tray, slow-run notice. Commits: Jini `baa71bc32`, Tovu `461845141a`. | 28 | Jini 141; Tovu 253; 2 mutations red | 7/10. Skips listed below. |
| **A-K2-shell-components-4** | Opus | failure notice, mail-status banner, sites sidebar nav, widget-config hooks, agent-failure hints. Commits: Jini `fc1013daf`, Tovu `9898709f48`. | ~12 | Jini 159; Tovu 115 | 5/11. One behaviour fix, test-first: an AbortError `DOMException` keeps its name, so a page-unload cancel is swallowed rather than shown. Mutation red. |
| **A-K2-shell-components-5** | Opus | AgentFailureCard (+ hooks) with required `useTHook`/`useAgentFailureCardHook`/`redactionOptions` (K3). Commits: Jini `6eb632e5d`, Tovu `9898709f48`. | 3 | Tovu 32/32; 2 mutations red | 2/12. Skips listed below. |
| final gate fixes | — | Shared-components dictionary split into 7 locale chunks (size); `publishAdminFailure` helpers extracted (complexity 12 → ≤10); required-hook-prop debt rows; XC-6a doc rows; API baselines regenerated (Jini `a3b0450eb`, `b5bef0b36`). Tovu harness fixes: `DockLeadingAccessory` renders under the kits; `untranslated-copy` keeps checking the moved dictionary. | — | — | DONE |

The why-comments ledger is current: Tovu rows `17439c335d`, `786f8ca534` and the base commits, plus 2 Jini rows.

## Skipped, with the exact reason
- **K4 seams.** Each needs a separate seam before it can move:
  - `KyselyKernel`: K4db; kysely cannot enter core. Recommendation: keep `@jini-ai/db/kernel` as the owner.
  - `TovuPublishPorts`: references cms port types; core cannot depend on cms.
  - `Members/Users/UserManageController`: declared in hook modules, and `UserManageController` has two shapes (owner picks the canonical one).
  - `GatewayDeps`: name clash with core's own type; needs `TokenStorePort` first.
  - `SitesWorkspace` / `CreateSitePort` / `CreateSiteOptions`: derived from `ReturnType<typeof createSitesWorkspace>`, plus `NodeJS.ProcessEnv`.
  - `SecretsVaultService`: a class used with `new`.
  - `DeployFile`, `PluginDeployHostKit`, `ExportReport`, `OwnSiteFetch`, `SitePreviewService`: Node `Buffer`.
  - `AdminThemeDocumentEnv`/`AdminThemePort`: DOM types; core is `lib: ES2023`.
  - `DnsQuery`/`PublicDnsResolver`: value-derived `DnsRecordType` and a name clash.
  - `SharedExternalMcpOwner`: needs an api-connections contract seam.
  - `SqlSecretsVaultRepo`: a class.
  - `RemoveEntity`: a different shape from core's.
  - `@tovu/sdk Plugin`: product-named destination; needs a plugin-sdk seam.
  - `PublishSectionId`, `RedirectRecord`/`RedirectRepoPort`: derived from values.
  - `AssistantAgentInventory`: `typeof` fields.
  - `SiteSearchRuntime`: `@jini-ai/search` types.
  - `outboxEventValues`, `zipFolderFiles`, `sqliteForeignKeyCheckedTransaction`, `sqliteTableInfo`: values, not types.
- **Shell lib:**
  - `assistant-transport.ts`: module composition of host modules plus `createAssistantTransportClient`, which is not in the kit.
  - `assistant-chats.ts`: K2 STOP; `@jini-ai/chat` HTTP transport types are not in the kit.
  - `retry-unreachable.ts`: K2 STOP; `retryWhileUnreachable` is not in the kit.
  - `descriptor-i18n.ts`: needs a K4 seam for the deployment and source-control API types (owned by the feature lanes).
  - `browser-telemetry.ts`: host singleton + console logger; owner decision on splitting it.
  - `assistant-transport-ag-ui.ts`: host composition.
  - `durable-run-subscription.ts`: its engine half belongs to `@jini-ai/chat/transports/http`, and admin does not depend on chat.
  - `media-image-extension.hooks.ts`: tiptap is not an admin dependency.
  - `ledger-slice.ts`: already the host binding.
- **Shell hooks:**
  - The locale, assistant-chats and execution-credential `*-dependencies.hooks` files are host composition and stay.
  - `assistant-chats-port.hooks.ts`, `use-settings-slice.hooks.ts`, `use-standing-draft-autosave.hooks.ts`: K2 STOP (not in the kit; admin has no chat/ui runtime dependency).
  - `use-admin-telemetry.hooks.ts`: waits on `browser-telemetry`.
- **Shell components:**
  - `composer-skills.hooks` (K5 with positional args), `media-content-rules` (K5 positional), `Select.tsx` (K2), `OverflowAwareMcpUiSurfaceCard`/`RoutedA2uiSurfaceCard` (K2 runtime cards + chart registry context), `SecretInput` (K2).
  - `media-picker-port.hooks`: the host's richer `AdminMedia` needs K4 first.
  - `run-context.hooks`, `selected-agent-plugins.hooks`: host-owned composer types; port design needed.
  - `agents-inventory`/`runtime-access` hooks: budget; they need 4 collaborators injected and the defaulted loader hooks made required.
  - `resolve-composer-discovery-outcome`: waits on A-K2-plugins-1/skills-1.
  - TemplateSource ×3: waits on A-adm-themes-1/shell-components-2.
  - `HtmlAttributeRows.hooks`: waits on `media-content-rules`.
  - media, widget and widget-config `*-dependencies.hooks`: wait on the feature API runtime modules.
- **Not started (budget):** shell-components-6..11, shell-hooks-2/3/4, shell-lib-1/7 remainder, XC-6d, XC-1..5, BX composer/runtime, the RT-K1 shared route sheets.

## Owner decisions needed (with my recommendation)
1. **`plugin-install-source.ts` (headless contract).** `PLUGIN_INSTALL_SOURCE_SCHEMA.path.description` says "on the machine Tovu runs on", and this text is model-facing. **Recommend** rewording it to "the machine the host runs on" (one P9-BREAKS row), then moving the file.
2. **`check-hook-injection` vs. the owner rule.** The checker only accepts defaulted hook props. This run added 8 required-prop debt rows, each saying it is correct as written. **Recommend** updating the checker to accept required hook props, as combine-15 also asked.
3. **`node-adapters` → `@jini-ai/platform`.** The dependency is now used only by its tests. **Recommend** moving it to `devDependencies` (lockfile change).

## Gates (base = merge-15 + the four prior branches, measured on a clean `merge-15` worktree; final = tip)

**Jini (final `b5bef0b36`)**
- `pnpm -r build`: 0, 0 `error TS`.
- `api:check`: 0, after `api:update` on the intended surface changes: admin, core, daemon, integrations, node-adapters, platform, server.
- `guard`: 1 violation, HW3 `shell/lib/shell-failure-log.ts`. It is unchanged from merge-15; the base worktree's count of 9 is an install artefact.
- `check:size`, `check:complexity`: same set of violations as base, no new entries; the 3 new ones this run introduced are fixed.
- `check:hooks`: 0 (8 debt rows recorded, see owner decision 2).
- `check:why-comments`: same IDs as base.
- `check:cross-package` (XP3 lines excluded: environment artefact): measured per step, each with 0 pairs added. XC-6a −6, XC-6c −2, K4 daemon ports −6, XC-6b −6 (the last reconstructed from the pre-change file).

**Tovu (final `799626bbd9`)**
- Root `typecheck`: 0 (base 3, which was the `guardedFetch` host binding this run fixed).
- Admin `tsc`: 0 (base 17).
- `typecheck:tests`: 0.
- `typecheck:scripts`: the same base errors; 1 fewer.
- `size`: 1 fewer violation than base.
- `complexity`, `hooks`, `boundaries`, `errors`: same as base.
- `architecture`: improved (deep-import edges 2638 → 2563).
- `why-comments`: no new IDs vs base.

**Tests**
- **Admin vitest, full:** 861 files, 14436 passed, 6 failed in 4 files.
  - BASE-RED, the same failures on the merge-15 worktree: `JiniMediaPicker.hooks` (3), `admin-literal-copy` (collections placeholders), `credential-input-autocomplete` (`packages/ui/src/react/testing.tsx`).
  - The 4th, `untranslated-copy`, was caused by this run (moved dictionary) and is now fixed: 66/66.
- **Website node tests on the 168 changed test files:** 2775 tests: 2697 pass, 25 fail, 51 cancelled.
  - Rerun serially on base vs tip: every failure name is identical on base, including the custom-credentials "Promise resolution is still pending" hangs, which are 26/18/0 fail/8 cancelled on both. Postgres tests need a database that is not provisioned here.
  - Three names are tip-only: `plugin-host.integration` "an approved enable …" ×2 and "every bundled agent … distinct publisher identity" (`tovu/calendly` vs `jini/calendly`). That file **fails to load at all on the base worktree** (against this Jini dist), so whether these three are new is **NOT-CHECKED**. This run's diff touches that file only at one type-import line, and touches `plugin-runtime.ts` only to bind the file lock.

## FILES LEFT (`scan.mjs` + `plan.mjs`, `origin/plan/whats-left-1122`, clean worktrees)

| tree | moving | FILES-LEFT | excl. theme areas (`theme` + `adm-themes` = 111) |
|---|---|---|---|
| base `origin/integ/merge-15` `bd89a2aa83` | 2,269 | **2,269** | **2,158** |
| tip `786f8ca534` (later commits: tests + this report only) | 2,226 | **2,226** | **2,115** |

The net drop is −43. Most of this run's work is K4/K5 seams (types into core, injected collaborators), which unblock later moves without deleting a Tovu file.
