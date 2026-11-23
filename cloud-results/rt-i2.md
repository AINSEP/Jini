PARTIAL c903a43942 0dea5a818: api-keys, analytics, consent, publish-trust, public content, agent-plugin-surfaces (all STOPPED, 0 routes); fs-files (Jini spec done, Tovu mount held for the pin decision); stopped single routes: members/request-magic-link, skills/list, ops/readyz, fs-files/folder-picker ×2

# RT-I2 — K1 route families, independent batch 2

Branches: Jini `codex/rt-i2-jini` (from `origin/codex/k1-pilot-jini`), Tovu `codex/rt-i2-tovu` (from `origin/codex/k1-pilot-tovu`).
Programmer bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work, confirmed; subagents followed the template brief (tests first, verification, architecture-audit-style report).
Method: the coordinator dispatched 7 subagents (≤ 4 at a time: Opus for new shapes, Sonnet for template copies). Subagents never committed. The coordinator reviewed each diff against template §7 and committed per family (spec + tests + exports + API baseline + changeset in Jini; mount + deletions + why-comment debt + INFO Wiring in Tovu), then pushed.

## Summary

| family | routes | Jini | Tovu | state |
|---|---|---|---|---|
| admin members | 4/5 | ade18e364 | 71e4529b17 | request-magic-link STOPPED (Retry-After) |
| admin integrations | 5/5 | e9fa1fd69 | f2c845a096 | done |
| workspace | – | – | – | SKIPPED: already converted on `origin/codex/ex6-sites-tovu` |
| comments | – | – | – | SKIPPED: already converted on `origin/codex/ex7-coll-small-tovu` |
| admin trash | 4/4 | 9a9973a3a | f1fb154f81 | done |
| admin api-keys | 0/3 | – | – | STOPPED: credential-kind gate needs a host-port change |
| admin skills | 5/6 | c4f403ef7 | 37b3d827a4 | list STOPPED (ETag/304) |
| admin fs-files | 3/5 spec | a3fa0a140 | (patch) | custom-root spec committed; Tovu mount held (pin handler-name diff); folder-picker STOPPED |
| analytics | 0/1 | – | – | STOPPED: custom nested 500 envelope from res.locals |
| admin commerce | 1/1 | 10359dba8 | 75d781a8ca | done |
| consent | 0/5 | – | – | STOPPED: Cache-Control on every route |
| admin site | 1/1 | e750c5581 | d3ee24d9c3 | done |
| redirects-create | 1/1 | 0dea5a818 | c903a43942 | done (redirects 7/7) |
| agent-plugin-surfaces | 0/2 | – | – | STOPPED: non-JSON file serving |
| ops (public) | 2/3 | dacb8fab4 | be913a4374 | /readyz STOPPED (deploy-config reads its source) |
| publish-trust | 0/3 | – | – | STOPPED: Host header + Retry-After |
| public content | 0/1 | – | – | STOPPED: Cache-Control on success |

Docs commit: Jini 504b01857 (Wiring for trash/skills/integrations). The other Wiring paragraphs ride in their family commits.
Routes converted: **27** (members 4, integrations 5, trash 4, skills 5, commerce 1, site 1, redirects-create 1, ops 2, fs-files 3 spec-only, not mounted). Mounted in Tovu: 24.

## Gates (final tree)
- Jini: `pnpm --filter @jini-ai/cms build` ok. `pnpm guard` ok (0 violations). `pnpm api:check` ok (40 packages, 804 entries). `pnpm typecheck` ok. cms vitest `src/admin-http src/public-http`: 52 files, 391/391.
- Tovu: `tsc -p tsconfig.json --noEmit` exit 0. Route-table pin diff byte-identical to the base diff (13,662 lines; the base pin is already red for the `/internal/*` drift). Family/route tests (43 files; list in the appendix): 446/453 pass. The 7 failures all reproduce on the unmodified tree, recorded by the trash and redirects agents with identical assertion diffs:
  - `admin-trash-routes.test.ts` "list: …" ×4 (real-server path; redirect rows missing).
  - `redirects-site-serving.test.ts` T041b, the cross-origin characterization, and "ordinary redirects serve content misses" (500 vs 200).
