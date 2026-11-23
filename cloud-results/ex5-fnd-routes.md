PARTIAL 602bb18fd 6a77fd1fd: RT-K1-adm-system-1 credential-copy + RT-K1-adm-sites-1 site-previews (non-JSON ServerRoute halves), RT-K1-adm-redirects-1 create.ts (pinned direct-invoke order) — everything else ready in this lane is DONE or recorded STAYS

# ex5-fnd-routes — FOUNDATION: K1 route base (Tovu `codex/ex5-fnd-routes-tovu`, Jini `codex/ex5-fnd-routes-jini`)

Unattended cloud run, Opus high, coordinator plus 7 subagents in two waves (4 + 3; each disjoint, none committed). Bases: Tovu `origin/integ/merge-13-2026-11-22` `f7185f153` (= `0d7f78fa4` + docs), Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`. Wall-clock about 1 h of the 3.5 h cap; it stopped because every RT-K1 sheet that is ready in these bases is done. All remaining RT-K1 sheets wait on unlanded K5/K4/V/X lane steps (list below).

The SHAs on the first line are the last content commits. The commit that adds this report, plus its Jini copy, follows them and adds only the report.

## Setup
- Node 24.22.3 (`/opt/node24`), pnpm 10.33.2, npm 11.
- **Jini:** `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0. The clone was unshallowed so `35c4961af` (the XP base) resolves.
- **Tovu:** `npm ci --ignore-scripts` in root, admin, desktop and site-chat, all 0. `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` 0. `packages/contracts` tsc 0, `packages/sdk` build 0.
- **No PostgreSQL** in this run, so the one `*.postgres.test.ts` in the test set is ENV-red (see Tests).
- **Base reference:**
  - Jini gate outputs: `cloud-results/combine-14-jini-raw/gates-final/` (that tree is this base).
  - Tovu gate outputs: `cloud-results/combine-13-tovu-final-*`.
  - The route-table pin and the red test files were re-run on a clean worktree at `f7185f153` (`git worktree`, sharing the same `node_modules`).

## Batch table

| # | step(s) | who | Jini | Tovu | result |
|---|---|---|---|---|---|
| 0a | **RT-K1-0.T (narrowed, approved)** | coordinator: cherry-pick of `ee1cc47ff` + `781a613c8` from `codex/ex2-tovu-halves` (Codex APPROVE, `reviews/ex6-review-tovu-halves.md`) | — | `78746b70e`, `f02c93567` | refusals + body cap from Jini; Express middleware keeps the exact 413 |
| 0b | **BX-53/54** (returned-vs-thrown parity, http-kit) | coordinator | `6c77257a9` (+ complexity fix in `6a77fd1fd`) | — | DONE |
| 0c | **RT-K1-0.T B8** host ports | coordinator | — | `539507ed2`, `5b02da5b8`, final workspace rule in `ca7c9ee99` | DONE |
| A | RT-K1-adm-content-1, -database-recovery-1, -recovery-1 | subagent | in `15536bdb0`/`26d647f69`; db injection in `797622823` | `3e89c62fb`, `ca7c9ee99`, `16de005f4` | recovery-1 DONE; content-1 and database-recovery-1 STAYS (see Skipped) |
| B | RT-K1-adm-database-2 | subagent | `15536bdb0`/`26d647f69` | `3e89c62fb`, `ca7c9ee99` | DONE |
| C | RT-K1-adm-redirects-1, -2 | subagent | `15536bdb0`, `ede6e2c58`, domain map `797622823` | `3e89c62fb` | -2 DONE; -1 partial (`create.ts` STAYS) |
| D | RT-K1-adm-system-1, -sites-1 | subagent | `15536bdb0`/`26d647f69` | `3e89c62fb` | partial (2 non-JSON files STAY) |
| E | R-admin-http-1 (minus `http/forms.ts`, owned by ex5-small) | subagent | `31af3a441` | `bda3be8d1` | 4 moved, 2 STAYS |
| F | R-public-http-1 (minus the form helpers and placeholder, owned by ex5-small) | subagent | `cb83453ed` (+ coordinator vitest for value-readers) | `6bc618ed5` | 3 moved, 5 STAYS |
| G | RT-K1-pub-site-site-chat-markup-1 | subagent | export dropped `6352a1cba` | — | STAYS |
| — | API baseline + changeset `p9k-ex5-fnd-routes` / `p9k-bx-53-54` | coordinator | `6a77fd1fd` | — | |
| — | why-comments allow-list (16 moved blocks) | coordinator | — | `602bb18fd` | gate back to base |

