PARTIAL 4c405d03f 60f2df303: 18 owned files STOPPED (10 need an owner decision or an unowned prerequisite: chart-providers, media/original, site-imports, render-theme-override, theme-preview-refresh, chat-comparison, forms-submit, static-menus, site-share, media-ref; 8 public render/sandbox/worker files blocked on the unowned render-context cluster) | 26 MOVE/split + 54 STAYS-HOST done | FILES LEFT 2,084 -> 2,065 / excl. themes 1,973 -> 1,954 | rv1123l FIX 1-8 applied

SHAs in the first line are the work tips before this report commit (Tovu `codex/w4-routes-tovu`, Jini `codex/w4-routes-jini`).

# w4-routes (2026-11-24): remaining admin/public route families → Jini specs

Unattended cloud run, Opus high coordinator. `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work; its fresh-evidence, test-first and pre-completion rules applied to every batch (each builder got a common brief with the owner self-check list and STOP rules).

- **Bases:** Jini `origin/integ/merge-16-2026-11-23` = `7490405a`, Tovu `origin/integ/merge-16-2026-11-23` = `3a9332247` (re-fetched before the final push: no new commits).
- **w3-rtfnd merged first** (it was not on merge-16): Jini `origin/codex/w3-rtfnd-jini` (`a95b0e2e`) → `9a07cd6c`, Tovu `origin/codex/w3-rtfnd-tovu` (`35880140e`) → `593688119`. Conflicts: package.json/README/INFO/ledgers union-merged (why-comment ledgers unioned by id; the `publish-credentials/list` export the union resurrected was dropped again per rv1123i, `ad5277bd8`); `admin-json-route-ports.ts` keeps HEAD's `forwardRejection` beside rtfnd's credential/origin options; `import.ts`/`skills/list.ts` delete side taken (HEAD's named-object `toPublishContentReportDto({ report })` carried into the Jini import spec); provider-settings `pluginIdParam({ params })` signature from merge-16.
- **Codex fixes 1–8 (`reviews/rv1123l.md`) applied** — Jini `ecae3b64a`, Tovu `fbb512dbf8`: (1) magic-link coerces after authorize, mutation `coerce-magic-link-before-authorize`; (2) raw-route `Vary` is the union of middleware/static/route values, mutation `raw-route-vary-replaces`; (3) presentation PATCH narrow imports + isolation entry; (4) provider-settings `savedProjection` (complexity ≤ 10); (5) guarded raw mounts take the origin context and refuse registration without it, mutations `raw-mount-drops-origin-context`, `raw-mount-allows-guard-without-origin`; (6) `deferMissingPrincipal` + `sessionCredentialOnly` refused at registration, mutation `defer-principal-skips-credential-gate`; (7) panel-access evidence repointed to Jini sources, 45/45; (8) members/skills object mount options; K1 §3/§9 reconciled (raw contract vs adapter, `protocol`, `adminPublishTrustFor`, origin context, handler-name parity needs a pin).
- **Setup:** Jini `pnpm install --frozen-lockfile` + `pnpm -r build` (0 TS errors). Tovu `npm ci --ignore-scripts` (root + admin), `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, contracts tsc, sdk build. Tests and gates ran on Node 24 (`/opt/node24`; Node 22 lacks `RegExp.escape`, which Jini cms uses). Base attribution: worktrees `jini-base` (merge-16) and `tovu-base` (`593688119`, merge-16 + rtfnd).

## Batches