- FILES LEFT (`plans/P9-data/tools/scan.mjs`):
  - before: 8512 files / 3779 non-test / 544,033 non-test LOC / 414 non-test inbound route+http files.
  - after: 8489 / 3757 / 542,758 / 390.

## Cross-cutting blockers (owner decisions; each unlocks several STOPs)
1. **Response headers in JSON specs.** `defineJsonRoute`/`RouteRefusalError` cannot carry headers. The only ServerRoute mount (`mountJiniRoutes`, `app.use`) changes the pin and has no admin ports. This blocks skills/list, consent, public content, members/request-magic-link and publish-trust/challenge+session (Retry-After), fs-files/folder-picker, and agent-plugin-surfaces.
2. **Session-credential-only gate.** api-keys and folder-picker read `res.locals.authCredentialKind`. Suggested seam: a `sessionCredentialOnly: { message, permission }` option on `createAdminJsonRoutePorts`/`mountAdminJsonRoute`. Also needed by system/{site-key,credential-copy,custom-credentials,site-imports,site-share-password,browser-telemetry,mail-providers}, plugins/provider-settings, external-mcp/oauth and agent-plugins/connection-sign-in.
3. **asyncRoute handler name in the pin.** Routes wrapped in `platform/express/async-route.ts` pin `[forwardRejection]`; mounted specs pin `[<anonymous>]`. Approving a fixture update (`fixtures/create-app-route-table.snapshot.json`, 7 snapshots × 3 rows for fs-files) lets `cloud-results/rt-i2-patches/fs-files-tovu.patch` land as-is (it applies cleanly). Expect the same for other asyncRoute families.
4. **Request facts.** publish-trust identity reads `req.get("host")`. analytics writes its own 500 envelope from `res.locals.requestId/adminFailureTracker`.
5. `apps/admin/src/lib/__tests__/panel-access.unit.test.ts` reads route source files by path (SERVER_EVIDENCE). menus/list and redirects/list were already dead on base; members/list and integrations/deliveries are now also gone. This needs one repoint. Not run here: apps/admin deps are not installed.

