PARTIAL 5c9fa3d5ca 285c61a4d: admin external-mcp (7/14 routes left: STOP — host-port work) and admin agent-plugins (7/11 routes left: STOP — host-port work / non-JSON); public oauth, api-connections and public external-mcp done

# RT-K1 lane L4 (oauth): 2026-11-23, unattended

Tovu `codex/rt-l4-oauth-tovu` @ `5c9fa3d5ca` (last work commit before this report) · Jini `codex/rt-l4-oauth-jini` @ `285c61a4d`.
All five families were taken in the dispatched order: public oauth → api-connections, public external-mcp → admin external-mcp → agent-plugins.
- **Routes converted: 15 of 31 registrations.** The 16 not converted all hit a STOP rule (listed per family below).
- **Non-test route files under `inbound/**/routes` (Tovu, `plans/P9-data/tools/scan.mjs`): 359 → 347.** For the five L4 families: 22 → 10.

- **Bootstrap:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work and followed its tests-first slice loop, the architecture audit and the pre-completion checklist. Per the `<<SUBAGENT_DISPATCH>>` marker, I did not load the AGENTS.md bootstraps. I used no codebase-memory tools.
- **Coordinator setup:** I wrote the three public families myself (the first family of a new, non-JSON `ServerRoute` shape). Two Opus subagents converted admin external-mcp and agent-plugins. Each worked on disjoint files and never committed; I reviewed each diff against template §7 and committed per family.
- **Base moved mid-run:** after I branched, the pilot base gained the rv1123e fix round (template corrections, Tovu `069155845`…`c20f88365`, Jini `3638b1fd`…`c73309b4`). I merged it into both branches (union conflicts only) and applied the template's "Migration for families converted before 582db5967" checklist to every family (see the last section).
- **Overlap check:** no other branch had already converted or deleted these families. I checked `ex6-*`, `ex7-*` and `rt-*`; only `ex7-addons-integ-tovu` touched five L4 files, and only as import repoints. Nothing was skipped for overlap.

## Per family

| family | converted / total | Tovu files deleted | shape |
|---|---|---|---|
| public oauth (`callback-page.ts`) | n/a (0 registrations) | 0 — STAYS as Tovu product copy (K3) | closed failure vocabulary, renderer port and no-store HTML response → `@jini-ai/core/contracts/site/oauth-callback-page` |
| public api-connections | 1 / 1 | `oauth-callback.ts` | `ServerRoute` factory `apiConnectionOAuthCallbackRoute` |
| public external-mcp | 1 / 1 | `oauth-callback.ts`, `oauth-callback-url.ts` | `ServerRoute` factory `externalMcpOAuthCallbackRoute` + `externalMcpOAuthCallbackUrl({ origin, serverId })` |
| admin external-mcp | 7 / 14 | `list`, `put`, `delete`, `admissions`, `tool-approvals` | `defineJsonRoute` specs, all `"direct"` |
| admin agent-plugins | 4 / 11 | `list`, `files`, `set-enabled`, `connection-sign-in` | 3 `defineJsonRoute` specs (`"guarded"`) + 1 `ServerRoute` (`apiConnectionSignInRoute`) |

### What each family did
- **Public callbacks (HTML, so not JSON):**
  - Jini returns web `Request` → `Response` routes.
  - Tovu `runtime/composition/public-oauth-callbacks.ts` keeps the registrar names and deps types. It binds Tovu's copy and message types, callback path, binding-cookie rules, the error-class predicates (`ApiConnectionError` / `OAuthError` / `ExternalMcpValidationError`), `notifyExternalMcpRosterChanged`, the `TOVU_PUBLIC_URL` origin policy (new `resolvePublicOriginFor`) and the logger.
  - A new `mountJiniRouteInPlace` (`jini-routes.ts`) registers each route as an Express `route get` row: same path, the same handler name (`forwardRejection`, or `<anonymous>` via an option), Express's params, request facts in `locals`, the answer through http-kit's `sendWebResponse`, and throws to `next(error)`. This keeps the route-table pin byte-identical, and `extractRouteHandler`-based tests still work (the `?? ""` param fallback test mounts the handler at another path).