| batch | model | files moved (owned) | importers / host edits | tests | status |
|---|---|---|---|---|---|
| F rv1123l fixes 1–8 | Opus | — | admin ports, members/skills modules, panel-access, K1 | magic-link 10, http-kit 781→799, ports 25, panel-access 45/45; 5 named mutations RED→GREEN | done |
| A admin routes 1 | Opus | `http/change-sets.ts`, `media/byte-size.ts` | change-sets/media modules, media list/stored-media-response | Jini 25, Tovu 28 | done (4 STOPPED, 7 STAYS-HOST; widgets → E) |
| B admin publish-content | Opus | `publish-content/{export,blob-get,blob-put}.ts` | `modules/publish-content-blobs.ts` | Jini 103, Tovu 82; `blob-sha-parse-accepts-malformed`, `blob-get-document-404-drops-no-store` | done |
| B2 sites/system | Opus | `system/browser-telemetry.ts` | `modules/system-telemetry.ts` | Jini 8, Tovu 17; `telemetry-credential-gate-removed` | done (rest STOPPED → K/N/O/J) |
| C public site helpers | Sonnet | `http/site/member-auth-script.ts` | pages/response.ts (marker injected) | Jini 4, Tovu 43 | done (render cluster blocked) |
| D1 public middleware | Opus | `middleware/theme-asset-dirs.ts`; splits: `canonical-site-host`, `theme-content-security-headers`, `theme-static-assets` decisions | host adapters keep pinned names | Jini 9, Tovu 45; `font-cors-case-sensitive` | done |
| D2 public routes | Opus | `site/pages/redirect-phase.ts`, `render-context/collection-lists.ts` | handlers/home, listing, post-not-found, slug-routes, static-tier | Jini 6, Tovu 239 | done |
| E widgets + assistant/shared | Opus | `widgets/preview.ts`, `assistant/bridge-preflight-entry.ts` (→ daemon), `shared/request-id.ts` (→ http-kit) | widgets module, agent-daemon-scope-runtime, observability-middleware | Jini 19, Tovu 45; `preview-no-defer` | done |
| G theme page preview | Opus | split: `theme-page-preview` decisions → cms | Tovu adapter keeps session gate + writes | Jini 7, Tovu 58; `drop-preview-csp-sandbox` | done |
| H buffered raw reply | Opus | `agent-plugin-surfaces/files.ts` | `modules/agent-plugin-surface-files-route.ts` | http-kit 7 (test-first), Jini 8, Tovu 34 + pre-move wire pin; `buffered-reply-ignores-if-none-match`, `surface-files-streams-unbuffered` | done |
| I guard fix | Opus | — (collection-lists collaborators injected) | static-tier | Jini 3, Tovu 117 | done |
| J site previews | Opus | `sites/site-previews.ts` | `modules/site-previews-route.ts`, system/sites, themes/preview | wire pin first (5), Jini 7; `site-preview-streams-unbuffered` | done (see note) |
| K legacy-order options | Opus | `system/site-backups.ts` | `authenticateBeforeWorkspace`, `workspaceRefusal`; widget preview 401 restored | 71; `workspace-before-session`, `workspace-refusal-ignored` | done |
| L deferred body seam | Opus | `agent-plugins/install.ts` | `modules/agent-plugin-install-route.ts` | http-kit 799, Jini 4, Tovu wire pin first + 55; `raw-body-read-before-authorize` | done (site-imports STOPPED) |
| M form presentation | Sonnet | `http/site/form-presentation-assets.ts` | form-wire-policy names, 6 importers (import lines) | sha256 pin first 3/3, Tovu 40 + 218, Jini 2 | done |
| N credential-copy | Opus | `system/credential-copy.ts` | `AdminRequestFacts.localAdmin`, `modules/system-credential-copy.ts` | exact-wire pin first 5/5, 67 total; 2 mutations | done |
| O site shares | Opus | `system/site-shares.ts` (8 of 9 routes; download stays host) | `modules/system-site-shares.ts`, 8 test import lines | wire pin first 8/8, 128 Tovu, Jini 7; `SS-M1-artifact-flag-dropped` | done (partial file) |
| P admin surfaces | Opus | `agent-plugins/admin-surfaces.ts` | `preflight` mount option, `modules/agent-plugin-admin-surfaces-routes.ts` | gate-order pin first, 32/32 + 24; `preflight-after-credential-gate`, `surface-preflight-dropped` | done |
| Q doc render contract | Opus | `render/doc/doc-render-contract.ts`; `MediaAssetRenderMeta` → Core `cms-media` | 17 import lines repointed | Tovu 475/477 (2 base-red) | done (media-ref STOPPED) |

