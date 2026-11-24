DONE 2aa13bc48d 0d038d859 — every one of the 113 owned files has a decision: 11 left Tovu (10 moved to Jini, 1 forwarding shell deleted), 1 split (2 ports moved), 101 STAYS-HOST with a reason. FILES LEFT went from 2,187 to 2,177 (excluding themes, 2,076 to 2,066). No new red. 1 owner decision is open (sdk-resolver seam, recommendation below).

# w4-webfeat-b — Website feature folders, second half

- **Branches:** Tovu `codex/w4-webfeat-b-tovu` @ `2aa13bc48d`; Jini `codex/w4-webfeat-b-jini` @ `0d038d859`. Both are based on `integ/merge-16-2026-11-23`, which did not move during the run, so no re-merge was needed. Pushed with plain `git push`.
- **Programmer skills:** read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. These rules were applied: Base Skills; the workflow's ADR checklist, no behaviour change beyond the assigned scope, and the pre-completion checklist; the output format.
- **Owned list:** `origin/plan/whats-left-1122:inputs/w4/webfeat-b.txt`, 113 files.
- **Setup:**
  - Jini: `pnpm install --frozen-lockfile` exited 0, and `pnpm --no-bail -r build` exited 0 with 0 `error TS`.
  - Tovu: `npm ci --ignore-scripts` exited 0 in root, admin and site-chat. `link-jini.mjs` was run, and `packages/contracts` plus `packages/sdk` were built.
  - The baseline Tovu `tsc` was green.
  - Node is 22.23.5, not 24 (engine warning only).

## Batch table

| batch | model | files moved | importers repointed | tests | status |
|---|---|---|---|---|---|
| D1 plugin-runtime (10) | Sonnet, high | `lower-tool-access` → `@jini-ai/plugins/runtime/lower-tool-access`, with the host `LoweringError` class injected as a required args field. `service-ports` was **split**: `PluginPostReadPort` and `PluginProviderFacesPort` → `@jini-ai/plugins/runtime/service-ports`; `PluginHostFactsPort` stays (host-signals contract). | 10 | Jini runtime 4/4; Tovu lower-tool-access + set-enabled 3/3, tool-registrations.plugins 18/18, capability-tool-registrations 32/32 | done; 8 STAYS-HOST |
| C1 site-backup 1–3 (10) | Opus, high | `credential-warnings` → `@jini-ai/devops/backup/site/credential-warnings`. The host passes `redactSecretShapes` (B258). | 20 | 409 tests across 10 files; 1 red, BASE-RED | done; 9 STAYS-HOST |
| A1 trash (11 + registry) | Opus, high | `adapters/marker-sql` → `@jini-ai/cms/trash/site/adapters/marker-sql`, generic over the host schema through `StorageKernel`. | 7 | 87/87 | done; 10 STAYS-HOST, registry STAYS (`ac1e4b68` precedent) |
| B1 publish-content 3/4/6 (8) | Opus, high | `run-repo` → `@jini-ai/cms/publish/content/run-repo` (report type is generic; defaults to Core `PublishContentReportDto`). `seed-hash` → `…/seed-hash` (host `buildCatalog` injected). | 26 | 104/104; Tovu tsc + tests-tsc 0 | done; 6 STAYS-HOST |
| C2 site-backup 4–7 + site-export (10) | Opus, high | none | 0 | n/a | all 10 STAYS-HOST (they depend on the host share-policy layer) |
| D2 project-keys + singles (12) | Opus, high | `vendor-credentials/project-scope` → `@jini-ai/integrations/vendor-credentials/project-scope`. This is the object-argument cutover that `4ef754c5` deferred; its characterization test is restored under vitest. | 7 imports + 9 call sites + barrel | Jini 9/9; Tovu 272/272; named mutation (negated `if (!project)` in the linked dist) → 33 red, restored green | done; 11 STAYS-HOST |
| A2 post + pages + trash-item-tool + origin (11) | Opus, high | `post/tiptap-text-schema` → `@jini-ai/cms/posts/tiptap-text-schema`. (`post-tool-schemas` and `tiptap-block-schema` were moved, then **returned by the coordinator**: guard R5 flags their model-facing copy because it names host tools, and they have no args object for K3. They were restored byte-for-byte from merge-16.) | 1 | 53/53 | done; 10 STAYS-HOST |
| B2 taxonomy + site-evidence (7) | Opus, high | `taxonomy/publish-term-ids` → `@jini-ai/cms/taxonomy/site/publish-term-ids` (structural `TermSyncDeps`/`TermSyncPorts`). `term-sync.ts` (one-line re-export) deleted. `site-evidence/agent-tools` → `@jini-ai/diagnostics/web-evidence/agent-tools`. | 8 | 127/127 | done; 4 STAYS-HOST (`taxonomy/agent-tools` was moved, then reverted: guard R5) |
| B3 publish-content 5 (4) | Opus, high | `composite-blob-source` → `@jini-ai/cms/publish/content/composite-blob-source` (`PeerBlobSource` declared locally) | 7 | 90/90 | done; 3 STAYS-HOST |
| coordinator | Opus | Self-check fixes: `lazyKernel({ store })`, `_optional` pads; guard N2 comment in run-repo; error-gate debt row moved with lower-tool-access; 13 why-comment debt rows | 7 | trash/taxonomy/entries/post 10 files, 104/104 | done |

