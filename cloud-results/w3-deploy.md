PARTIAL a85a73dd1 b13c1612: lane not finished. FILES LEFT in the lane areas went from 295 to 237. Still open: site-backup's share-policy chain (≈38 files), publish-content sheets 3–6 (theme freeze), the source-control store, registry and credentials cluster, deployments ports/host-kit/deploy-config/capability-card, the deployment/source-control admin types (Security lane), trash adapters (content-kernel), shell-staleness, `challenge.ts`, and the desktop React rows (OWNER-Q-9). Exact reasons are in "Skipped".

# w3-deploy: Deployment, Source Control, Database, Recovery, Trash, Backup/Export and Desktop shell (wave 3)

This was an unattended cloud run on 2026-11-23/24, from 22:21 to 01:00 UTC. Opus coordinated it and 17 Opus builder subagents did the batches, at most 4 at a time.
- I reviewed every builder diff and committed each batch separately, staging only that batch's hunks when another builder was writing the same package.json.
- After each batch I built, ran the affected tests and pushed with a plain `git push`.
- **Codex should review every diff before merge.**
- `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. The shared builder brief (Git rules, the K1–K5 relaxed stop rules, self-check 1–15, verification and report format) carried its base skills: tests first with a named mutation, minimum change, inline why-comments, and verification evidence before claiming done.

## Branches
- **Jini** `codex/w3-deploy-jini`: tip `b13c1612`, 67 commits above `integ/merge-15-2026-11-23` (`60c6cd52`), 215 files, +21,105/−53.
- **Tovu** `codex/w3-deploy-tovu`: tip `a85a73dd1`, 62 commits above `integ/merge-15-2026-11-23` (`33701312a`).
  - Since the ex7 merge: 490 files, +6,160/−18,201.
  - 80 production files and 15 test files deleted.
- **Base.** Both branches start at merge-15 (`0a44b54ca` / `bd89a2aa8`). On top I merged the prior `origin/codex/ex7-deploy-desktop-{jini,tovu}`, then re-merged the moved merge-15 heads (`60c6cd52` / `33701312a`, the combine-15 report plus a mail test fix).
- **ex7 merge conflicts** (resolved, all trivial):
  - Jini: core `package.json` (inventory entry, unioned), the cms API baseline (unioned, then regenerated), and `shell/guest-navigation.ts` (kept the base's D15 version).
  - Tovu: base had already landed D15 through `window-bounds-json-store`, so ex7's duplicate `window-bounds-file{,.test}.ts` was dropped and `index.ts` / `sites-home-window.ts` were kept on the base. `app-window` took ex7's AX-90 binding. Two `@/` alias import lines kept the base. `why-comments-debt.json` was unioned by id.
- Nothing was force-pushed, no `--no-verify` was used, no codebase-memory tools were used, and no `main`/`integ`/`plan`/`release` branch was touched.

## Review FIX items applied (rv1123g, ex7-deploy-desktop)
| FIX | Applied | Evidence |
|---|---|---|
| J-1: `useSiteListPrefs` save timing | The queued first save is the default again (byte-identical to before `e309cc77`). Same-turn saves are an explicit `immediateFirstSave` option. Both timings are pinned. | Jini `d9b99379`. Mutation "default immediateFirstSave=true": the queued-default test went red (11/12), then 12/12. |
| J-2: inventory and move-to-applications import Core runtime | `orFallback`/`orFallbackSync` are now required callbacks on the existing args. Only type imports remain. | Jini `d9b99379`. One injection test per package. |
| T-1: desktop same-turn option | `useWiredSiteListPrefs` passes `immediateFirstSave: true`. Admin keeps the queued default (79/79). | Tovu `bf3ba0016`. Mutation "drop the option": 2 desktop tests red, then 8/8. |
| T-1b: bind fallbacks at composition | `desktop-chat-main.ts` binds `orFallback`. `readBundleVersion` has no live call site (the move prompt is disabled by the owner on 2026-10-06), so only its test binds it. | Tovu `bf3ba0016` |
| Merge fix | `sites-home-window.ts` import alias after the conflict resolution (desktop main tsc went from 6 errors to 0) | Tovu `bf3ba0016` |
| ex7 findings 3/5 (stale comments, `main/index.ts` size) | Covered by the size fix below | Tovu `cf8d2a277`, `660721b86` |

## Batches
| # | Batch | Model | Files moved (Tovu → Jini) | Importers | Tests and mutations | Status (Jini / Tovu) |
|---|---|---|---|---|---|---|
| 0 | fix: rv1123g | Opus | none (FIX) | 3 | ui 12/12, agent-runtime 9/9, devops 23/23, desktop 15/15 + 8/8, admin 79/79; 2 mutations | `d9b99379` / `bf3ba0016` DONE |
| 1 | admin: A-adm deployment / source-control / recovery / publish-content | Opus | `Deployment.hooks`, `SourceControl.hooks`, 3 recovery hooks, the publish-availability store (factory; Tovu keeps the instance). `recovery-api.types` deleted (duplicate of `@jini-ai/admin/core`). | ~24 | Jini 13/13, admin 995/995; 5 mutations | `58a7bdb7` / `291fadfaf` DONE |
| 2 | db: database / transfer / recovery | Opus | `db-messages` and `transfer-messages` as site wording profiles on `@jini-ai/db/tools`. `plan-store` and `postgres-target` deleted; the host builds the Jini objects and passes `applicationName`. | 3 | db 154/154; 2 mutations; Tovu 277/298 (the 21 reds are the Postgres-only files, red on base) | `1540b26e` / `a13fdbcef` PARTIAL (5 files stay, reasons below) |
| 3 | devops: deployments tool-metadata | Opus | 5 tool-metadata files to `@jini-ai/core/tool-metadata/*` (landed pattern; deploy-ops and site-backup are factories with host vocabulary). `agent-tools`, `dockerfile`, `deploy-targets/types`, `execution-mode` (env name injected), static-publish `types`/`domain-publish-rows`, `saved-key-bindings`. `contracts.ts` deleted (forwarder). | ~64 | core 28/28, devops 5/5; 2 mutations | `8e6f251a` / `bed41d2c5` DONE |
| 4 | cms: publish-trust / trash | Opus | `grant`, `provisioning`, `provisioning-status`, `provisioning.node-io` (`nodeProvisioningFileIo`), `revocations`, `directory-rollback-log` (reporter with injected log sink). 6 tests moved. | ~50 | cms 216/216, Tovu 353/353 (`frozen-values` pin green, `TOVU_PUBLISH_TRUST` unchanged, fail-closed); mutations: fail-closed (4 red) and message | `e5d1b3ce` / `74e31b0dd` DONE |
| 5 | admin2: recovery screen | Opus | `rules`, `recovery-i18n` (split into 3 locale groups), `use-recovery`, `use-restore-flow` (required host) | 9 | Jini 12/12, admin 230/230; 2 mutations | `0a640fb0` / `bff187304` PARTIAL (screen, api and wiring stay) |
| 6 | desktop: DT-desktop-1 | Opus | `find-menu` (adapter over usability `findMenu`), `node-toolchain` binder, speech `speech-ipc` and `mac-on-device-transcriber`. `transcription-port` deleted (duplicate). Channels, `TOVU_*` names, copy and the helper path are injected and byte-identical. | ~14 | desktop-host 970/970, desktop 231/231; 4 mutations | `93b426ca` / `8727e66c8` PARTIAL (`shell-staleness` skipped) |
| 7 | devops2: export-run | Opus | `export-run` as `createExportRunner` (instance-owned single-flight). Tovu `export-run-binding` holds the one instance. The single-flight pin was written first, against the old module. | 10 | Jini 5/5, Tovu 70/70; mutation "guard disabled" | `38616387` / `e9efa3c93` DONE (ports, host-kit, deploy-config and capability-card skipped) |
| 8 | dns: domain-dns | Opus | `binding.repo` (kernel and sql tag injected), `dns-changes`, `mail-dns-status`, `mail-dns-tools`, `tool-deps`. Barrel deleted. | 13 | Tovu 243/243; 4 mutations | `70244b56` / `340505a92` + `0c9b2b5c4` DONE |
| 9 | admin3: database screen | Opus | `screens/database`: dictionary (3 locale groups), `rules`, 3 ports, 3 section hooks (required host). Schema-state wire types moved into admin core, and the Tovu duplicate was deleted. | 10 | Jini 16/16, admin 427/427; 5 mutations | `39394bbd` / `ea6c1e904` PARTIAL (screen and api stay) |
| 10 | dui: desktop renderer → ui | Opus | `FindBar` → `@jini-ai/ui/find-bar`, resources table → `@jini-ai/ui/resource-monitor` (`jini-*` classes; the host CSS selectors were renamed) | 5 | ui 9/9, renderer 872/876 (2 red on base); 2 mutations | `8f387ecf` / `1b10350d5` DONE |
| 11 | cms2: permanent-delete | Opus | `agent-tools` as `createPermanentDeleteSpecs({ customCredentialIdSource })`. Test-first sha256 pin. | 8 | Tovu 1246/1248, cms 5/5; mutation | `14c7bde1` / `20c9ae24f` DONE |
| 12 | sc: source-control | Opus | `provider-module` (the positional kit HTTP ABI is kept because shipped plugin `.mjs` files call it), `provider-kit` (egress describer and fetch observer injected), `commit-target`, `static-site-packager-port` | 27 | devops 110/110, Tovu 348/348 baseline kept; 2 mutations | `d6428a75` / `6c11a76de` PARTIAL |
| 13 | pc: publish dialog | Opus | `ui/{contract,criteria,phase,publish-order,replan,report-rows(+report-reasons),index}` → `@jini-ai/cms/publish/content/dialog`. It went to cms, not admin: Tovu's server needs it and depends only on cms. The entity-type labeler is injected and `sections.ts` stays with the host. | ~37 + 3 alias configs | Tovu 178/178, admin 260/260; 2 mutations | `36852b4b` / `e168b0ca3` DONE (sheets 3–6 blocked) |
| 14 | admin4: deployment dictionary | Opus | `deployment-i18n` (2,561 lines → 8 files) with `createDeploymentTranslator({ hostDictionary })`; 126 product-named entries stay with the host. Old vs new `t`: 4,784 lookups, 0 differences. | 10 | Jini 85/85, admin 518/518; 2 mutations | `c7ac0066` / `fa13f5c3d` PARTIAL |
| 15 | admin5: import/export | Opus | `screens/import-export`: dictionary, git-backup rules, port and hook, import-export hooks. `AdminExportRunSnapshot` moved into admin core. | 13 | Jini 20/20, admin 297/297; 3 mutations | `3bf76c63` / `e1ed81c1a` PARTIAL |
| 16 | sb: site-backup | Opus | `saved-keys-port`, `static-download-html` (host HTML source editor injected) | 20 | devops 4/4, site-export 115/115, site-backup 1308/1311 (red on base); mutation | `48a19136` / `51500c6ce` PARTIAL |
| 17 | misc: recovery catalog and dns tools | Opus | recovery `agent-tools` as a factory (`@jini-ai/db/recovery/agent-tools`; host copy and the INV-04 citation stay host). Domain-dns `tools` and `dns-tools`: the neutral DNS vocabulary (`DomainDnsInputError`, `DNS_TYPES`) moved into core `net/public-dns-vocabulary` (universal), and the validators are injected from diagnostics (option (a), coordinator decision). | 10 + 8 | db 85/85, core 202/202, diagnostics 55/55, devops 160/160, Tovu 243/243; 2 mutations | `57dec773` + `df9c8557` / `4b278bf49` + `80178e996` DONE |
| 18 | pc2: type registry | Opus | `type-registry` logic → `createPublishContentTypeRegistry<TPorts>` (instance-owned, no default ports). Tovu `type-registry.ts` binds `TovuPublishPorts` and owns the instance. | 74 | cms 14/14, Tovu 784/784 publish-content + theme; 2 mutations | `21eed52a` / `956236863` + `1e6aa88d0` DONE |
| 19 | admin6: source-control dictionary | Opus | `source-control-i18n` with `createSourceControlTranslator` (host dictionary plus the host common dictionary). 2,760 lookups, 0 differences. | 2 | Jini 6/6 (full admin package 3,753 pass), admin 537/537; 2 mutations | `f7876033` / `3d47bb803` DONE |
| 20 | admin7: publish-content screen | Opus | `publish-scope` (host section lookup), publish-request store factory, section-button hook (required host) | 4 | Jini 23/23, admin 281/281; 3 mutations | `046b1676` / `cfe3ca73d` PARTIAL |


**Coordinator fixes after review:**
- Theme freeze: `theme-trash.test.ts` restored to base; the trash barrel binds the reporter instead (`44f3aeaed`).
- deploy-ops factory split under the 80-line function limit (Jini `24e9e4ae`).
- export-run stored raw error text, which was a new log-safety red. Fixed with a required `describeError`, plus a mutation (`b13c1612` / `d01df03f0`).
- desktop `main/index.ts` back to its base size (`cf8d2a277`, `660721b86`).
- The admin dictionary-sink rule now accepts `createSourceControlTranslator`'s `commonDictionary` binding (`a85a73dd1`).
- Why-comment rows: 400+ added, all with ids.
- API baselines regenerated (`147fde4a`, `b13c1612`).

**Coordinator decisions (please review):**
- pc put the publish dialog in cms, not admin. That avoids a new Tovu→`@jini-ai/admin` website dependency.
- sc kept the source-control kit's HTTP client positional. Shipped plugin modules depend on that ABI.
- misc option (a): only the pure DNS vocabulary goes into core, and the `node:` validators stay in diagnostics and are injected.
- admin5 reused Jini's `SourceControlCredential` model for git-backup rows.

## Self-check (before each push)
1. **No forwarding files.** Every Tovu host module left at an old path creates or binds something: a store instance, a translator, a registry, an export runner or a host object.
   - Exception (flagged for Codex): Tovu `publish-content/type-registry.ts` keeps 3 ports-independent `export type` lines, only because frozen theme files import them from that path.
2. **Hooks.** Jini hooks receive host hooks through a required `host`; no Jini component has a default hook.
3. **No server-framework types or console in Jini.** Logging is injected.
4. **CSS.** Only `jini-*` classes (find-bar, resource table).
5. **No new size or debt allowlist entries.** Dictionaries were split instead.
6. **Wire types** are deduped into admin core / core contracts where they were duplicates.
7. **Object args** with `_optional = {}` on new or changed exports. Kept positional on purpose: the plugin ABI and the store methods.
8. **Tests first plus a named mutation** for every behaviour-bearing change (about 50 mutations in total).
9. **Why-comments moved with the code.** Debt rows have ids and reasons.
10. **`## Wiring` sections** in every touched Jini folder.

## Gates (base = merge-15 worktree, same tools; findings diffed, not just exit codes)
**Jini:**
- build 0.
- typecheck 0 / 0.
- api:check 0 / 0, after regenerating 8 baselines; diagnostics' API is unchanged.
- check:hooks 0 / 0, check:errors 0 / 0.
- Red on both, with identical finding lines tip vs base: guard 1 / 1, size 1 / 1, complexity 1 / 1, why-comments 1 / 1.
- log-safety 1 / 1. After the `b13c1612` fix there is no new finding; the export-run one is gone.
- cross-package (XP3) 1 / 1: it cannot run (`bad revision 35c4961af`; no declaration snapshot exists, as earlier runs noted).

**Jini changed packages (vitest):**
- Green: admin, core, db, desktop-host (970), diagnostics (1095), ui (8885), agent-runtime.
- cms: tip 26 failures vs base 27, and none appear only on the tip.
- devops: the 4 failures seen under parallel load pass 38/38 when rerun alone; base has 1 of them.

**Tovu:**
- typecheck 0, typecheck:tests 0, admin tsc 0, desktop tsc 0/0/0/0.
- check:hooks 0, errors 0, complexity 0.
- Red on both: why-comments 1 (the same 78 base ids; 0 new after the rows) and size 1 (the same set; `main/index.ts` is back at 667, the base value).

**Tovu tests:**
- Node: 378 lane and changed test files, 5,203 pass / 25 fail on the tip. All 25 also fail on the base: the Postgres-only `copy-engine` and `tool-registrations.postgres` files (no DB credentials), `no-vendor-in-core`, `import-history-retention`, `import-restore` and `process-root-parity`.
- Admin vitest over every touched area: 280 files, 4,362 pass.
  - 5 reds: 3 also red on the base; `app-panel-permissions` passes alone (load flake); `dictionary-lookup-sinks` was fixed (`a85a73dd1`).
- Desktop renderer: 2 reds, both also red on the base.

## Skipped, with exact reasons
- **site-backup (≈38 files).** Root `share-policy.ts` needs `SHARE_LIMITS` (the numbers are inside refusal copy), product version-mismatch copy, and `TransformParams` from cms, which has no core contract yet (K4-seam-13). `share-file-policy` and `credential-warnings` need the secret redactor injected through a factory. `static-download-landing` emits host classes. `bundled-export-file-policy` depends on module-relative resolution. Recommendation: a core `TransformParams` contract, then `createSharePolicy({ limits, versionMismatchMessage })`.
- **publish-content sheets 3–6.**
  - `plan-rows` is now ready, but frozen `features/theme/__tests__/publish-content.apply.test.ts:27` imports `entityKey` from its path. Keeping that path would need a pure shim, which is forbidden.
  - `idempotency`, `report-labels`, `run-repo` and the `apply-*` files follow `plan-rows`.
  - `repo-handler`, `planner` and `file-tree-policy` are imported by theme files.
  - Owner decision: allow one theme import-line repoint.
- **source-control** `types`, `repo.memory`, the credential repos, `provider-registry`, `store`, `write-port`, `commit-site`, `credential-setup` and `tool-registrations`:
  - vendor-credentials `CredentialProjectHalf` has no core owner (X-vendor-credentials-1);
  - the files extend `TovuCredentialSetVaultAdapter`, which belongs to another lane;
  - they need XP3 packages (platform, integrations, db, cms);
  - they need the content-kernel type.
- **deployments.**
  - `ports.ts`: host positional `HttpClientPort` vs core's object form; needs a wire-shape decision.
  - `host-kit.ts`: needs new devops runtime deps (platform, diagnostics, `aws4fetch`); owner decision.
  - `deploy-config.ts`: host composition, every value host-owned.
  - `capability-card.ts`: all product guide copy.
  - `dockerfile` repo-root injection: would need non-import edits in a route file owned by w3-rtfnd.
- **database / recovery.**
  - `database/agent-tools.ts`: a 3-line host binder that stays.
  - `database/gated-hooks.ts` and `recovery/gated-hooks.ts`: already injection bindings. Deleting them means passing collaborators in route files owned by w3-rtfnd, and K4-seam-7 has not landed.
  - `copy-engine.ts`: holds persisted host naming literals.
  - `exclusions.ts`: host policy, already a Jini argument.
  - `table-catalog.ts`: a drizzle projection; would need a new drizzle dependency in db.
- **trash** adapters, `db-port`, `repo.sqlite`, `permissions`, `tool-kinds`: need `platform/db/content-kernel`. `registry.ts` is host composition (decided earlier).
- **`publish-trust/challenge.ts`:** the `tovu-publish-challenge-v1` wire constant would have to be injected through route handshake deps (owned by w3-rtfnd). Recommendation: a `messageVersion` input.
- **admin.**
  - deployment `deployment-api.types` (imports Security types) and its dependents.
  - `static-export-port` (`AdminExportRunSnapshot` is now in core, but `DEPLOYMENT_EXPORT_RESOURCE` is in the blocked `rules.ts`).
  - Visuals: the K2 `Icon` STOP.
  - source-control api types: XP3 platform.
  - Screens that use host classes: Recovery, Database, Deployment tabs, ImportExport, GitBackupCard, PublishContentDialog.
  - `criteria-publish-result.ts`: admin may not import cms (L5). Recommendation: move the dialog contract types to a core `contracts/publish-content`.
  - `use-publish-content-confirm` (an 816-line function).
- **desktop.**
  - `shell-staleness.ts` collides with devops `policies.ts`, which behaves differently on `__measurements__`/`__tests__` and has a different message. Recommendation: adopt Jini's `isBundleInput` and inject the explanation.
  - React rows AX-48/49/51/53/55/64/78/118/120/126: OWNER-Q-9, still open.
  - `nav-availability` and `product-telemetry`: product copy/vocabulary.
  - K5-desktop-1 / AX-114/115/128/129: their seams have not landed.
- **Routes** (`RT-K1-*`): owned by w3-rtfnd and not attempted.

## Notes for Codex
- Stale baseline rows I left alone (non-failing):
  - `development/scripts/check-architecture.baseline.json`: edges to the deleted `publish-trust/provisioning*` and `source-control/provider-module`.
  - `error-gate-debt.json`: the deleted database `use-migrate-forward-section` and `source-control-i18n` (`check:errors` reports them as "improved or gone").
- `development/parity/tool-guides.json`: hand-edited for the permanent-delete, recovery and mail-dns-tools paths; regenerate with `npm run check:tool-guides`.
- `fqfix-rationale.unit.test.ts` cites the Jini recovery hook through the `node_modules/@jini-ai/admin/src` symlink.
- The db builder started the local PostgreSQL 16 cluster and created role `la` for tests. The tests still cannot log in, so the Postgres reds remain environmental.

## FILES LEFT (`scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`)
| tree | moving (FILES LEFT) | excl. themes | lane areas | desktop keep |
|---|---|---|---|---|
| start (merge-15 + ex7 merge, `3f11b3b22`) | 2,266 | 2,155 | 295 | 215 |
| tip `a85a73dd1` | **2,195** | **2,084** | **237** | 215 |

Lane areas, start → tip:
- deployments 39 → 30
- source-control 17 → 12
- domain-dns 9 → **0**
- site-backup 43 → 40
- database-transfer 12 → 9
- publish-content-ui 8 → 1
- recovery 4 → 3
- permanent-delete 2 → 1
- publish-trust 10 → 6
- desktop 11 → 7
- adm-recovery 13 → 5
- adm-deployment 28 → 27
- adm-source-control 12 → 11
- adm-publish-content 14 → 13
- trash 18 → 17
- unchanged: publish-content 40, database 6, site-export 9

`plan.mjs` does not count the database and import-export admin screen moves under adm-* areas.