`wip:` commits (`15536bdb0`, `f26a35c8b`, `3e89c62fb`) are commit-every-10-min snapshots taken while subagents were still editing. The reviewed commits after them supersede them; squash at merge if wanted.

### What the foundation provides (feature lanes build on this)
- **http-kit `JsonRoutePorts.onReturnedError` (opt-in).**
  - A returned `err` from `parse` or `handle` reaches the host with `{ res, error, status (core default), phase }`.
  - Without the port, the base behaviour is unchanged: the core `{ error }` envelope, and a returned error never reaches `onError`. Codex's ex2-review-b FIX asked for exactly that; the base pins stay green, 49/49 adapter tests.
  - New test: `packages/http-kit/src/__tests__/adapter-returned-errors.test.ts`.
- **Tovu `apps/website/src/server/inbound/admin-http/admin-json-route-ports.ts`.**
  - `createAdminJsonRoutePorts({ failure?, authorization?: "guarded" | "direct", workspaceScoped? })`, the default `adminJsonRoutePorts`, and `mountAdminJsonRoute(required, { failure?, authorization? })`. Workspace scoping comes from `spec.path` (`:workspaceId`).
  - `createPublicJsonRoutePorts` / `mountPublicJsonRoute({ …, failure: { operation, visitorError, status? } })`.
  - Each port is built only from the existing helpers:
    - the `rejectForeignWorkspace` rule, including its pinned `?? ""` 404;
    - `getAuthedPrincipal`;
    - `authorizeOrRespond` ("guarded", which honours publish-credential grants) or `authorizeDirectOrRespond` ("direct"), with the same 403 body;
    - `sendAdminFailure` with the route's own options;
    - for public routes, `reportServerFailure` plus the route's visitor copy and `errorId`.
  - Returned failures are written flat as `{ error: message, code, details? }`.
  - Settings keeps its own ports (corrected plan B2/B8: owner-held authorization change).
  - **Parity gate**, real HTTP, 7/7 (`admin-http/__tests__/admin-json-route-ports.test.ts`):
    - a returned parse failure, a returned handler failure and a thrown refusal all produce the same flat body;
    - the Express cap answers the exact legacy `413 {"error":"Content too large to save.","code":"PAYLOAD_TOO_LARGE"}` at cap+1, and the route does not run (cap itself → 201);
    - a foreign workspace gets 404 before any authorization;
    - a denial gets the same 403 body as `authorizeOrRespond`;
    - a publish credential with guarded vs direct authorization;
    - an unexpected failure gets the redacted admin 500 or the visitor-safe public 500;
    - a deployment-level path without `:workspaceId` gets 200.
  - **Mutations:**
    - Dropping the admin `onReturnedError` turns the parity case red (5/1).
    - My first workspace-rule fix (`5b02da5b8`, "skip when the param is absent") turned 3 pinned direct-invoke 404 tests red (`status-route-guards` ×2, `local-sites.pins`). That is how it was caught; it was replaced by path-derived scoping in `ca7c9ee99`.
- **Mounting recipe the lanes should copy:**
  - The Jini spec uses core `defineJsonRoute` with its own `<Name>RouteDeps` and does not import Express or http-kit.
  - Every refusal is a thrown `rejectRoute`. When the old route authorized before validating, `parse` is total and validation happens in `handle`.
  - The host passes **request-time** deps (getters, or closures over `deps`). Many route tests reassign `deps.authorize` or ports after registration, and copying at mount time turned 5 recovery tests red.
  - Body-size middleware stays in Tovu: `app.<m>(path, rejectOversizedJsonBody(...))`, registered immediately before the mount.

## Files moved (Tovu → `@jini-ai/cms`)
- **Routes (K1 specs):**
  - `admin-http/routes/database/{restore-points,schema-state,timeline}` (4 routes; db functions injected)
  - `recovery/{deep-link,disclosure,restore-points}` (db collaborators injected and bound by the host)
  - `redirects/{get-by-id,hits,import,list,tombstone,update}` plus the neutral half of `redirects/shared` and `http/redirects` (DTOs)
  - `system/{assistant-daemon,module-status}`
  - `sites/local-sites` (5 routes)