**Commits.** Some SHAs below were later rebased on push, so the live branch history may show different SHAs. The commit subjects are unique.
- **Tovu:** `c1a593523` (D1), `3a7148e47` (C1), `1cf9631b8` (A1), `e8866d575` + `99a030cb2` (wip snapshots of B1/D2/A2/B2/B3, reviewed afterwards), `0a3b7b829` (B2/B3 + A2 revert), `c3759cba18` (error-gate debt + doc), `04b5995937` (why-comments debt), `2aa13bc48d` (lazyKernel callers).
- **Jini:** `c4b0ea08` (D1), `26c5d503` (C1), `d4ed9f53` (A1), `660cbf1b` + `c9393d37` (wip snapshots), `0a00f486` (B1 changeset), `de40af68` (A2/D2 baselines + changesets), `29e42d356` (B2/B3 + A2 revert + N2), `5633d39c2` (error-gate debt), `0d038d859` (object-args self-check).
- **Broken intermediate commit:** `c1a593523` swept in other batches' staged `git rm`s (`run-repo`, `seed-hash`, `credential-warnings`, `marker-sql`) before their importer repoints landed. Tovu HEAD did not build between `c1a593523` and `1cf9631b8`/`e8866d575`. The tip is green. After that, every commit used explicit pathspecs.

## Moved / removed from Tovu (11 + 1 split)
- `plugin-runtime/lower-tool-access.ts`
- `site-backup/credential-warnings.ts`
- `trash/adapters/marker-sql.ts`
- `publish-content/run-repo.ts`
- `publish-content/seed-hash.ts`
- `publish-content/composite-blob-source.ts`
- `post/tiptap-text-schema.ts`
- `taxonomy/publish-term-ids.ts`
- `taxonomy/term-sync.ts` (deleted shell)
- `vendor-credentials/project-scope.ts`
- `site-evidence/agent-tools.ts`
- `plugin-runtime/service-ports.ts`: split; the file stays, holding only the host-facts port.

## STAYS-HOST (one-line reasons)
- **plugin-runtime:**
  - `install` — host env (`TOVU_DESKTOP_OWNER_PID`, `TOVU_PLUGIN_LOCAL_INSTALL`) and hosted/desktop policy.
  - `repo.sqlite` — composition: host kernel + `plugin_activations` table.
  - `invocation-core-deps` — binds `@tovu/sdk` hook constants.
  - `widget-partials` — "Product binding": cms widgets + host `DEFAULT_THEME_SLOTS`.
  - `sdk-resolver` — PENDING, see STOP.
  - `built-ins/content-analyzer/{index,plugin}`, `built-ins/word-count/index` — `@tovu/sdk` `definePlugin` with `tovu/*` publisher ids that a test pins.
