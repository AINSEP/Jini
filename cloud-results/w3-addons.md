PARTIAL 3edfbe8f33 cc24633e6: owner decisions — webhook sealer/keyrings owner (platform/secrets), plugins-i18n product dictionary, js-yaml peer for host-plugin-guidance, set-enabled/update-effects/memory/provider-operations route-deps fields (routes lane), skills state file rename, content-analyzer trusted imports, AdminAgentPlugin core contract, ToolAccessLoweringError to core; Foundation prerequisites — A-K2-plugins-2 (blocks A-K2-plugins-3/4), K4-seam-20, post/pages contracts; out of scope — RT-K1 routes (w3-rtfnd), FIX 13 (plan branch); remaining admin Email/Skills components and HTTP-helper hooks need a Jini admin HTTP port

# w3 — Add-ons, Integrations, Providers, Email, Notifications (wave 3), 2026-11-23/24

Unattended cloud run. Opus coordinator (this session), builders were Opus-high subagents (1 Sonnet-xhigh for the FIX 12 sweep and 1 for the batch K forward sweep). No codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish, no RemoteTrigger. `main` / `integ/*` / `plan/*` / `release/*` were only fetched. Codex review of every diff is still pending (this run's diffs were reviewed by the coordinator before each commit).

**Programmer skills confirmed:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work; its rules (test-first for behaviour changes, named mutations, no weakened tests, scope discipline, why-comments with the code) were copied into the builder brief (`RULES.md`, quoted in every dispatch).

- **Branches:** Jini `codex/w3-addons-jini`, Tovu `codex/w3-addons-tovu`.
- **Base:** Jini and Tovu `origin/integ/merge-15-2026-11-23`. The prior `origin/codex/ex7-addons-integ-{jini,tovu}` were merged on top (Jini clean; Tovu: `why-comments-debt.json` union by id, and `domain-dns/tool-deps.ts` — kept merge-15's `@jini-ai/devops/dns/site/mail-requirements` import and ex7's `@jini-ai/platform/mail` repoint). The latest merge-15 heads (`60c6cd52` Jini, `33701312a` Tovu) were merged again before the final gates.
- **Setup:** Node 22.23.5 (no Node 24 on this image), pnpm 10.33.2 via corepack, npm 10.9. Jini `pnpm install --frozen-lockfile` 0, `pnpm -r build` 0. Tovu `npm ci --ignore-scripts` ×4 0, `link-jini.mjs` → this Jini branch 0, contracts tsc 0, sdk build 0.

## FIX items (reviews `rv1123*.md` on `origin/plan/whats-left-1122`)
| item | status |
|---|---|
| rv1123f **FIX 11** (`AssertVersionedWritePort` from the SQL barrel) | **APPLIED** Jini `aa2e9397`: type moved beside `assertVersionedWrite` in `@jini-ai/core/optimistic-concurrency`; both webhook repos import it there; the SQL barrel no longer re-exports it (api-baseline records the one removal). |
| rv1123f **FIX 12** (forwards in approval.ts, mail-adapter-registry.ts, plugin-state.ts, external-mcp-store.ts, platform/mail/index.ts) | **APPLIED** Tovu `5e184919c`, finished by `82a28df08` (last store forward), `899b3bb79` (batch K), `055a03884` and `c0be116c2`: every forwarded `@jini-ai` name is imported from its owner; all five files forward nothing from Jini. `platform/mail/index.ts` keeps only its local host-binding lines (63 importers, a real host barrel). |
| rv1123f **FIX 13** / rv1123c Integrations FIX 2 (fold `P9-BREAKS.rows/X-external-mcp-1.md` into `plans/P9-BREAKS.md`) | **NOT APPLIED — out of scope:** it lives on `plan/whats-left-1122`, which this run may not push. |
| rv1123c Add-ons FIX 1 (descriptor-i18n forwarder) | **verified already applied** (module, export, runtime entry, baseline entry all absent). |
| rv1123c Integrations FIX 1 (unused project-scope export; versioned write injected) | **verified already applied**. |
| rv1123c Integrations FIX 3 (`createKeyringBackedSigner({ keyring }, _optional)`, pads on `signPayload`/`verifySignature`) | **verified already applied** at base (merge-15). |

## Batch table
Files moved = Tovu production sources deleted (moved to Jini, verbatim except import lines and the named injections). Every batch: Tovu `tsc -p tsconfig.json` 0 → 0; tests of changed files + importers run per file.

| batch | model | step(s) | files moved (Tovu → Jini) | importers repointed | tests (moved/new; mutation) | commits (J / T) | status |
|---|---|---|---|---|---|---|---|
| FIX 11 | coordinator | rv1123f 11 | type seam only | 3 Jini | integrations webhooks 166/166 | `aa2e9397` / — | DONE |
| D | Sonnet | rv1123f FIX 12 | 0 (forward lines) | ~115 | 25 files 619/2 (2 BASE-RED) | — / `5e184919c` | DONE |
| A | Opus | A-K2-plugins-1, A-K2-skills-1 (leaves) | 10 → `@jini-ai/admin/screens/{plugins,skills}` | 33 | 11 moved + 3 new; class/path mutation 3/3 red | `8e99def0` / `0e4990773` | DONE (4 skipped) |
| B | Opus | K5-webhooks-1/2/3, X-webhooks-1 | 0 (sealer attempt reverted: guard L5) | 0 | — | — | SKIP (owner decisions, below) |
| C | Opus | X-plugin-runtime-1, K5-plugin-runtime-1/2 (part), K4-plugins-1 | 7 → `@jini-ai/plugins/{runtime,site}` | 21 | 20/20; publisher-id test-first + mutation red; host-copy mutation red | `d54d4b8b` / `82a28df08` | DONE (5 skipped) |
| E | Opus | K5-external-mcp-1/3 | 0 (forwards removed in contracts.ts, revocation.ts) | 46 | 22 files green | — / `5626d9eac` | DONE (6 skipped) |
| F | Opus | K5-agent-plugins-1 | 2 → `@jini-ai/agent-plugins/site` | 5 | 30 moved; deriver mutation 8/22 red | `b0830da1` / `d597c5121` | DONE (4 skipped) |
| G | Opus | X-mail-status-1, K5-mail-status-1 (part), X-skills-1 | 6 → `@jini-ai/user-management/mail/status`, `@jini-ai/agentic/skills/site` | 12 | 5 moved + 2 new; domain-deps test-first, mutation red | `3e175c0e` / `68329d6c6` | DONE (3 skipped) |
| H | Opus | A-K2-email-1 (leaves) | 6 → `@jini-ai/admin/screens/email` | 21 | 10 moved; isForbidden mutation red | `6fe2e15f` / `06bf3955a` | DONE |
| I | Opus | K5-mail-1, K5-platform-mail-1 (part) | 15 → `@jini-ai/platform/mail(/sql)` | 22 | 19 moved/new; label-prefix mutation red | `5888def3` / `d8affe521` | DONE |
| K | Sonnet | lane forward sweep | 1 deleted (`webhooks/ports.ts`, forwards only) | 86 | 30 files, 2 BASE-RED | — / `899b3bb79` | DONE |
| J | Opus | X-external-mcp-1, K5-external-mcp-3 (part) | 3 → `@jini-ai/mcp/{external,federation}` | 13 | 4 new; formatter + limiter mutations red; catalog JSON `cmp`-identical | `ee3e1330` / `055a03884` | DONE |
| L | Opus | K5-email-templates-1 (part) | 1 → `@jini-ai/platform/mail/email-template-agent-tools` | 3 | 4 new | `33765452` / `055a03884` | DONE (3 skipped) |
| O | Opus | K5-mail-status-1 (part) | 1 → `@jini-ai/platform/mail/test-send` | 7 | 10 moved + 2 new; 2 mutations red | `9dec7f5c` / `30065a301` | DONE (5 skipped) |
| M | Opus | K5-plugin-runtime-2 (part) | 2 + `HumanConfirmSpec` type seam → `@jini-ai/plugins/runtime`, core | 16 | spec-level vitest 21/21 | `ba5ab57d` / `72446166c` | DONE (11 STAY) |
| N | Opus | K5-agent-plugins-7 (part) | 1 → `@jini-ai/agent-plugins/site/uninstall-tool` | 3 | 4 new | `ba5ab57d` / `72446166c` + `424141844` | DONE (10 skipped) |
| P | Opus | K5-skills-1, K5-custom-credentials-4 | 4 + tool-metadata/skills → `@jini-ai/agentic/skills/site`, core | 25 | 3 mutations red | `898a6c5f` / `9be895d12` | DONE (custom-credentials STOP) |
| Q + Q2 | Opus | A-K2-skills-1 (components) | 7 → `@jini-ai/admin/screens/skills` | 11 | moved + 3 class tests; useLocale + class-map mutations red | `c6a59e50`, `93b1218a` / `4f97d8c4e`, `73979534b` | DONE (4 stay: host HTTP helper) |
| R | Opus | A-K2-email-1/2 (data hooks) | 5 hooks + type block → `@jini-ai/admin/screens/email` | 19 | 3 binding tests; ApiError mutation red | `c6a59e50` / `4f97d8c4e` | DONE (components stay) |
| S | Opus | K5-external-mcp-3, K5-webhooks-1 (part) | 2 → `@jini-ai/mcp/external/save-form`, `@jini-ai/integrations/webhooks/site/delivery` | 7 | 36 moved + 3 new; header-name mutation red | `eab9fd66` / `feb8d2ca3` | DONE |
| T | Opus | K5-mail-status-1 (part) | 1 → `@jini-ai/platform/mail/feedback-setup` | 5 | 3 moved | `5a6105e4` / `53e94d4c6` | DONE |
| U | Opus | K5-external-mcp-3 (part) | 1 → `@jini-ai/mcp/federation/external-mcp-probe` | 4 | 6 new; 2 wiring mutations red | `44e91773` / `219e3972a` | DONE |
| V | Opus | A-K2-email-1 (activity hook) | 1 (split ≤ 80 lines first) | 4 | 1 binding test; mutation red | `42bd1198` / `75511a34e` | DONE |
| W | Opus | K5-mail-status-1 (part) | 1 → `@jini-ai/platform/mail/use-readiness` | 4 | 5 new, test-first; mutation red | `f112121d` / `493e2afc6` | DONE |
| X | Opus | A-K2-plugins-1 (composer split) | 0 files (half of a 414-line file) | 16 | 12 moved | `27246f50` / `bb0165bf9` | DONE |
| Y, Z | Opus | gate fixes (log-safety, size) | — | — | tests-first + 6 mutations red | `82f2144d`, `047e154d` / `937119141`, `45f211911` | DONE |


## K4-plugins-1 — persisted publisher id (owner 11-21 "rename every Tovu id to jini, list each break")
Done in batch C: `lipay` and `store` manifests moved to `@jini-ai/plugins/site/{lipay,store}/manifest` with publisher `"tovu-core"` → `"jini-core"`; test-first (`publisher-id.test.ts` red before, green after; mutation back to `tovu-core` → red). **Breaks:**
1. Existing installs: `_plugin_identity` rows hold `publisher = "tovu-core"` for lipay/store; the strict compare in `Jini/packages/db/src/data-modules/plugin-identity.ts:93` no longer matches → adoption is refused as `consent-required` until a migration rewrites those rows or the owner re-approves. **No migration was written** (recommendation: a one-shot `UPDATE _plugin_identity SET publisher='jini-core' WHERE publisher='tovu-core' AND plugin_id IN ('lipay','store')` in the next migration slot).
2. Same id, not renamed (other lanes' folders): `Tovu/apps/website/src/features/comments/types.ts:18`, `Tovu/apps/website/src/features/newsletter/data-module-manifest.ts:43` — same rows-refused break when they rename.
3. Docs citing the old id: `Tovu/ADS-memory/reports/architecture/lipay-payment-plugin-architecture.md:499`; stale path comment `features/newsletter/data-module-manifest.ts:18`.
4. No signatures, migrations or DB fixtures referenced lipay/store `tovu-core`.

## Skipped / STAYS, with exact reasons
**Owner decisions (recommendation given):**
- **Webhook sealer/keyrings** (`secret-sealer.aesgcm.ts`, `keyring.memory.ts`, `keyring.env.ts`, `site-key-sources.ts`): integrations may import only core/protocol (guard L5), so injecting the platform sealer touches 311 `new AesGcmSecretSealer(...)` sites in ~194 files. *Recommendation:* owner `@jini-ai/platform/secrets` (add `SecretOpenError`/`SECRET_OPEN_FAILED` + `aad ?? ""` there), then repoint mechanically; dedupe `keyring.memory.ts` onto `@jini-ai/platform/secrets/testing` `InMemoryKeyring({ hkdfSalt })`. `keyring.env.ts`/`site-key-sources.ts` carry the frozen salt `tovu-integrations-root-key-hkdf-v1` (renaming breaks every sealed row), `TOVU_SITE_KEY`, `~/.tovu/site-keys/` → STAY as the K3 binding.
- **`plugins-i18n.ts`** (362 "Tovu" strings in a module-scope dictionary): Tovu overlay over a Jini base vs a `{product}` placeholder.
- **`external-mcp/agent-tools.ts` pattern** (constant → `create…({ copy })` factory) was applied in C/J/L/U — see "Decisions" below; if Codex rejects it, those files return to STAYS.
- **`host-plugin-guidance.ts`**: needs `js-yaml` (no Jini package has it). *Recommendation:* `js-yaml` optional peer on agent-plugins + required `overlaysDir`.
- **`set-enabled.ts`** (agent-plugins): 6 Tovu values, 17 importers incl. routes that cannot change call arguments.
- **`provider-operations.ts`** (mail-status): its only caller is a route that builds the args inline. *Recommendation:* split read/plan/activate/check → `@jini-ai/platform/mail`; keep save/create/rotate, or the routes lane adds `credentialStore` at that call site. `provider-tool-registrations.ts`, `tool-registrations.ts`, `delivery-tool-registrations.ts` follow it.
- **`skills/state.ts`** (`.tovu-install.json`): renaming changes the on-disk state file (installs lose records, disabled skills re-enable) → STAYS as the K3 value (now injected into Jini via `SkillSiteHost.stateFileName`).
- **`built-ins/content-analyzer/*`**: tier-2 worker trusted-import list would have to widen (security owner decision). *Recommendation:* port `plugin.ts` to `@jini-ai/plugin-sdk` and move the folder with an explicit trusted-imports update.
- **`use-email-provider.hooks.ts`**: `AdminAgentPlugin` wire type carries product copy ("Tovu host maturity"). *Recommendation:* type-only core contract for the agent-plugin row.
- **`lower-tool-access.ts`**: needs value class `ToolAccessLoweringError` (`contracts/core/tool-access-change.ts`, Foundation/contracts-core) moved into `@jini-ai/core` beside `ToolInputError`.
- **`update-effects.ts`**, **`memory.ts`** (agent-plugins): callers are route files (`routes/agent-plugins/install.ts`, `memory.ts:71`) whose deps interfaces belong to the routes lane (w3-rtfnd).
- **`deps.ts`** (external-mcp): blocked on K4-seam-20 (`ExternalMcpOAuthService`/`DeviceAuthorizationStore`/`SharedExternalMcpOwner` into core — Foundation).
- **`email-templates/operations.ts`, `tool-registrations.ts`, `index.ts`**: no Jini owner for `PostRecord`/`PostRepoPort`/`PagesHtmlDocumentStoreFactory` (V-post-5 / K5-contracts-core-4 / K5-pages-1).
- **`use-email-template-view.hooks.ts`** and all 8 Email components, the 4 remaining Skills hooks + `api.ts`, `use-skills-tabs.hooks.ts`: host HTTP helper (`@/lib/admin-http/request`) / shell router / DevicePreview have no Jini owner; admin may not import `@jini-ai/ui`/`@jini-ai/chat` (L5); `screens/*` may not import `shell/*` (SI-domain).
- **`admin-surface-theme.ts`, `use-admin-surface-frame.hooks.ts`**: need `@jini-ai/agent-plugins` (not an admin edge) and `readAdminTheme()` has no args object.

**Permanent host bindings (STAYS, confirmed this run):** `custom-credentials/tool-registrations.ts` (the file's own header: Tovu bindings over the extracted `@jini-ai/integrations/credentialed-http/tools`; ~22 Tovu value imports + 4 forbidden Jini edges; no function > 80 lines), `agent-plugins/{card-host-bindings,issued-sign-ins,connect-destination,memory-tools,federate-mcp,enable-access,mcp-host-bindings,apply-connect-defaults,connect-sign-in-wait,connect-tool}.ts` and `executable-tools/register.ts` (A8–A10 compatibility binders over existing Jini owners), `plugin-runtime/{provider-status-tool,install-source,install,host-tool-binding,agent-plugin-tool-binding,capability-tool-registrations,install-tool-binding,install-tool,source-tools,tool-registrations,declarative-content-types,install-archive}.ts`, `skills/install-adapters.ts` (yauzl/js-yaml binder), `external-mcp/{contracts,external-mcp-vault,external-mcp-store.memory,external-mcp-store,external-mcp-oauth}.ts`, `webhooks/{http.memory,secret-scan-guard,seal-aad-invariant}.ts`, `platform/mail/{adapter-module,adapters/smtp.nodemailer,delivery-availability,sender-identity}.ts`, `mail/index.ts` (persisted label prefix only).

**Not run (scope):** all `RT-K1-*` route steps (route files owned by w3-rtfnd; this run changed import lines only in route spec files), `BX-24–26` (no sheet), `RN-J1/T1/J2` (night slot), `A-K2-plugins-3/4` (depend on Foundation's `A-K2-plugins-2`), FIX 13 (plan branch).


## Gates (base = merge-15 measured in a clean worktree at the same Jini dist, or the combine-15 report where noted)
**Jini** (final tip; base = clean worktree at merge-15 `60c6cd52` running the same scripts, or the combine-15 report):

| gate | base | final |
|---|---|---|
| `pnpm -r build` | 0 | **0** |
| typecheck (`-r typecheck` + scripts tsc) | 0 / 0 | **0 / 0** |
| guard | 1 (HW3 `admin/shell/lib/shell-failure-log.ts`) | **1, same row** |
| api:check | 0 | **0** (baselines regenerated in `4c95c6c7` + `047e154d`; 39 packages, 1043 entries; additions only, except `AssertVersionedWritePort` leaving integrations `./webhooks/sql` per FIX 11) |
| check:size | 1 (cms redirects 513, daemon launch.ts ×2, sidecar stale) | **1, identical rows** (email-i18n split in Y) |
| check:complexity | 1 (4 rows: agent-runtime, chat, core reporter, ui ErrorNotice) | **1, identical rows** |
| check:log-safety | 1 (13 rows) | **1, identical rows** (Y/Z moved every console/stored-error-text path behind host reporters) |
| check:hooks | 0 | **0** |
| check:errors (WARN) | 29 new/worse | **29, identical** (7 debt rows moved with their code from the Tovu ledger, `ac876cc3`) |
| why-comments `--base merge-15` | — | **0 lost** |
| check:cross-package (`--base merge-15`; the script's default base `35c4961af` is absent here) | XP4 760 (combine-15) | **XP1 0 / XP2 0 / XP4 760 / XP5 0**; XP3 5 (snapshot-only noise per combine-15, not evaluated) |
| guard:plugins | 0 | **0** |
| vitest (touched packages, full suites) | — | admin 3650/3650, core 3023/3023, integrations 2121/2121, mcp 1944/1944, plugins 1058/1058, agent-plugins 2242 (+2 skip), agentic 1163/1163, platform 3444 (+6 skip), user-management 1353 + **2 BASE-RED** (runtime-boundary, same 2 at combine-15) |

**Tovu** (base = merge-15 worktree, same `node_modules`):

| gate | base | final |
|---|---|---|
| typecheck (+e2e) | 0 | **0** |
| typecheck:tests | 0 | **0** |
| typecheck:scripts | 3 | **3, identical** |
| admin tsc | 0 | **0** |
| check:size | 1 (2 new + 8 worsened rows, none in this lane) | **1, identical rows** |
| check:complexity | 0 | **0** |
| check:hooks | 0 | **0** |
| check:errors (WARN) | 3 new/worse | **3, identical rows** (`bundled-id-upgrade`, `lifecycle.ts`, `use-page-editor`; mail-status/skills/mail/email debt rows moved with their code) |
| check:boundaries | 0 | **0** (stale `plugins` rank removed, `82a4c92a0`) |
| check:architecture | FAILED (58 NEW edges; runtime-only propagation 3.06 → 3.26) | same verdict: **56 NEW edges, all in the base list** (no new edge; 6 webhook edges re-pointed from the barrel to concrete files in the baseline). Runtime-only propagation 3.26 → **3.35** (+0.09, ratchet WARNING, already failing at base); API surface 653 → 631 and hubs 273 → 238 improved |
| why-comments `--base merge-15` | — | **ok** (64 lost, 64 allow-listed: 61 rows written this run, each naming the Jini destination or the retired forward) |

**Tovu tests** (each file alone, 3 in parallel; 528 files = every changed test + every test in the lane folders + lane route/composition tests): **6,729 pass / 71 fail**. Every red file was re-run against the merge-15 worktree:
- identical at base: the combine-15 BASE-RED list (federate-mcp 30/4, bundled-* packages, tw2-L224, mail dialects ×2, data-module 28/4, tool-contract.characterization 13/2, forms-notification-restart, vendor-neutrality, install-upload-update, automatic-agent-plugins, domain-no-direct-tool-registration 6/1, …) plus `tool-registrations.themes-trash-restore` 19/7, `plugin-embed-export` 0/1, `data-module-indexes` 8/1, `secret-scan-guard` 16/2, `plugins-real-composition.unrun` 6/2, 3 site-deps characterization files (2/1 each), `plugin-host.integration` 22/3, `composition-boot-order` 4/2, postgres files (no server here);
- **new reds found and fixed:** `extract-s3-host-source` (pinned a removed forward → `5d2cca3d1`), `route-deps-members-mail.characterization` key list (→ `7df39937a`, back to base 2/1), `keyring.env.test` (barrel import → `82a4c92a0`), `domain-no-direct-tool-registration` test 4 (→ `424141844`, back to base 6/1).
**Admin vitest** (plugins, skills, email, AssistantDock, MailStatusBanner, lib, hooks): 3,711 pass / 3 fail → after `3001d433d` 2 fail, both BASE-RED (`admin-literal-copy` on features/collections, `credential-input-autocomplete`).


## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`)
| tree | moving | shells | **FILES LEFT** | themes excluded |
|---|---|---|---|---|
| Tovu merge-15 `33701312a` (before) | 2,269 | 0 | **2,269** | **2,158** |
| tip (after) | 2,197 | 0 | **2,197** (−72) | **2,086** (−72) |

Lane areas, before → after: agent-plugins 61 → 57, plugin-runtime 32 → 25, plugins 2 → 0, skills 7 → 3, external-mcp 16 → 12, webhooks 13 → 11, mail 12 → 1, mail-status 12 → 4, email-templates 4 → 3, platform-mail 8 → 5, contracts-core 83 → 82 (tool-metadata/skills), admin (adm-other: plugins/skills/email screens) 380 → 355. Unchanged: custom-credentials 22, api-connections 17, vendor-credentials 7 (the last two are Foundation-owned per the lane map).
Beyond the file count: ~110 forwarded names removed (FIX 12, E, K, coordinator), 4 Jini-side size/log/stored-text regressions fixed at the source (Y, Z), and the composer-capabilities projection half moved (X) without deleting the host file.


## Self-check (Codex failure list)
1. No re-export/forwarding files: this run **removed** ~110 forwarded names and deleted `webhooks/ports.ts` (forwards only); new host binding modules (`plugin-host-copy.ts`, `external-mcp-host-copy.ts`, `skill-failure-host.ts`, `site-host.ts`, `email-hooks-host.ts`, `wire-headers.ts`, `agent-plugin-uninstall-host.ts`) bind values, they do not re-export. Kept forwards: `webhooks/index.ts` is comment-only; `members/index.ts:68`, `newsletter/ports.ts:36`, `resolve-mailer.ts:28` (other lanes) still alias `PositionalMailer as MailerPort` from the owner.
2. Hooks: every moved Jini component takes its custom hooks as REQUIRED props (`Skills` `hooks`, `SkillInstallConfirmation` `hooks`); no default hook values in Jini; `check:hooks` ok in both repos.
3. No express types or host log formatters in Jini: batch Y/Z moved every console line / log formatter behind host reporters (`reportReadFailure`, `onError`, `uninstallHost`/`SkillSiteHost` reporters).
4. `jini-*` classes only: skills screen classes renamed `jini-skills-*`, shared host classes arrive through the required `classNames` prop (batch Q2); `jini-agent-plugin-chevron-glyph` (A).
5. No new size-exception entries (email-i18n split instead, batch Y).
6. Shared wire types in neutral core owners: `contracts/site/{skill-install,human-confirm,installed-skill}`, `tool-metadata/skills`, `optimistic-concurrency` `AssertVersionedWritePort`.
7. Object args + `_optional = {}` on every new/changed exported function.
8. Behaviour changes have tests first + named mutations (listed per batch).
9. why-comments moved with the code; 52 Tovu debt rows each name the Jini destination or the retired forward (check:why-comments ok both repos).
10. `## Wiring` sections in every touched feature folder (Jini and Tovu READMEs/INFO.md).

## Decisions taken that Codex should look at
- **Constant catalogs → `create…({ copy })` factories** (C, J, L; host binds once). The K3 recipe says copy rides an *existing* args object; a module-level constant has none. I accepted the factory because otherwise every model-facing catalog with a product string or host tool name stays forever (guard N3/R5). If rejected, these files go back to STAYS.
- **Factories with a `host` object** for `createExternalMcpProbe` (U) and `createServerAdmissionsReader` (J/Y), same reasoning.
- **New feature-owned RouteDeps fields** on `MembersDeps` (`listCustomCredentials`, `mailWebhookSecretLabels`, `evaluateNewsletterLaunchGate`; T/W). Owner 11-22 allows a new feature-owned deps field; owner 11-20 holds "no global RouteDeps re-wiring" — these are additive members-mail fields only, no re-wiring. Route registration files were not edited (import lines only in route spec files).
- **kysely optional peer on `@jini-ai/platform`** with an opt-in `./mail/sql` subpath (I) — same shape as integrations/cms/plugins/commerce; adds 3 lines to `pnpm-lock.yaml`.
- `contracts/core/tool-metadata/skills.ts` moved to `@jini-ai/core/tool-metadata/skills` (P) — a contracts-core file, but every other tool-metadata domain already lives there.