- **R lane:**
  - `admin-http/http/entity-not-live`, `routes/assistant/execution-request-fields`, `routes/settings/preview-feed-access`, `sea-runtime` (a `node` entry)
  - `public-http/http/site/render/{value-readers,media-playback-copy}`, `public-http/routes/site/pages/listing/listing-state`
- **Jini tests:** 92 in 20 files under `cms/src/{admin-http,public-http}` (all pass), written first per K1 (`parse` + `handle` with fakes; recovery binds the real db functions as the host does). Moved R-lane tests: entity-not-live 3, execution-request-fields 4, sea-runtime 3.
- **Tovu tests:** every route test stays in Tovu with its assertions unchanged. Only import lines moved, to the host registrars.

## Steps skipped / STAYS, and why
- **RT-K1-adm-content-1, RT-K1-adm-database-recovery-1 — STAYS (planner misclassification).** `content/deps.ts` and `database-recovery/deps.ts` are only `Pick<RouteDeps, …>` aliases and an Express registrar type. They are the host's registration contract (owner 11-20: `RouteDeps` is only read at registration), with no route and no neutral code, so nothing moves. Their 35 importers keep the Tovu path. Downstream sheets that list them as a dependency are not blocked by this.
- **RT-K1-adm-redirects-1 `create.ts` — STAYS.** `redirects-create.test.ts` "a body-less request … direct invoke is a 400" calls the handler without a principal. The adapter authenticates before `parse`, so it would answer 500, and per the STOP rule the test is not changed. It now imports the Jini DTO and mapping table. Options for the owner:
  - a lenient authenticate port that reads the principal at authorize time;
  - accept the direct-invoke-only ordering change.
- **RT-K1-adm-system-1 `credential-copy.ts` — STAYS (ServerRoute).** It needs `Cache-Control: no-store`, `isLocalAdminRequest(req)`, the session-credential check *before* the workspace 404 (the adapter orders workspace first), an owner check and `{reasonCode}` bodies.
- **RT-K1-adm-sites-1 `site-previews.ts` — STAYS (ServerRoute).** It sends image bytes with immutable cache headers, and `system/sites.ts` imports its helpers.
  - Both need the node-bridge `createNodeDispatcher` path.
  - Their direct-invoke tests (`extractRouteHandler` with hand-built `req`) would need a dispatcher-aware harness.
- **R-admin-http-1 `admin-dev-proxy.ts`, `admin-static.ts` — STAYS.** Express handlers, raw `node:http` upgrade, `TOVU_*` env vars, product copy. `http/forms.ts` is on `codex/ex5-small-*`.
- **R-public-http-1:**
  - `member-auth-script`, `chat-comparison-html` (product copy, `data-tovu-*`/`tovu-*` ids not passed through args): STAYS.
  - `canonical-site-host`, `site-chat-static` (Express middleware, `TOVU_SITE_CHAT_DEV_PROXY_URL`): STAYS.
  - `theme-content-security-headers`: STAYS (themes stay).
  - The form helpers and widget placeholder belong to ex5-small (its owner decision on `tovu-form` names is pending).
- **RT-K1-pub-site-site-chat-markup-1 — STAYS.** The `mountId: 'tovu-site-assistant-root'` literal type is a deliberate no-injection guarantee, and the CSS hard-codes Tovu's accent `oklch(55.29% 0.1129 43.4)` ("match site-chat-theme.css"). Downstream site-render sheets mostly import only its `SiteChatSelection` type, which can be restated.
- **No other RT-K1 sheet is ready in these bases.** Every remaining one needs at least one unlanded K5/K4/V/X/T step. The most-cited are K5-contracts-core-3 (24), V-members-3 (14), V-theme-6 (11), K5-contracts-core-2 (10), T-theme-1 (10), K5-post-1/3 (9), X-identity-1 (8), K4-seam-14/16. Foundation-owned shared sheets such as system-2/3/5/6/7/10, pub-middleware-1 and pub-site-1…11 are all in that state.

## Which ex4 lane steps are now unblocked
- **RT-K1-0.T is no longer a blocker anywhere.** This run supplies the host ports every lane needs. It was the stated first blocker in ex4-media, -settings, -addons, -integrations and -deploy, and ex5-small.
- **Fully ready now** (every dependency landed in these bases plus this run):
  - **RT-K1-adm-seo-1** (Settings lane): its `R-admin-http-1` dependency is satisfied by `entity-not-live`.
  - **RT-K1-adm-forms-1** (ex5-small lane) is ready once `codex/ex5-small` (`admin-http/http/forms.ts`) merges.