New wire-preserving seams (all opt-in, test-first, documented in K1 §9.3/§9.4 and `server/INFO.md`): http-kit raw `bufferedReply` (Express `res.send(Buffer)`: Content-Length, weak ETag, 304, HEAD), raw `readBody` deferred body reader (core `contracts/server/deferred-body.ts`), Tovu admin mount options `authenticateBeforeWorkspace`, `workspaceRefusal`, `preflight`, request fact `localAdmin`.

## Owned files (98): MOVE / STAYS-HOST / STOPPED

Prefix `apps/website/src/server/inbound/`.

**MOVE (21 gone from Tovu + 5 split, logic in Jini, Tovu keeps a pinned adapter):**
admin-http/http/change-sets.ts · routes/media/byte-size.ts · routes/publish-content/{export,blob-get,blob-put}.ts · routes/sites/site-previews.ts · routes/system/{browser-telemetry,credential-copy,site-backups}.ts · routes/agent-plugins/{install,admin-surfaces}.ts · routes/widgets/preview.ts · assistant/bridge-preflight-entry.ts · shared/request-id.ts · public-http/http/site/{member-auth-script,form-presentation-assets}.ts · render/doc/doc-render-contract.ts · middleware/theme-asset-dirs.ts · routes/agent-plugin-surfaces/files.ts · routes/site/pages/redirect-phase.ts · routes/site/pages/render-context/collection-lists.ts.
Split (counted as done; host file is a real adapter with the route-table-pinned name): middleware/{canonical-site-host,theme-content-security-headers,theme-static-assets,theme-page-preview}.ts · routes/system/site-shares.ts (8/9 routes; `GET …/:shareId/download` stays: `res.sendFile` + `res.destroy()` mid-stream).