- **site-backup:** every remaining file imports the host `share-policy.ts` (`SiteShareRefusal`, `SHARE_LIMITS`, Tovu tables/copy), which is **not in this lane's list**. In detail:
  - `bundled-export-file-policy` — `SELECTED_AGENT_PLUGIN_PACKAGES`.
  - `import-keep-off` — Kysely over hard-coded Tovu tables + `NO_THEME_ID`.
  - `import-archive-reader` — host share profile + `SiteShareRefusal`.
  - `import-database` — `tovu-import-db-` prefix, version-mismatch copy.
  - `share-file-policy` — runtime layout / credential names.
  - `share-registry` — `.tovu.zip` naming, token format.
  - `archive-paths` — Tovu layout + copy.
  - `import-backend-steps` — `tovu-dev` default-password check, Tovu redaction options.
  - `static-export-selection` — only host-kept collaborators.
  - `archive-extensions` — `createTovuAgentPluginLifecycle`, host disk layout.
  - `archive-media` — share-preparation-steps / share-file-policy.
  - `import-verifier-projection` — import-verifier-inventory + host media barrel.
  - `static-site-packager` — host wiring of static-copy/share-zip.
  - `package-file-inventory` — bundled-plugins dir.
  - `share-database/repo.sqlite` — content kernel + Tovu table constants.
- **site-export:**
  - `index` — barrel of host members.
  - `theme-preview-manifest` — theme code (owner: themes stay).
  - `theme-preview-report` — host URL prefixes + Tovu-only type.
  - `export-failure-summary` — Codex 11-22 Tovu policy; the logic is already in Jini `static-export/failure-summary`.
- **trash:**
  - `adapters/{comment,post,redirect}` — positional `store`, host table names, no args object (a new args object = STOP).
  - `adapters/media` — host `media` table.
  - `adapters/member` — credential revocation over host tables.
  - `db-port` — `TrashDb = ContentKernel` alias.
  - `repo.sqlite` — composition.
  - `agent-delete-policy` — host tool ids.
  - `tool-kinds` — host kind policy.
  - `permissions` — host permission ids.
  - `registry` — `ac1e4b68`.
  - `trash-item-tool` — host delegates, permission ids and copy over the Jini mechanism; not a duplicate.
- **publish-content:**
  - `apply-retire` — host apply-failure/apply-row/idempotency values, no deps object.
  - `connect-destination`, `destination-credential` — host `peers.ts` + publish-trust handshake.
  - `publish-backstop-file`, `publish-backstop-row.sqlite` — host backstop-policy and its refusal class; the row adapter would need cms→db.
  - `disconnect-tool` — tool composition + product copy.
  - `apply-port` — wraps host apply-report with `TovuPublishPorts`.
  - `pull` — host destination-credential + peer-transport.
  - `publish-readiness-copy` — product copy, already the K3 field.
  - `publish-content-peer-repo{,.sqlite}` — composition over the host vault adapter.
- **post:**
  - `post-tool-policy` — host permission ids, module catalog.
  - `template-options` — host theme code.
  - `post-tool-schemas`, `tiptap-block-schema` — guard R5: their model-facing copy names host tools, and there is no args object for K3.
  - `repo.sqlite` — composition.
- **pages:**
  - `agent-tools` — host permission + guidance copy.
  - `skeleton` — starter-page product copy.
  - `index` — barrel of host members.
  - `html-document-store.sqlite` — composition.
- **taxonomy:**
  - `agent-tools` — guard R5 (`content_read`).
  - `publish-content` — host repo-handler + Tovu table names.
  - `repo.sqlite` — composition.
- **site-evidence:**
  - `collect-page-evidence` — the host `ObservationPolicy` (B258 redaction); the mechanism is already in Jini.
  - `tool-registrations` — composition (playwright loader, launch options, HttpClientPort).