- **One dependency left:**
  - **RT-K1-adm-media-1**: V-media-3
  - **RT-K1-adm-consent-1**: K5-consent-1
  - **RT-K1-pub-site-seo-render-context-1**: K5-seo-1
  - **RT-K1-adm-integrations-1**: K5-webhooks-4
  - **RT-K1-pub-mail-feedback-1**: K5-mail-1
  - **RT-K1-adm-skills-1**: K5-skills-1
  - **RT-K1-adm-plugin-hook-error-1**: K5-contracts-core-2
  - **RT-K1-adm-menus-1**: K5-navigation-1
  - **RT-K1-adm-comments-1**: K5-comments-1
- **ex4-media's RT-K1-adm-media-3/-4:** their `R-admin-http-1` dependency is satisfied for the files they use, but they still need K5-media-*.
- **ex4-security U-AUTH-T1:** the host `onError` port that maps `RouteRefusalError` to the flat body now exists to copy. OD-2 (`next(error)` forwarding) is still the owner's question.

## Gates (base-diff; raw: `cloud-results/ex5-fnd-routes-raw/`)

| Jini (`6a77fd1fd`) | base (combine-14 final = this base) | final |
|---|---|---|
| build / typecheck | 0 / 0 | **0 / 0** (0 `error TS`) |
| guard | 0 | **0** (it was 23 at the wave-1 tip; fixed in `797622823`, see below) |
| api:check | 0 | **0** (baseline updated: cms adds 24 subpaths, http-kit `JsonRoutePorts` adds `onReturnedError`) |
| size / complexity / hooks / error-gate | 1 / 1 / 0 / 0 | **identical** (complexity was +1 on `mountJsonRoute`'s callback at wave 1; fixed by reading the port once at mount) |
| why-comments `--base 4902a6a1a` / default (terra) | — / 1 | **0** / 1 (351 lost, 341 allow-listed, vs base 352/342) |
| check:cross-package XP1–5 | 39/33/2050/760/6 | **identical** (the wave-1 tip had +3 XP1/+3 XP3 from the recovery `@jini-ai/db` imports; fixed by injection) |
| log-safety | 1 | **1, +4 rows, listed not suppressed:** `[stored-error-text]` in `admin-http/http/entity-not-live.ts`, `routes/database/restore-points.ts` ×2, `routes/redirects/shared.ts` ×2, `routes/redirects/tombstone.ts`. All are moved code verbatim: a closed, classified domain error's message (`RestorePointUnavailableError`, `ValidationError`, `RedirectNotFoundError`, the write-chokepoint mapping, entity-not-live) written into a 4xx body, as the Tovu route did. **Reviewer call:** accept as debt, or introduce a public-message field on those error classes. |
| hooks | 0 | 0 |

**Guard at the wave-1 tip → fixed:**
- L3/L5/XP: the recovery specs imported `@jini-ai/db` (cms may import only core and protocol). They now take one bound collaborator each, which the host closes over its ports per request.
- SI-domain: the redirects admin entries reach `src/redirects` and `listing-state` reaches `src/listing`. `jini.isolation.entries` maps them to their domains, as ex5-small did for the forms admin entry.

**Changed-package vitest:**
- http-kit: 39 files / 753 tests, all pass.
- cms: 451 files / 5113 tests, 1 fail: `forms/src/__tests__/package-boundary.test.ts` expects `0.7.3-next.2` and receives `0.7.2`. This is version metadata in files this run did not change (cms and forms `version` are identical to `4902a6a1a`), so it is **BASE-RED**.

| Tovu (`16de005f4` + allow-list `602bb18fd`) | combine-13 final | final |
|---|---|---|
| size / boundaries / complexity / hooks / errors / worker-import-graph | 1/0/0/0/0/0 (26/26) | **identical** |
| typecheck(+e2e) / typecheck:tests / desktop tsc ×4 | 0 / 0 / 0 | **0 / 0 / 0** |
| typecheck:scripts / architecture | 2 / 1 | **identical** (architecture: 1 fewer deep-import edge; propagation 3.28 vs 3.29) |
| why-comments | 1 (80 blocks) | **1 (80 blocks)**: the 16 new losses are blocks that moved to Jini or became obsolete, each verified by phrase and allow-listed with its destination (`602bb18fd`) |
| **admin tsc** | 0 at merge-13 | **2 (4 errors), BASE-RED with merge-14 linked.** Jini merge-14's A-K2-0a.J makes `AdminKit` require `Icon`/`useT`/`values`. Its Tovu half A-K2-0a.T (Codex APPROVE) is on `codex/ex2-tovu-halves` and not in this base. The clean base worktree gives the same 4 errors. No admin file changed in this run. |
| **route-table pin** (`create-app-route-table.pin.test.ts`) | 3 pass / 7 fail at `f7185f153` | **byte-identical output** (3/7, same assertion diffs). Every moved route keeps its method, path, handler chain and relative order. The pin file is unchanged. |

**Tests:**
- **Set:** 122 node files = the 18 changed test files + every test that imports a changed production file by dir/basename. Each ran alone under a 15-min watchdog, 3 in parallel. **116 green.** The 6 red files are:
  - **BASE-RED, identical failing case names at `f7185f153`:**
    - `resolve-html-page-embeds.integration` 64/1
    - `pages-update-html-auth` 12/1 (trashed page 409)
    - `render-form-layout` 1/3
    - `tiptap-render-contract` 73/1
    - `render.golden.characterization` 12/1
  - **ENV:** `create-site-route-deps.postgres` 0/2 (no Postgres in this run).
- **Admin vitest:** not run, because no file under `apps/admin` changed (only `apps/website` and `development/why-comments-debt.json`).
- **Named mutations:** all went red in Jini and Tovu, then were reverted and dist re-emitted. Where the sheet's target STAYS, the nearest moved refusal was used:
  - database-2: `costAck !== false`
  - recovery-1: deep-link envelope check
  - redirects: import `rules` parse and hits `?? ""` id
  - system-1: 409-on-refused
  - sites-1: trash `confirmed`
  - R-admin-http-1: negated entity-not-live guard (4 Tovu suites red)
  - R-public-http-1: negated `str` (render.test 63 red)

## FILES LEFT (`scan.mjs` + `plan.mjs`, `origin/plan/whats-left-1122` `a2e4f88cf`, clean worktrees)

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (`theme` + `adm-themes` = 111) |
|---|---|---|---|---|
| base `f7185f153` | 2,486 | 0 | **2,486** | **2,375** |
| tip `16de005f4` | 2,464 | 0 | **2,464** | **2,353** |

−22 = 23 source files deleted minus 1 new host composition file (`admin-json-route-ports.ts`).

## For the reviewer (Codex)
1. **Port contract gap: `entityId`.** `JsonRouteAuthorize` carries only `{permission, entityType}`. The hand-written get-by-id/hits/tombstone/update redirects routes and others also passed `entityId`. Tovu's `authorizeCore` declares `entityId` but never reads it (user-management `authorize.ts:41`), so there is no behaviour change today. If entity-scoped grants arrive, core's `JsonRouteAuthorize` needs an optional `entityId` (API change, owner call).
2. **Two small ordering changes, both reachable only by direct-invoke without a principal or by double failure; no test covers them:**
   - local-sites: the site-switch gate used to run before reading the principal.
   - local-sites: a throwing `isSiteSwitcherEnabled` used to escape to Express; it now reaches `sendAdminFailure`.
   - redirects import: the principal is now read before body validation. In real HTTP, `requireAdminSession` always sets it first.
3. **Constructed refusals.** `assistant-daemon` throws `new RouteRefusalError({status:409, body:{ok:false, reason, code}})` and `module-status` throws one with the raw snapshot as the 503 body. `rejectRoute` cannot express those bodies, so the core class is used directly.
4. **Product-ish wording.** A few doc comments in the moved specs still cite design-spec/ADR ids and "Dockerfile source PUT route" (no brand strings; guard green).
5. **Stale doc references.** Some Tovu comments still name deleted paths (`features/recovery/tool-registrations.ts:116`, `agent-tools.ts:25,165`, `ops/health.ts`, `skills/deps.ts`); they were left untouched.
6. **Registry gate.** As for ex2: Tovu's lockfiles still pin the registry `0.7.3-next.2` artifacts. These APIs need a publish before a registry-only gate can pass.