**STAYS-HOST (pure composition / host adapter):**
- admin-http/authorize-guard.ts — host Express authorize-then-403 helper with publish-trust override, 100+ importers.
- admin-http/local-admin-request.ts — reads the Express socket/Host/proto with host boot policy (bind-host, local-owner-signin); now also behind `AdminRequestFacts.localAdmin`.
- routes/{external-mcp,forms,media,taxonomy}/deps.ts — only narrow Tovu `RouteDeps` (`Pick<…>`) + registrar types (composition layer).
- routes/external-mcp/guard.ts, routes/media/route-guards.ts — Express `Response` gates still used by hand-written host routes.
- routes/publish-content/route-helpers.ts — Express helpers of the host peer push relay; pure parts already in Jini.
- routes/widgets/preview-render.ts — theme/document adapter, injected as `renderPreview`.
- public-http/http/site/{form-wire-policy,seo-render-context,site-chat-markup}.ts, render/{site-assistant-mount,components/registry}.ts — product wire names/copy (K3), Express request adapter, `tovu/*` component table.
- public-http/middleware/{theme-preview-static,site-chat-static}.ts — `express.static` mounts; {published-webmcp,public-page-security-headers,theme-preview-switcher}.ts — Express glue over host features/product markers.
- public-http/routes/site/{forms-admission,forms-multipart,chat-comparison-html,pages}.ts — host Express adapters / product copy / route-order composition.
- assistant/* (27 files): agent-daemon-scope*, -run-session, -idle-park, index.ts — host composition root and process policy; durable-run-routes, federation-{admissions,reload}-route, tool-access-lowering-route, agent-plugin-preflight-events — Express routes on the daemon's internal app with no Jini spec family; assistant-{runtime-guidance,system-overlay,filesystem-notices}, capability-manifest-prefix — product prompt copy (K3); early-run-session, run-start-decisions — typed on the host durable-run store; run-log-lines, run-lifecycle-tracing — host log formatters (banned in Jini); assistant-browser-lease, assistant-run-tool-facts, attempt-process-identity, chat-attachment-directory, plugin-prompt-assembly — host resource/process/site-dir policy.
- shared/{json-body-parsers,route-guards,trust-proxy}.ts — host Express body policy / glue / proxy signals.

**STOPPED (exact reason + recommendation):**
- routes/plugins/chart-providers.ts — its `app.use(base, guard)` entry is pinned in the route table (removing it renumbers every later row) and unmatched sub-paths would change 401/403 → 404. Decision: may the pin be regenerated? Then two raw specs with `Cache-Control` on success.
- routes/media/original.ts — exports Express helpers used by unowned `public media-rendition.ts` and assistant `get-chat-attachment.ts`; convert all three together in one lane (web-`Response` builders).
- routes/system/site-imports.ts — `/uploads` manipulates the socket (`req.setTimeout`, `req.destroy`, busy flag on close); `/owner` uses `express.urlencoded` with `inflate: true` while the deferred reader never inflates (owner rule 2026-11-14) — recommend accepting non-inflate; unknown parser error types (`charset.unsupported`, `parameters.too.many`) need reasons added to the core refusal type.
- public-http/middleware/render-theme-override.ts — request-local key read directly by unowned `site-cookie-consent.ts`; move set/resolve with a `hasRequestRenderTheme` reader adopted there first.
- public-http/middleware/theme-preview-refresh.ts — POST registered as `[requireAdminSessionMiddleware>forwardRejection]` (one mount handler changes the pinned chain) and thrown authorize errors go to `next(error)` today vs the mount's redacted failure. Owner call on both.
- public-http/routes/site/chat-comparison.ts — `app.use(base)` namespace guard with bare `sendStatus(403)`s and Cache-Control on every method; recommend STAYS-HOST (dev-only surface, K3 page).
- public-http/routes/site/forms-submit.ts — one `app.post` with five handlers (admission before parsing, urlencoded, raw, multipart, Jini handler); splitting changes the route table. Recommend STAYS-HOST composition.
- public-http/routes/site/pages/render-context/static-menus.ts — needs `features/theme` static-menu types/`scanMenuEmbedIds` (render/theme cluster, K4).
- public-http/routes/site-share.ts — `res.sendFile` semantics + `app.use("/_share")` terminator + product strings; recommend STAYS-HOST.
- public-http/http/site/render/doc/media-ref.ts — moving it creates 3 SI-domain edges (widgets, media); fix by injecting `renderImageTag`/`mediaPublicPath`/`mediaUrlKey` through `DocNodeRenderDeps` in the batch that moves `doc-nodes.ts`/`nodes-media.ts`.
- public-http/http/site/{handlebars,liquid}-{render,sandbox,worker}.ts, worker-sandbox.ts, render/document-shell.ts — blocked on unowned `render-context.ts`, `render/blocks.ts`, `render/template-render-data.ts`, `features/theme/*`; worker-sandbox also carries host esbuild/tmpdir/env policy (needs an injected "prepare worker dir" hook). Order: render-context → blocks/template-render-data/doc nodes → workers → sandboxes.

## Decisions taken by the coordinator (flag for review)
- **site-previews unit test:** J's pre-move `site-previews.wire.test.ts` (node:http; bytes, Content-Length, ETag, 304, HEAD, refusal bodies and order) replaces 5 mock-Express cases in `site-previews.unit.test.ts` that pinned `res.set`/`res.json` call shapes and a mock-request failure copy the real route never answers; the 2 helper tests stay. Test count for the route: 7 mock → 5 wire + 7 Jini spec + 2 helper.
- **Edges only reachable without the real auth middleware** (production wire unchanged, documented): site-backups / site-shares read the principal before publish-trust (publish-trust-auth always sets both); agent-plugin-surfaces/files answers the public 500 if `resolveClientIp` itself throws (it doesn't).
- **Handler-name changes in the route-table pin** (inventory/order identical): `put …/site-shares/artifacts/:token/:file` `[<a>><a>><a>]` → `[<anonymous>]`; agent-plugin zip install/update `[installHandler]` → `[<anonymous>]`. The pin was already red on the base (posts autosave / users / internal daemon rows from merge-16 + rtfnd); not regenerated so the base drift stays visible.
- **`widget-form-field*` class names** remain in the moved form CSS (output byte-identical; the same names already live in Jini `forms/html-render.ts`).

## Gates (base-diff vs merge-16; no new red)
All gates ran at the tips below on Node 24. Base = Jini `jini-base` worktree at merge-16 `7490405a8` with its own install and build. Tovu `tovu-base` worktree is at `593688119` (merge-16 + rtfnd, the lane's base), linked to the same Jini. Exit codes are base → head.

**Jini** (`pnpm -r build` 0 → 0; `api:update` regenerated cms/core/daemon/http-kit baselines in `60f2df303`):

| gate | base | head | note |
|---|---|---|---|
| typecheck | 0 | 0 | |
| guard | 1 | 1 | identical output: HW3 `packages/admin/src/shell/lib/shell-failure-log.ts` (pre-existing) |
| api:check | 0 | 0 | |
| check:size | 1 | 1 | identical: daemon `launch.ts` worsened, stale sidecar `json-ipc.ts` entries (pre-existing); no new size-exception entries |
| check:complexity | 1 | 1 | identical output |
| check:why-comments | 1 | 1 | identical output: 10 blocks in admin/agent-plugins/agent-runtime/chat/core/sidecar, none in w4 files |
| check:hooks | 0 | 0 | |
| check:cross-package (XP) | 1 | 1 | **+3 XP4 rows, all inherited from the required w3-rtfnd merge**: `core/contracts/server/route-reply.ts` (runtime `routeReply`/`isRouteReply` in a contracts module) and its two `__tests__`. No XP row from a w4 file. Recommend Codex take it up as an rtfnd finding: move the runtime half beside http-kit, or allow-list it. |
| check:errors | 0 | 0 | |

Changed-package vitest at head (Node 24):
- http-kit 799/799; core 3032/3032; daemon 4857/4858 → 4858 after the `split-parity` list gained `bridgePreflightEntry` (`624c59762`).
- cms 7005/7014. The 9 reds are all outside w4 files:
  - `forms/package-boundary`: changelog 0.7.2 vs package 0.7.3-next.2.
  - `universal-entries.boundary`: `media/document-ingress.ts → jsdom`; it also times out at 10 s.
  - `forms/result-html`: `RegExp.escape` on Node 22 only; it passes on Node 24.

**Tovu** (Node 24):

| gate | base | head |
|---|---|---|
| typecheck (+e2e) | 0 | 0 |
| typecheck:tests | 0 | 0 (after `9bd03737e`; 3 test-only type errors fixed) |
| check:why-comments | 1 | 1. Same id set as base: 27 w4 ids ledgered in `bcce16119`/`4c405d03f` plus builder rows. |
| check:size | 1 | 1 (identical violation list; nothing from w4) |
| check:complexity / hooks / boundaries / errors | 0 | 0 |
| check:architecture | 1 | 1. Identical regressed metric; propagation cost, API surface and hub count all improved. |
| admin vitest `panel-access.unit` | 37/45 | **45/45** (rv1123l FIX 7) |

Node tests: 411 files = every changed test file plus every test beside a changed source. Each file ran alone, 4 in parallel.
- Head: 4027 pass / 19 fail in 15 files. All 15 files were re-run on `tovu-base`, and 14 fail identically there:
  - owner-passkey ×2
  - site-backups.integration (`running.inProgress`)
  - 4 agent-daemon-server wiring files
  - byok-message-attachments
  - component-catalog-routes
  - render-form-layout
  - render.golden (contact-form / assistant hashes)
  - tiptap-render-contract (editor schema `Unexpected token 'default'`)
  - route-modules (`members` fixture)
  - assistant-byok.inputs-pin
- The 15th, `backstop.routes.pins` (36/1 under parallel load), passes 37/37 alone twice: a load flake.
- `create-app-route-table.pin`: red on base and head with the same unrelated rows. Base and head `UPDATE_ROUTE_TABLE_PIN=1` tables are identical ignoring indexes. The only handler-name changes are the two listed above.

## FILES LEFT
`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`; FILES LEFT = moving + shells; excl. themes subtracts the `theme` + `adm-themes` area files (111).

| tree | FILES LEFT | excl. themes |
|---|---|---|
| merge-16 (combine-16 final) | 2,187 | 2,076 |
| + w3-rtfnd merge (this run's base, `593688119`) | 2,084 | 1,973 |
| w4-routes final | **2,065** | **1,954** |

Owned list: 98 files → 21 moved, 5 split (logic in Jini, pinned host adapter), 54 STAYS-HOST, 18 STOPPED.