- **Admin external-mcp:**
  - Converted: list, put, delete, admissions, tool-approvals GET/DELETE, oauth disconnect. Each spec has its own deps type.
  - The host injects its store functions, roster fan-out, built-in ownership rules and error classes (as `ExternalMcpErrorPredicate`s).
  - The wire DTOs are in `@jini-ai/core/contracts/site/cms-external-mcp`, with a `Same<>` parity test.
  - `guard.ts` mapped exactly onto the ports (workspace 404 → authorize `admin.integrations.manage` on `integration`, no `entityId`, direct).
- **Admin agent-plugins:**
  - Converted: list, files, set-enabled (8-rung error table; injected class predicates and activation copy). `agentPluginLifecycleFields` moved to `@jini-ai/cms/admin-http/http/agent-plugins`, and the DTOs are in `@jini-ai/core/contracts/site/cms-agent-plugins` (parity test).
  - The hosted sign-in hop (302 + binding cookie) is now a `ServerRoute`. It is bound in `modules/agent-plugins-routes.ts` to dev-auth's credential and principal readers, which still throw without the session gate, as before.

### Skipped (STOP) and why
- **external-mcp `probe` POST and `oauth/device/poll` POST:** the rate limiter is keyed on `resolveClientIp(req)` and sets the `Retry-After` header. A JSON spec reaches neither, so converting them needs a host-port change.
- **external-mcp `oauth/connect` POST:** it reads the Express `req` for the public origin, and also has the IP limiter.
- **external-mcp browser sign-in GET:** a 302 + Set-Cookie, plus the IP limiter, the session-credential guard and the error ladder. It would need admin ports for `ServerRoute`s.
- **external-mcp shared GET/DELETE/POST:** they use `rejectUnlessSessionCredential(res)`, a credential-kind gate with no port, plus the IP limiter. `guard.ts`/`deps.ts` stay for these routes.
- **agent-plugins `memory` GET/PUT:** PUT answers a 500 with its own operation and copy (`agent-plugins:write-note`) for Node system errors; a mount carries one `failure`. GET shares the handler.
- **agent-plugins `admin-surfaces` ×3:** they use `rejectUnlessSessionCredential` and `isSameOriginBrowserWrite` (credential kind + origin).
- **agent-plugins `install` ×2:** raw zip upload (`express.raw`); `install-response.ts` stays with it.

## Tests
- **Jini specs (tests first for the public families and external-mcp: committed RED in `4b0bc3d1e` and `d1869f284`):**
  - public api-connections 20, public external-mcp 17, core `oauth-callback-page` 3.
  - external-mcp 42 (7 files, including DTO parity).
  - agent-plugins 46 (7 files, including connection-sign-in 7 and DTO parity 3).
  - **Honesty note:** the agent-plugins JSON specs were written alongside their tests, not RED-first. The mutations below cover that.
- **Final Jini gates:** cms `src/admin-http` + `src/public-http`: 260 / 260 (41 files). Core `src/contracts/site`: 17 / 17.
- **Tovu wire tests: only import lines changed, plus added pins.**
  - Added: the set-enabled deferral pins (malformed body with no session ⇒ the old 400; valid body with no session ⇒ 500, no side effect), and the external-mcp no-session answer + no-side-effect pin.
  - Moved helper replaced by a wire test: none needed.
  - **Final L4 set (35 files, including `admin-json-route-ports` and `admin-menus-routes`): 451 / 459.** The 8 failures are exactly the base's: 7 route-table pin variants plus `vendor-neutrality: no generic seam file names the first provider`, with the same offending lines as at base.
  - Baseline on the unmodified tree: 404 / 412, the same 8 failures.
- **Route-table pin:** red at base and on the branch, and **identical**: 5,703 diff lines at base, at each family commit, and on the final head.
- **Desktop `window-navigation-policy.test.ts`:** 31 / 31, unchanged. Keeping the Tovu copy file at its old path left `apps/desktop` untouched (see the open items).
- **Named mutations** (Jini source mutated, cms rebuilt, both sides run, restored by byte copy, `cmp` clean, rebuilt). Every mutation went RED on both sides:

| # | mutation | Jini RED | Tovu RED |
|---|---|---|---|
| M1 | api-connections callback: the `no_state` refusal is skipped | 4 | 2 (`state: a missing, empty or oversized state…`, `…repeated state parameter…`) |
| M2 | external-mcp callback: the `browser_mismatch` check is skipped | 1 | 1 (`missing, malformed and duplicate browser proof stops before the OAuth service`) |
| M3 | admin external-mcp delete: the built-in refusal is dropped | 1 | 2 (`host-declared built-in MCP connections… cannot be removed`, `runtime provenance… refuses removal`) |
| M4 | sign-in hop: the workspace check is dropped | 1 | 1 (`F1: authenticated hosted start binds only its actor's browser…`) |
| M5 | agent-plugins set-enabled `parse` accepts a non-boolean (subagent) | 4 | 1 (`a non-boolean enabled is 400 VALIDATION_ERROR`) |
| M6 | agent-plugins: the installed-id 404 is dropped (subagent) | 1 | 1 |
| M7 | set-enabled: `deferMissingPrincipal` is removed from its mount (subagent) | — | 1 (deferral pin) |

## Gates (final, fresh)

| gate | result |
|---|---|
| Jini `pnpm -r build` | 0 |
| Jini `pnpm guard` | 0 (zero violations). An `SI-domain` violation (an admin-http route reaching public-http) was fixed by moving the callback-page contract to Core. |
| Jini `pnpm api:check` | 0 (40 packages, 793 entries, 17,617 symbols). Core + cms baselines regenerated with `pnpm api:update`. |
| Jini `pnpm typecheck` | 0 |
| Tovu `npm run typecheck` (including e2e) | 0 |
| Tovu `check:complexity` | ok (0 entries) |
| Tovu `check:why-comments --base 582db5967 --other-root Jini` | 27 lost blocks, 27 allow-listed. All of them moved to Jini with the code, reworded only to drop Tovu names or to describe the injected dep; I spot-checked that 38/40 and 8/9 phrases are verbatim in Jini. |

## Shared files (union-merged, never overwritten)
- **Jini `packages/cms/package.json`:** added through a locked union helper.
  - New entries: `./public-http/routes/{api-connections/oauth-callback, external-mcp/oauth-callback, external-mcp/oauth-callback-url}`, `./admin-http/routes/external-mcp/{list,put,delete,admissions,tool-approvals,oauth-disconnect}`, `./admin-http/routes/agent-plugins/{list,files,set-enabled,connection-sign-in}`, `./admin-http/http/agent-plugins`.
  - All universal. No isolation domain fits, so none was added, as for sites/system.
- **Jini `packages/core/package.json`:** `./contracts/site/{oauth-callback-page,cms-external-mcp,cms-agent-plugins}`.
- **API baselines:** `api-baseline/jini-ai__cms.json` and `jini-ai__core.json`, regenerated.
- **Changesets (one per family, plus the migration):**
  - `cms-public-oauth-callback-routes.md` (cms + core)
  - `cms-external-mcp-route-specs.md`
  - `cms-agent-plugins-route-specs.md`
  - `core-cms-l4-wire-dtos.md`
- **Tovu:**
  - `development/why-comments-debt.json`: an id union, also merged with the pilot fix round's entries.
  - `apps/website/src/server/INFO.md` `## Wiring`: the pilot's corrected text plus the L4 paragraphs.
- **`## Wiring` in Jini:** `packages/cms/README.md`.

## Architecture audit: WARNING (recorded, not hidden)
1. **agent-plugins id-free checks send `entityType: ""`.** The hand-written list/files `authorizeOrRespond` calls sent no `entityType` key, but core's `JsonRouteAuthorize` requires a string and the Tovu port always spreads it.
   - RBAC `matchesRow` treats `""` like the absent key in every case but one: a policy row whose `resourceType` is exactly `""`. Such a row is writable through `write-policy-permission.ts:64`, and it would now match list/files reads (previously refused).
   - Smallest faithful fix (owner call; it is a core contract + host port change, so STOP for this lane): make `entityType` optional in `JsonRouteAuthorize` and have the Tovu port omit the key when it is absent.