## Per family detail
## api-keys — STOPPED 0/3
All three routes (issue, revoke, create-principal) run `rejectApiKeyCredential(res)` → `rejectUnlessSessionCredential` reading `res.locals.authCredentialKind` (403 FORBIDDEN credential_kind_not_permitted), pinned by handler-failures.test.ts. No spec input/port exposes the credential kind → host-port change in admin-json-route-ports.ts (STOP rule). Proposed seam: `sessionCredentialOnly: { message, permission }` option on createAdminJsonRoutePorts/mountAdminJsonRoute (authenticate throws the same 403 before parse) — also needed by system/{site-key,credential-copy,custom-credentials,site-imports,site-share-password,browser-telemetry,mail-providers}, plugins/provider-settings, external-mcp/oauth, agent-plugins/connection-sign-in. Notes: all three would mount "direct" with failure.operation "routes/api-keys/deps"; deps.test.ts calls sendApiKeyError directly → needs moved-helper wire tests; http/api-keys.ts held (imports Tovu ApiKeyRecord, needs K4). Tovu baseline 45/45 green, tree untouched.
## Coordinator decisions (non-JSON / header-setting routes STOPPED)
defineJsonRoute has no response headers; the only ServerRoute mount (mountJiniRoutes, app.use) changes the route-table pin and has no admin auth ports → STOP: skills/list (ETag/304/Cache-Control), fs-files/folder-picker (Cache-Control no-store), consent GET (no-store), publish-trust challenge (Retry-After on 429), public content posts/get-by-slug (Cache-Control private,no-store), agent-plugin-surfaces files + export-files (file serving, text/plain 404/429 with headers).
## publish-trust — STOPPED 0/3
identity reads `req.get("host")` (originOf) — request state not in a spec's raw input; challenge + session run `withinRateLimit(req,res)` which sets `Retry-After` on 429 — no response headers in defineJsonRoute. Both need a host/http-kit seam change → STOP.
## analytics — STOPPED 0/1
recent-hits answers unexpected failures with its own nested envelope `{ error: { code, message, details?: { errorId, ... }, requestId? } }` built from `res.locals.adminFailureTracker/principal/requestId` (comment: "Keep ... the canonical analytics wire contract"); the shared admin onError port writes sendAdminFailure's flat body → would need a host-port change (custom onError) → STOP.
## workspace — SKIPPED (already converted/deleted on origin/codex/ex6-sites-tovu: routes/workspace/{create,delete,get,list,update}.ts + http/workspace.ts)
## comments — SKIPPED (already converted/deleted on origin/codex/ex7-coll-small-tovu: routes/comments/{deps,get-settings,moderate,moderation-queue,put-settings}.ts)
## consent — STOPPED 0/5
routes.ts `mount()` sets `res.set('Cache-Control','no-store')` on every consent route (GET/PUT settings, GET readiness, POST dry-run, POST preview) before even the workspace 404; defineJsonRoute cannot set response headers → STOP (needs a headers seam in http-kit/core JsonRouteSpec or a ServerRoute per-path admin mount).
## members — 4/5 (request-magic-link STOPPED: 429 Retry-After header; deps.ts stays for it + mount-members-newsletter). Jini ade18e364, Tovu 71e4529b17. Jini 49/49 (RED: 6 files fail to load); Tovu 119/119 base→119/119; pin identical; tsc ok; M1 list limit>0 dropped (J2/T2 RED), M2 delete conflict rung dropped (J2/T1 RED). direct: list,get; guarded: disable,delete. Departures: structural AdminMemberSource + injected classifyMemberError (members library not in Jini); AdminMemberListResponse gained nextCursor type.
## trash — 4/4. Jini 9a9973a3a, Tovu f1fb154f81. Jini 30/30 (RED 4 files); Tovu 147 pass/4 fail base → same 4 fail (admin-trash-routes "list: ..." ×4, pre-existing, identical diffs); pin identical; tsc ok; M1 items id accepted (J1/T3), M2 restore forbidden check dropped (J1/T3). All "direct". Departures: entry gate injected (`authorizeEntry`) because wire tests pin authorize params w/o entityType; body validation in handle (order pinned: principal/gate before 400); daysRemaining duplicated in Jini http/trash.ts (Tovu trashDaysRemaining still feeds tools — drift risk); list passes `entityTypes: undefined` key via cast (pinned).
## skills — 5/6 (list STOPPED: ETag/304). Jini c4f403ef7, Tovu 37b3d827a4. Jini 52/52 (RED 5 files); Tovu 91/91→91/91; pin identical; tsc 0 errors; M1 install confirm accepted (J5/T6), M2 files shows install record (J1/T2). All "guarded"; files op routes/skills/files, manage ops routes/skills/manage + message. Departures: authorize now carries entityType "skill" (core JsonRouteAuthorize requires one; RBAC decides on permission); body validation in handle (auth-before-validate order kept); posix basename → last-segment slice; String(params.toolId).
## integrations — 5/5. Jini e9fa1fd69, Tovu f2c845a096. Jini 56/56 (RED 6 files); Tovu 119/119→119/119 (one unreproducible file-level flake under parallel load); pin identical; tsc ok; M1 create topics non-array accepted (J2/T2), M2 deliveries clamp dropped (J2/T1). guarded: create,pause; direct: list,delete,deliveries. Departures: webhook lifecycle fns + error matchers injected (cms has no @jini-ai/integrations dep); toAdminDeliveryResponse spells the 13-field projection (undoes Tovu dedupe-03 with @jini-ai/integrations toWebhookDeliveryView); 409 via `new RouteRefusalError` (details type). shared.ts exported.
## follow-up: apps/admin/src/lib/__tests__/panel-access.unit.test.ts reads route source files by path (SERVER_EVIDENCE); menus/list.ts and redirects/list.ts entries already broken on base (pilot/redirects lane), now also members/list.ts and integrations/deliveries.ts. apps/admin deps not installed in this env → not run. Needs one repoint (e.g. resolve the Jini spec module) — not done blind.
## fs-files — Jini spec 3/5 committed (custom-root GET/PUT/DELETE); Tovu mount HELD (patch cloud-results/rt-i2-patches/fs-files-tovu.patch, applies cleanly); folder-picker GET/POST STOPPED (Cache-Control + rejectUnlessSessionCredential). Reason held: pin differs on exactly the 3 custom-root rows, handler name `[forwardRejection]`→`[<anonymous>]` (old routes wrapped in platform/express/async-route.ts asyncRoute; mountAdminJsonRoute handlers are anonymous) → violates "pin diff must equal base"; needs owner OK to update fixtures/create-app-route-table.snapshot.json (7 snapshots × 3 rows). Agent evidence with patch applied: Jini 28/28 (RED 28); Tovu 56/56→56/56; tsc 0; M1 PUT path validation accepted (J6/T5), M2 invalid-root mapping dropped (J1/T2). All "guarded"; ops GET/DELETE "admin-route.uncaught" (they had no try → captureRouteError), PUT "routes/fs-files/custom-root". Departures: entityType "fs-files-custom-root" added to authorize; PUT authorize-throw 500 copy now PUT's op copy; validation in handle (403 before 400).
## ops — 2/3 (/health, /healthz). Jini dacb8fab4, Tovu be913a4374. /readyz STOPPED: features/deployments/deploy-config.ts buildDeploymentDescriptor() regex-reads `app.get("…")` of registerReadyzRoute from health.ts source; deploy-config tests + e2e bug-pin fixture write that exact form → would need feature + test changes (owner: point deploy-config at a constant/spec path). Jini 6/6 (RED 1 file); Tovu 56/56→56/56; pin identical (excl. concurrent fs-files rows, since reverted); tsc 0. M1 n/a (no parse refusal; substitute query leak J2/T0 — handler ignores input), M2 body {} (J2/T1). New visitorError copy "The server couldn’t answer the health check." (unreachable; required by mountPublicJsonRoute). Tovu health.ts not deleted (still holds /readyz).
## commerce — 1/1. Jini 10359dba8, Tovu 75d781a8ca. Jini 7/7 (RED: file fails to load); pin identical; tsc ok. M1 (no parse refusal) authz call removed J3/T2; M2 permission → .read J1/T1. "direct", routes/commerce/status. readCommerceStatus injected (cms has no @jini-ai/commerce dep); vendor-exceptions.json lipay path → modules/commerce.ts (scanner counts unchanged; no-vendor-in-core boundary test already red at base).
## site — 1/1. Jini e750c5581, Tovu d3ee24d9c3. Jini 14/14; pin identical; tsc ok. M1 unknown section accepted J4/T2; M2 pageLimit dropped J1/T2. "direct", routes/site/profile. Query validation in handle (after principal, order kept; vocabulary is a dep). Moved-helper tests: profile-query.test.ts 4 parser unit tests → 1 wire test "query parsing at the wire" (+ Jini profile.test.ts pins parsers).
## redirects-create — 1/1 (redirects 7/7). Jini 0dea5a818, Tovu c903a43942. Jini 12/12; pin identical; tsc ok. M1 matchType refusal skipped J2/T2; M2 override dropped J1/T1. "guarded", op routes/redirects/shared. Deleted Tovu redirects/shared.ts + its __tests__/shared.test.ts (7 tests of the Express respondToRedirectError) — no new wire file; rules pinned by unchanged redirects-create.test.ts + Jini redirects shared.test.ts (template asks for a replacing wire test → flagged). Group Tovu: base 103 pass/3 fail → 93 pass/3 fail (same 3 pre-existing reds in redirects-site-serving.test.ts; −10 = 7 deleted + 4→1). Debt: 2 obsolete ids (respondToRedirectError docs) recorded as obsolete, not moved.

