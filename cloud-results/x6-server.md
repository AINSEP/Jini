PARTIAL 76f2bebc60 42fad8470: 233 lane files left (public-http 86, admin-http 65, contracts-core 25, site-backup 37, publish-content 20); next wins need mount opt-ins (413 body, text/plain writers, path body parser), the content-html factory, gated-hooks injection (SEC) and the SEC route families (Opus)

SHAs in the first line are the work tips before this report commit (Tovu `codex/x6-server-tovu`, Jini `codex/x6-server-jini`).

# x6-server (2026-11-24): Tovu -> Jini extraction, SERVER/CONTRACT lane

This was an unattended cloud run. Opus coordinated. Every move or conversion was done by a Sonnet subagent at high effort: 16 dispatches (A–P), at most 4 running at once. No Opus subagent was needed. Security-adjacent pieces were either kept host (`gated-mutations/*`) or moved verbatim with a byte pin (`saved-keys` AAD).

`AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read first, and **this report confirms it**. Every worker got a common brief built from it:
- root cause first, minimum change;
- test-first, with a named mutation for every behaviour-bearing change;
- fresh evidence before any claim, and the pre-completion checklist;
- the owner self-check list and the STOP rules.

## Setup
- **Base.** Tovu and Jini `origin/integ/merge-20-2026-11-24` (Tovu `b115aa29b6`, Jini `c10ebb88b`). Branches: Tovu `codex/x6-server-tovu`, Jini `codex/x6-server-jini`. Both were pushed before any work and then after every batch. Intermediate pushes are `wip(x6-server)` snapshot commits.
- **Jini.** `pnpm install --frozen-lockfile` and `pnpm -r build`: 0.
- **Tovu.**
  - `npm ci --ignore-scripts` with npm 10 (Node 22.23.5) ran the `@tovu/contracts` `prepare` against the registry `@jini-ai/core` and aborted, which left `node_modules` empty.
  - Re-run with `npx npm@11.6.2 ci --ignore-scripts` in root, admin and desktop: 0. Then `link-jini`, `prepare-desktop-hooks`, and a hand build of `packages/{contracts,sdk}`: all 0.
- **Node is 22 here, not 24.** Many Tovu tests are red on the base for that reason alone (e.g. `RegExp.escape`), so every test comparison below is base-vs-branch on the same machine.
- **Baselines** came from clean worktrees: `/home/user/wt/jini-base` (its own install and build) and `/home/user/wt/tovu-base`, with `@jini-ai/*` linked to jini-base.
- **Planner.** `combine-18-plan.mjs` (from `integ/merge-18`) plus `plans/P9-data/tools/scan.mjs` (from `plan/whats-left-1122`), run on merge-20 before and on the branch after.

## FILES LEFT (combine-18 planner, `src` count per area)

| area | before (merge-20) | after | moved/converted |
|---|---|---|---|
| public-http | 95 | 86 | 9 |
| admin-http | 71 | 65 | 6 |
| contracts-core | 54 | 25 | 29 |
| site-backup | 38 | 37 | 1 |
| publish-content | 32 | 20 | 12 |
| **lane total** | **290** | **233** | **57** |
| all areas | 1308 | 1251 | 57 |

LOC in the lane: 38,200 → 33,029.

## What moved (59 Tovu source files deleted, the code now in Jini)

| tovu file (`apps/website/src/`) | result |
|---|---|
| `contracts/core/tool-metadata/{comments,commerce,custom-credentials,frontend-control,fs-files,media-generation,permanent-delete,recovery,redirects,search,seo,settings,site-evidence,site-inspection,sites,trash,visitor-tools,web-screenshot,web,webhooks,widgets}.ts` (21) | MOVED -> `@jini-ai/core/tool-metadata/<x>`, verbatim. Placement follows precedent `ea2cb0941`: runtime data never goes under `contracts/`. |
| `contracts/core/tool-metadata/{agent-plugins,plugin-runtime,site-guide}.ts` | MOVED -> `@jini-ai/core/tool-metadata/<x>` as factories (`create<X>ToolMetadata({ bundledThemePluginId \| pluginKeyword \| productName })`). The host aggregator `tool-metadata/index.ts` binds the Tovu words, so the projected text is byte-identical (pinned in `host-vocabulary.test.ts`, +3 cases). |
| `contracts/core/tool-metadata/assistant.ts` | MOVED -> `@jini-ai/chat/core/assistant-tool-metadata` (needs chat; extends `history-tool-metadata`). Mutation `drop-redeemable`. |
| `contracts/core/native-approval-memory.ts`, `operator-locale.ts` | MOVED -> `@jini-ai/core/native-approval-memory`, `@jini-ai/core/operator-locale`. `operator-locale` joins the core `settings` isolation domain, and `errors/idioms.ts` became shared (guard SI-domain fix `d5adf5ad9`). |
| `contracts/core/theme-slots.ts` | MOVED -> `@jini-ai/cms/themes/theme-slots` |
| `contracts/core/public-page-security-headers.ts` | MOVED -> `@jini-ai/cms/public-http/middleware/public-page-security-headers` (test 3 → 3) |
| `contracts/core/events/outbox-drainer.ts` | SPLIT. The generic `trackOutboxDelivery({ bus, tracker })` moved to `@jini-ai/infra/events/domain-outbox`. The host retry table, noop tracker and `console.error` stay. Mutation `wrong-span-attribute`. |
| `features/site-backup/saved-keys.ts` | MOVED -> `@jini-ai/devops/backup/site/saved-keys`. The AAD domain literal is now a REQUIRED `passwordAadDomain` dep. The host passes the exact old literal, so existing sealed share passwords stay readable; the bytes are pinned in Tovu `saved-keys-aad-pin.test.ts`, written before the move. Mutations `drop-capture-refusal`, `hardcode-aad-domain`. |
| `features/publish-content/{content-references,plan-rows,idempotency,report-labels}.ts` | MOVED -> `@jini-ai/cms/publish/content/<x>`. Mutation on `labelPeerPlanRows`. |
| `features/publish-content/{backstop-preview,publish-backstop-file}.ts` | MOVED. Host policy injected per coordinator decision 8: the neutral `RawBackstopPolicy`/`RawFilePolicy` types went into `backstop-refusal`, while limits, tables and copy stay in `backstop-policy.ts`. The `[publish-content]` log tag stays host via an injected `warn`. Tests 98 → 98. |
| `features/publish-content/{planner,export-bundle,apply-run,repo-handler}.ts` | MOVED, generic over the ports bag `<P>`. The host registry is injected as a REQUIRED `catalog: { build }`. Tests 238 → 238, of which 28 moved to vitest. Mutation `catalog-injection-ignored`. |
| `features/publish-content/{apply-failure,apply-row}.ts` | MOVED. `@jini-ai/plugins` is no longer imported: the `isPluginHookFailure` and `attachRefusedItem` deps are injected, and cms gained no new package edge. Mutations `plugin-hook-predicate-ignored`, `created-existing-not-conflict`. |
| `features/publish-content/backstop-service.ts` | MOVED as `createBackstopService({ policy, redact })` in `@jini-ai/cms/publish/content/backstop-service`. Tovu keeps a binding at the same path (Tovu limits, value scan, copy, and the `redactSecretShapes` that carries the Tovu key rule). Mutation `redact-not-applied` (Jini and Tovu). |
| `server/inbound/public-http/http/{shared/post,content/posts,site/render-context}.ts`, `.../render/components/layout.ts`, `.../routes/site/{product-checkout,pages/render-context/taxonomy}.ts`, `server/inbound/admin-http/http/posts.ts` | MOVED -> `@jini-ai/cms/{public-http,admin-http}/...`. The `layout.ts` footer credit is a K3 `creditText` option; the host passes `"powered by Tovu"`, byte-identical, with `layout.test.ts` and mutation `drop-host-copy`. |
| `server/inbound/admin-http/routes/taxonomy/merge-term.ts` (3 routes) | K1-CONVERTED -> `@jini-ai/cms/admin-http/routes/taxonomy/merge-{plan,confirm,execute}` (+ `merge-shared`). Wire 28 → 28 unchanged. 22 spec tests were written first. Route-table rows are identical. Mutation `merge-error-ladder-drops-token-expired`. |
| `server/inbound/admin-http/routes/forms/{authoring,create,delete-submission}.ts` (+ `forms-write-error.ts` deleted, no importers left) | K1-CONVERTED -> `@jini-ai/cms/admin-http/routes/forms/*`. Wire: 127 tests, the same 123 pass / 4 fail as base. Route-table pin output is byte-identical to base. Mutation `forms-authoring-skips-authorize`. |
| `server/inbound/public-http/routes/site/{feed,llms,robots,sitemap}.ts` | K1-CONVERTED to raw specs under `@jini-ai/cms/public-http/routes/site/`. The 4 route tests are 28 → 28, plus a new trusted-proxy `x-forwarded-host` wire pin (2 cases, green before conversion). Route-table output is identical. Mutation `serving-origin-ignored`. Seams added:<br>(a) a host failure writer on Tovu's public raw mount (P9-SEC OD-2 precedent, host-only), which keeps the text/plain 500, the tracker report and `Error ID`;<br>(b) an OPTIONAL `servingOrigin` on core `RouteRequestFacts` (types only). Tovu computes it lazily with the one `servingOriginFor` helper that `seoForRequest` now also uses. |

## STAYS-HOST / STOPPED / BLOCKED (files looked at this run)

| tovu file (`apps/website/src/`) | result |
|---|---|
| `contracts/core/gated-mutations/{ports,token,gateway,composition}.ts` | STAYS-HOST: host bindings over Jini `core/gated-mutations` (ctok_ tokens, 600 s, owner-only instance authorize, DB/restore ports). Security seam, not touched. |
| `contracts/core/approval-i18n.ts` | STAYS-HOST: 21-locale Tovu deploy-flow copy; its only consumer is the host `human-confirm.ts`. |
| `contracts/core/consent-refusal.ts` | STAYS-HOST: Tovu copy and admin hrefs. The type is already in Core, and cookie-consent takes `deploymentRefusal` injected. |
| `contracts/core/custom-credential-categories.ts` | STAYS-HOST: the host runtime list (the type is in Core; agent-plugins takes it injected). |
| `contracts/core/runtime-mode.ts` | STAYS-HOST: reads `TOVU_RUNTIME_MODE` (cms takes `resolveRuntimeMode` injected). |
| `contracts/core/settings-vocabulary.ts` | STAYS-HOST: Tovu setting keys and labels allowlist. |
| `contracts/core/theme-ids.ts` | STAYS-HOST: `RENAMED_THEME_IDS` holds `"tovu-theme"` (cms takes `themeIdCandidates` injected). |
| `contracts/core/tool-metadata/content-read.ts` | STAYS-HOST: `content_read` is a guarded host tool name. It was moved back by the coordinator (same decision as Jini `59df376ac`). |
| `contracts/core/tool-metadata/site-update.ts` | STOPPED: its only importer is in `features/site-update/` (merge-21 lane folder). One-line repoint once that lane lands. |
| `contracts/core/tool-metadata/index.ts` | STAYS-HOST: host aggregator and word bindings. |
| `contracts/core/{rate-limit/rate-limit,page-html,events/outbox-worker,events/outbox-retry-policies,assistant-run-events,entry-refs/unindexed-ref-warning,plugin-credential-card,tool-failure-diagnostics,agent-permission-mode,chat-delete-grant}.ts` | STAYS-HOST, in order:<br>- Tovu rate-limit profiles and trust-proxy fallback;<br>- `data-tovu-agent` model copy;<br>- host scheduler, logger and retry table;<br>- host policy composition;<br>- Tovu `RUN_NOTICES` copy;<br>- host `console.warn` sink;<br>- host app id;<br>- host credential-token binding;<br>- `TOVU_AGENT_PERMISSION_MODE` plus `@tovu/contracts`;<br>- "Tovu admin screen" copy. |
| `contracts/core/human-confirm.ts` | STAYS-HOST: `ui://tovu/…` and `tovu-<tool>` names, plus host copy imports. A split would need three injected params (recommended later, behaviour-sensitive). |
| `features/site-backup/{archive-media,static-export-selection}.ts` | STAYS-HOST: thin bindings over Jini `bufferArchiveMedia` and the selection parser. |
| `features/site-backup/share-policy.ts` | STAYS-HOST: the neutral refusal names are already in Jini `share-refusal`. What is left is limits, tables, copy and exit codes (decision 8). |
| `features/site-backup/*` (33 others) | BLOCKED: `platform/site-dir`, `platform/http`, `@tovu/contracts/secret-redaction`, `archive-paths` (KEEP), or devops lacking edges to cms/agent-plugins/platform/plugins/db/integrations. Files: `archive-extensions`, `archive-manifest`, `backup-service`, `bundled-export-file-policy`, `download-html-source-edits`, `import-{backend,backend-steps,database,keep-off,plugin-state,registry,restore,restore-placement,verifier,verifier-inventory,verifier-projection}`, `package-file-inventory`, `plan-content`, `push-content`, `share-{backend,database/repo.sqlite,file-policy,hosting,preparation,preparation-steps,registry,service,zip}`, `sources`, `static-{copy,download-landing,download-layout,site-packager}`, `tool-registrations`. `archive-paths` and `import-archive-reader` are KEEP. |
| `features/publish-content/{publish-content-peer-repo,publish-content-peer-repo.sqlite,publish-backstop-row.sqlite,tool-deps,gated-hooks}.ts` | STAYS-HOST: SQLite/content-kernel adapters, host wiring; `gated-hooks` needs `planHashOf`/`resolveActorClassIdentity` from host gated-mutations (security seam). |
| `features/publish-content/{push-plan,apply-report,peers,peer-transport,destination-credential,connect-destination,pull,disconnect-tool,publish-tool,tool-registrations,file-tree-policy,permissions,raw-file-contributor,raw-row-contributor,export-bundle callers}` | BLOCKED: `peer-transport` (Tovu `tovu_api_key` redaction rule + `platform/http`), `peers` (`platform/secrets/vault-kinds`), `gated-hooks`, `platform/routing`, or a missing cms edge (diagnostics, user-management, admin, plugins). |
| `server/inbound/public-http/middleware/{canonical-site-host,render-theme-override,theme-content-security-headers,site-serving-gate}.ts` | STAYS-HOST: Express `app.use` adapters over existing Jini modules. |
| `server/inbound/public-http/routes/site/{chat-comparison-html,pages/request-policy}.ts`, `admin-http/routes/forms/deps.ts`, `admin-http/routes/taxonomy/deps.ts` | STAYS-HOST: the dev-only page copy (W5); Express `Request` types plus `x-tovu-*`/`tovu_*` literals; host route bags (K1 Departures). |
| `server/inbound/public-http/http/site/render/content-html.ts` | STOPPED: the two host render constants are not reachable through `SiteRenderContext`, and threading them would touch 32 test files. It also emits `data-tovu-taxonomy*` literals. Recommendation: `createContentHtmlRenderers({ docNodeHost, widgetRenderHost, taxonomyAttributes })` plus one host composition binding. `blocks`, `page-body`, `post-body`, `bare-page` and the `handlebars-`/`liquid-render` files have further blockers (`static-render-content`, theme allowlists, `components/registry`, `template-render-data`). |
| `server/inbound/public-http/routes/site/products.ts` | STAYS-HOST: `sendPublicPage`/`resolvePerVisitorResponse` Express pipeline (owner B230). |
| `server/inbound/admin-http/routes/publish-content/blobs-probe.ts` | STOPPED: the 413 body differs (`rejectOversizedJsonBody` copy vs core `payloadTooLargeError`), and 413-before-workspace-404 ordering cannot be reproduced by any mount (K1 §4.4/§9 known gap). |
| `server/inbound/admin-http/routes/posts/template-preview.ts` | STOPPED: plain-text 404, 403 and 500 bodies plus the path-scoped `express.urlencoded` parser are not expressible through the admin raw mount. §9.6 of the K1 template is optimistic here. |
| all other `public-http`/`admin-http` files (172 classified) | See `cloud-results/x6-server-route-classify.md`: 59 K1-CONVERT (24 SEC), 68 STAYS-HOST, 45 BLOCKED, with one-line reasons. Before this run's conversions. |

## Gates (branch vs merge-20 base, same machine)

| gate | base | branch |
|---|---|---|
| Jini `pnpm -r build` | 0 | 0 |
| Jini `pnpm typecheck` | 0 | 0 |
| Jini `pnpm guard` | 1 violation (HW3 `admin/shell-failure-log.ts`) | the same single violation |
| Jini `pnpm api:check` (after `api:update`: chat, cms, core, devops, infra baselines) | 0 | 0 |
| Jini `check:hooks` | 0 | 0 |
| Jini `check:why-comments` | 16 blocks | the same 16 ids |
| Jini vitest on the changed test files (chat, cms, core, devops, infra) | — | all 0 |
| Tovu `tsc -p tsconfig.json` / `typecheck:e2e` / admin tsc | 0 / – / 0 | 0 / 0 / 0 |
| Tovu `check:hooks` | — | ok |
| Tovu `check:why-comments --base merge-20` | — | 44 lost blocks found, now 0 open, exit 0:<br>- 8 restored verbatim in the host files (`seo-documents.ts`, `serving-origin.ts`);<br>- 36 `why-comments-debt.json` entries, each citing where the block now lives in Jini (lightly reworded, e.g. "./index.ts" → "the host aggregator"). |
| Tovu node tests: 528 files (108 changed test files plus 474 importers of changed sources; `--test-concurrency=2`) | 6324 tests, 190 fail in 188 files (Node 22 drift) | 6329 tests, 191 fail in 189 files. The one new red file (`forms/__tests__/provider-save.unit.test.ts`, a missed importer) was fixed in `3f17e209ac` and is now 1/1 pass. **Net: no new red.** |

`apps/desktop` was not touched, so the pre-push hook skipped the desktop gates on every push.

## Self-check (every push)
- **No re-export or forwarding files.**
  - Every Tovu host file that remains is a composition binding holding host values: the tool-metadata aggregator, `backstop-service.ts` binding, `seo-documents.ts` registrars and `forms-admin`/`taxonomy` registrars.
- **No server-framework types or host log formatters in Jini.**
  - Express adapters stayed host.
  - `[publish-content]` and `[collection]`-style tags are added host-side through injected `warn`.
- **Shared wire types are in a neutral Core owner.**
  - The only new Core contract field is `RouteRequestFacts.servingOrigin?` (types only).
- **Object args.**
  - New and changed exported functions use `fn(required, _optional = {})`.
- **Behaviour changes are test-first, with a named mutation.**
  - See the per-row mutations above. No wire output changed.
  - Route-table pin output is identical to base for the converted rows. The pin is red on base from unrelated drift and was never regenerated.
- **Product words.**
  - `rg -i tovu` is empty on all new Jini files.
  - Moved test fixtures use neutral strings.

## Caps
- **Wall clock:** about 2 h 15 min (21:35–23:50 UTC).
- **Coordinator:** about 185 tool calls; context stayed under the cap.
- **Subagents:** 16 in total (A–P), at most 4 at once.
- **Per-subagent budget:**
  - Three ran over the 45-call budget: K 58, N 51 and G 49 (each near or just over 100k tokens; K about 181k).
  - Their returns were verified by the coordinator's gates.
  - This is recorded as a cap deviation.

## Coordinator decisions taken this run (no new owner decision needed)
1. **Tool metadata goes to `@jini-ai/core/tool-metadata/*`, not `contracts/site/`.** That is precedent `ea2cb0941` (XP4).
2. **`content-read` metadata stays host** (precedent `59df376ac`, R5).
3. **SEO raw routes: host-only failure writer plus optional `servingOrigin` fact.** This follows the P9-SEC OD-2 precedent. The specs keep the stored-origin fallback when the fact is absent, because robots tests pin that.
4. **`worker-import-graph.test.ts` entries.**
   - `http/shared/post.ts` was dropped (the file moved; package isolation guards it now).
   - `routes/site/feed.ts` was repointed to `seo-documents.ts`.

## Left / recommendations
- **`content-html` factory.** Recommendation above. It unblocks nothing on its own until `static-render-content`, the theme allowlists and `template-render-data` are extracted.
- **Admin/public mount port gaps:**
  - a per-mount 413 body;
  - text/plain refusal and failure writers;
  - a path-scoped body parser.
  These would unblock `blobs-probe`, `template-preview` and similar hand-written routes. Recommend one small "mount opt-ins" lane (test-first, additive).
- **`gated-hooks` / `apply-report` / `push-plan`.**
  - These need `planHashOf`/`resolveActorClassIdentity` injected (security seam, Opus) and `peer-transport` extracted.
  - `peer-transport` carries the Tovu `tovu_api_key` redaction rule. Owner B258 says to inject Tovu key patterns into the Jini redactors.
- **Site-backup.** The 33 blocked files need devops edges or `site-dir`/`platform/http`/`secret-redaction` injected first.
- **SEC route families** (members/OIDC, owner-auth, api-keys, fs-files custom roots, site-share password, publish-trust auth) should go to an Opus lane.
- **`site-update` tool metadata.** A one-line repoint after merge-21.