- **project-keys:**
  - `attachments` — `site_key_attachments` table; user-management has no db dep.
  - `create-vault` — host conflict error + Shared Keys copy.
  - `service` — host permission-id mapping.
  - `shared-oauth-disconnect` — host `SharedOAuthOwnerStorage`.
  - `site-references` — persisted `plugin-state:tovu-*` ids.
  - `site-sealer` — persisted `'tovu'` AAD scope literal.
- **settings, redirects, widgets, presentation, source-control, vendor-credentials:**
  - `settings/repo.sqlite`, `settings/site-title-preservation.sqlite`, `redirects/repo.sqlite`, `widgets/repo.sqlite`, `presentation/repo.sqlite` — thin bindings of a Jini Sql repo to the host kernel and table names.
  - `presentation/index` — barrel with host members.
  - `widgets/media-html-log` — host log formatter.
  - `widgets/tool-registrations` — host binding of the Jini widgets mechanism.
  - `source-control/{repo.memory, source-control-credential-repo, .sqlite}`, `vendor-credentials/{repo.memory, vendor-credential-repo, .sqlite}` — subclasses of the host vault adapter.
  - `source-control/write-port` — "Tovu's bindings over the existing host functions".
- **Other singles:**
  - `site-search/index-state-store` — hard-codes migration 0027/0028 table names; search has no kysely/db dep.
  - `web/web-page` — product user agent.
  - `web/agent-tools` — host permission + copy over the Jini definition.
  - `webhooks/seal-aad-invariant` — static check that scans host source.
  - `storage/measure` — product storage policy.
  - `recovery/gated-hooks` — composition (host plan hash / actor identity).
  - `skills/install-adapters` — host npm adapter choice (yauzl/js-yaml).
  - `origin/index` — barrel; `configured-origin` is host.
  - `site-guide/index` — barrel.
  - `sites/{agent-tools, index, list-tool, site-preview/site-preview-service, warm-switch}` — plan KEEP: Tovu product.

## STOP / owner decisions (with recommendation)
1. **`plugin-runtime/sdk-resolver.ts`** (new seam). `require.resolve('@tovu/sdk')` cannot work from Jini's `dist`.
   - Recommendation: move it with `sdkModulePath` as a required field. The three callers (`cli/commands/serve.ts`, `cli/commands/export.ts`, `plugin-tier2/worker.ts`) and the `boot/plugin-sdk-resolver.ts` barrel would pass the host-resolved path. This needs those callers' owners.
2. **Jini `cms` `jini.isolation.shared` now includes `src/publish/transfer/apply-errors.ts`** (B2), so the taxonomy subpath can read the apply error classes. `apply-errors.ts` has no imports, and the class identity is preserved through the `publish/transfer` barrel.
   - Recommendation: keep it. The alternative is to inject the error classes into `prepareTermSync`.
3. **Unblocking site-backup (≈15 files)** needs a split of the non-owned `features/site-backup/share-policy.ts`: a neutral `SiteShareRefusal`/`archiveRefusalName` in `@jini-ai/devops/backup/site/share-refusal`, with limits, tables and copy staying in the host. The same pattern applies to publish-content `backstop-policy` (`BackstopRefusal`, `BACKSTOP_LIMITS`, `normalizeMode`) and `peers.ts`. Recommendation: plan these as their own lane, since they are outside this list.
4. **Trash adapters (comment, post, redirect, media) and `index-state-store`** can only move if their factories gain a `{ store, tables }` args object, which is a new args object (STOP rule). If the owner allows that, they become plain moves.