## Appendix: Tovu gate test files
```
apps/website/src/features/theme/__tests__/theme-trash.test.ts
apps/website/src/features/trash/__tests__/member-adapter.test.ts
apps/website/src/server/__tests__/admin-integrations-routes.test.ts
apps/website/src/server/__tests__/admin-trash-items-blocker.test.ts
apps/website/src/server/__tests__/admin-trash-routes.test.ts
apps/website/src/server/__tests__/b07-trash-handler-gaps.test.ts
apps/website/src/server/__tests__/route-async-guards.test.ts
apps/website/src/server/__tests__/routes/commerce-status-adapter.integration.test.ts
apps/website/src/server/__tests__/routes/commerce-status-route.integration.test.ts
apps/website/src/server/__tests__/routes/members-auth.test.ts
apps/website/src/server/__tests__/routes/redirects-auth.test.ts
apps/website/src/server/__tests__/routes/redirects-create.test.ts
apps/website/src/server/__tests__/routes/redirects-site-serving.test.ts
apps/website/src/server/__tests__/routes/site-profile-route.test.ts
apps/website/src/server/__tests__/routes/taxonomy-trash-routes.test.ts
apps/website/src/server/inbound/admin-http/__tests__/admin-json-route-ports.test.ts
apps/website/src/server/inbound/admin-http/http/__tests__/response-projections.test.ts
apps/website/src/server/inbound/admin-http/routes/fs-files/__tests__/custom-root-permission.test.ts
apps/website/src/server/inbound/admin-http/routes/fs-files/__tests__/custom-root.test.ts
apps/website/src/server/inbound/admin-http/routes/fs-files/__tests__/folder-picker.test.ts
apps/website/src/server/inbound/admin-http/routes/fs-files/__tests__/fs-files-route-failures.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/integrations/__tests__/create.test.ts
apps/website/src/server/inbound/admin-http/routes/integrations/__tests__/integration/create-delete-pause.integration.test.ts
apps/website/src/server/inbound/admin-http/routes/integrations/__tests__/integrations-route-failures.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/integrations/__tests__/unit/h4-list.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/members/__tests__/disable.test.ts
apps/website/src/server/inbound/admin-http/routes/members/__tests__/disable.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/members/__tests__/members-route-failures.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/members/__tests__/unit/h4-magic-link.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/redirects/__tests__/authorize-entity-id.test.ts
apps/website/src/server/inbound/admin-http/routes/redirects/__tests__/hits.test.ts
apps/website/src/server/inbound/admin-http/routes/redirects/__tests__/list.test.ts
apps/website/src/server/inbound/admin-http/routes/site/__tests__/profile-query.test.ts
apps/website/src/server/inbound/admin-http/routes/skills/__tests__/integration/skills-http.integration.test.ts
apps/website/src/server/inbound/admin-http/routes/skills/__tests__/integration/skills-install-http.integration.test.ts
apps/website/src/server/inbound/admin-http/routes/skills/__tests__/unit/files.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/skills/__tests__/unit/list-cache.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/skills/__tests__/unit/manage.unit.test.ts
apps/website/src/server/inbound/admin-http/routes/trash/__tests__/l255-characterization.test.ts
apps/website/src/server/inbound/admin-http/routes/trash/__tests__/page-display-kind.integration.test.ts
apps/website/src/server/inbound/admin-http/routes/trash/__tests__/request-contracts.test.ts
apps/website/src/server/runtime/composition/__tests__/account-purge-protections.test.ts
apps/website/src/server/runtime/composition/__tests__/booted-request-layouts.integration.test.ts
```