2. **Express-only response headers are gone** on the `ServerRoute`-mounted callbacks and the sign-in hop. Express's `res.send` added a weak `ETag`, and `res.redirect` content-negotiated an HTML body for `Accept: text/html`. The routes now send the same status, headers, cookies and `Location`, a stated `Content-Length`, and the plain-text redirect body. No test pinned either. This comes from the template's prescribed non-JSON path, not a choice per route.
3. **external-mcp PUT parses its body in `handle`, after `authorize`, not in `parse`.** That matches the old guard-first order (an unauthorized caller with a malformed body still gets 403). It also means no external-mcp mount needs `deferMissingPrincipal`.
4. **The OAuth error ladder now exists twice:** the Jini disconnect spec, and Tovu `oauth.ts`'s `sendExternalMcpOAuthError` for the skipped routes. They are identical today and must be kept in sync until those routes move.

**PASS items:**
- Specs import only `@jini-ai/core` and cms-internal modules. There is no new package dependency for cms (agent-plugins → cms would cycle). Every cross-package class check is an injected predicate.
- Every deps field is required. Function sizes and complexity are within limits. Object arguments are used throughout (rv1123e).
- There are no re-export shells. `RouteDeps` is read only in the registrars. Registrar names and registration order are unchanged.

## rv1123e migration (applied to every L4 family)
- **`deferMissingPrincipal`:** only agent-plugins set-enabled opts in (its old route refused a non-boolean `enabled` before reading the session), with both pins added. external-mcp's guard read the session first, so none of its mounts opt in. list/files keep the default.
- **Authorization:** one spec `authorize` call per hand-written check, with the same permission, entityType, `entityId` presence and mode. No route mixed modes, so no `authorizationByPermission` was needed.
- **Object arguments:** applied to every helper, mapping rung, param reader and host `mountOptions({ operation, authorization }, { … })`.
- **Wire DTOs** moved to `@jini-ai/core/contracts/site/cms-{external-mcp,agent-plugins}` with `Same<>` parity tests and no re-export.
  - Admin client: `AdminExternalMcpToolApproval = ExternalMcpToolApprovalDto` (type-only).
  - The agent-plugin client types are deliberately narrower (host value unions), so they were left as they are.
- **Error ladders:** every status/code pair re-checked against the old bodies; all unchanged.

## Open items
- **The Tovu desktop pre-push gates fail at base in cloud containers.** Electron is not installed, so typecheck/tests/coverage fail, and three complexity violations (`SiteGrid`, `SiteStartPanel`, `TabStrip`) are pre-existing.
  - Any pushed commit that touches `apps/desktop` is blocked, and `--no-verify` is banned. That is why the Tovu callback copy stayed at `routes/oauth/callback-page.ts` instead of moving into composition (the desktop test imports it by path).
  - A later lane can move it once those gates are fixed.
- The 16 STOP routes need two host-port additions before they can move:
  - an admin `ServerRoute` mount carrying the admin ports, plus a client-IP / `Retry-After` limiter port;
  - a credential-kind port.
- The owner needs to decide on WARNING 1 (`entityType: ""`).

## Pushed commits
**Jini `codex/rt-l4-oauth-jini`** (remote = local = `285c61a4d`):
`4b0bc3d1e` tests RED · `5784577f1` public callbacks · `771f45c41` docs/changeset · `d1869f284` ext-mcp tests RED · `b0a368f54` ext-mcp specs ·
`4e214adcb` agent-plugins tests · `9ff5af44e` agent-plugins specs · `7140421c6` docs/changesets · `4fd3ca901` baseline · `5a55f9be2` sign-in ServerRoute ·
`ead856067` baseline · `8ca799180` merge pilot fix round · `9036dafff` object args · `fe7aee56f` callback contract → Core + agent-plugins migration ·
`bc84aa2bd` ext-mcp migration · `285c61a4d` baselines + changeset.

**Tovu `codex/rt-l4-oauth-tovu`** (remote = local = `5c9fa3d5ca` before this report):
`f653c98601` public callbacks · `f5438792a5` ext-mcp mounts · `7799b80edd` agent-plugins mounts · `eb9deee8ee` Wiring · `0966bcb20e` why-comments ·
`f00c4e9012` sign-in mount · `ea2439e4b2` merge pilot fix round · `da0c048c74` agent-plugins migration · `a5b705122e` ext-mcp migration · `5c9fa3d5ca` why-comments.