## Gates (base = merge-16; no new red)
- **Jini**
  - **build:** changed packages built; tsc 0 for plugins, devops, cms, integrations, diagnostics.
  - **guard:** 1 violation (HW3 `admin/shell-failure-log.ts`, the same violation as base). The R5/N2/SI hits that appeared mid-run were all fixed.
  - **api:check:** 0. Baselines were updated for plugins, devops, cms, integrations and diagnostics; 7 changesets.
  - **size, complexity, hooks:** output identical to base.
  - **why-comments:** 378 → 377 lost (improved).
  - **errors:** the one new entry (moved `lower-tool-access` `catch-reads-error`) has its debt row moved from Tovu → identical to base.
  - **XP:** no finding names any moved file. A base-vs-tip diff is not meaningful here: the base worktree had no `dist`, and both runs lacked `JINI_DECLARATION_BASELINE_DIR`.
  - **Changed vitest:**
    - plugins runtime 4/4, integrations vendor-credentials 9/9, devops backup 27/27.
    - cms trash/publish/taxonomy/posts: 516 pass, 3 fail. The failures (pglite dialect tests) are BASE-RED.
    - diagnostics web-evidence: 4 fail in `page-body.test.ts`, BASE-RED.
- **Tovu**
  - **tsc:** `tsc -p tsconfig.json` 0; `tsconfig.tests.json` 0.
  - **boundaries, complexity, hooks, errors, seal-aad:** pass, as on base.
  - **size:** same as base.
  - **architecture:** cross-feature edges 280 → 272, files 2,077 → 2,066, 0 new edges.
  - **why-comments:** 90 → 77 unmatched after 13 moved-with-code debt rows, which equals base.
  - **tool-guides:** red on base, green on tip. Its side-effect rewrite of `development/parity/tool-guides.json` (base line drift) was reverted.
  - **Admin vitest:** not run, because nothing under `apps/admin` changed (0 files in the diff).
  - **Node tests:** 133 files (every changed test, every test that imports a moved specifier, and the trash/taxonomy/plugin-runtime/site-evidence unit dirs), each run alone: **1,662 pass / 10 fail in 5 files**. All 5 fail identically at base (re-run in a clean merge-16 worktree):
    - `domain-no-direct-tool-registration.boundary` 6/1
    - `federate-mcp.unit` 30/4
    - `automatic-agent-plugins.integration` 41/2
    - `trash/sweeper` exit 1 (0 fail)
    - `plugin-host.integration` 22/3
  - **Other base reds:** `platform/db/sqlite/share-database.integration` 37/1 is the same at base. `site-evidence/playwright-browser.integration` was not run: it needs chromium-headless-shell-1228, which is not installed.
- **Mutations:** D2's mutation of `project-scope` (`if (!project)` negated in the linked dist) killed 33 Tovu tests and was restored green. The other moves are verbatim, with no behaviour change. Sheet-named mutations targeting files that stayed were not applicable.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, themes excluded = minus `theme` + `adm-themes`)

| | moving | FILES LEFT | excl. themes | owned files still counted |
|---|---|---|---|---|
| before (merge-16, reproduces combine-16) | 2,187 | 2,187 | 2,076 | 101 |
| after (Tovu `2aa13bc48d`, Jini `0d038d859`) | 2,177 | 2,177 | 2,066 | 91 |

`site-evidence/agent-tools.ts` was not counted by the scanner, so it is not in the −10.

## Self-check (before final push)
- **No forwarding files:** `term-sync` was deleted, the `vendor-credentials/index` lines were removed, and no Tovu shells were left.
- **No hooks involved.**
- **No server-framework types, no host log formatters, and no Tovu strings or paths in moved Jini code:** guard R5/N2 pass. A grep for `tovu|apps/website|#src` finds 0 hits in the 10 new files.
- **No new size exceptions.**
- **Shared wire type from Core:** `PublishContentReportDto`.
- **Object args with `_optional = {}`:** fixed on `lazyKernel`, `flipMarker`, `compareAndDelete` and `prepareTermSync`.
- **why-comments:** moved verbatim, and the Tovu debt rows name each comment's Jini home.
- **`## Wiring` sections:** present in `plugins/src/runtime/README.md`, `devops/src/backup/site/README.md`, `cms/README.md` (trash marker, posts, publish/content), `cms/src/taxonomy/site/README.md`, `diagnostics/src/web-evidence/README.md` and `integrations/src/vendor-credentials/README.md`.
