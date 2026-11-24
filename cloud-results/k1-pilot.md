DONE c3b91bb66 180b27ff   (tovu codex/k1-pilot-tovu @ last work commit before this report; jini codex/k1-pilot-jini @ head)

# K1 route template — Menus pilot (2026-11-23, unattended)

- **Routes converted: 6 / 6 Menus admin routes** (get-by-id first, then list, create, update-tree,
  assign-location, delete) from `RouteDeps` Express registrars to Jini `defineJsonRoute` specs with one
  small deps type per route, mounted by Tovu through `mountAdminJsonRoute` → `mountJsonRoute` with injected deps.
- **Template:** `plans/K1-route-template.md` on `codex/k1-pilot-tovu`.
- Bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work; followed its
  tests-first slice loop, architecture audit and pre-completion checklist. No codebase-memory tools used
  (owner rule); `rg`/git only. No subagents used.

## Branches and base (PROVISIONAL, as dispatched)

| repo | branch | base | merged in |
|---|---|---|---|
| Jini | `codex/k1-pilot-jini` | `origin/integ/merge-14-2026-11-22` | `codex/ex5-fnd-routes-jini` (clean), `codex/fix-mountjson-maxbody` (conflict `http-kit/src/adapter.ts`: kept scoped `routeAuthorize` **and** `allowRouteBody`; import union), `codex/ex5-fnd-inject-jini` (conflict `cms/package.json` + `api-baseline/jini-ai__cms.json`: 3-way JSON union) |
| Tovu | `codex/k1-pilot-tovu` | `origin/integ/merge-13-2026-11-22` | `codex/ex2-tovu-halves` (clean; has RT-K1-0 adapter), `codex/ex5-fnd-routes-tovu` (conflict `why-comments-debt.json`: id union), `codex/ex5-fnd-inject-tovu` (62 conflicts: 20 modify/delete of tool-metadata files moved to `@jini-ai/core/tool-metadata/*` → took the deletion; 35 quote-style-only → kept integ-13 style; `i18n-common.ts` → kept the reviewed ex2 composition; `tool-approval-policy.ts` → daemon surface types from core per inject; `index.ts`/headless → kept HEAD's single `HostToolApprovalPolicy`; debt json → id union) |

Base fixes carried (not K1 scope, but needed for green gates): untracked root `chat.db` (rv1123a ex5-fnd-routes FIX 1),
removed a duplicate `route-refusal` import in `routes/settings/shared.ts` that two lanes both added (Tovu typecheck was red on it).
Link: `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` (0); `packages/sdk` built (needed by tests).

## What changed

### Jini (`@jini-ai/cms`, `@jini-ai/http-kit`)
- `packages/cms/src/admin-http/http/menus.ts` — DTOs + serializers moved verbatim (host deps/registrar types dropped).
- `packages/cms/src/admin-http/routes/menus/{get-by-id,list,create,update-tree,assign-location,delete}.ts` — specs.
  Deps types: `MenuGetRouteDeps {workspaceId, menuRepo: Pick<findBySlug|findById>}`, `MenuListRouteDeps {workspaceId, menuRepo: Pick<list>}`,
  `MenuCreateRouteDeps`/`MenuUpdateTreeRouteDeps` (service collaborators Pick'd + required `rawHtmlPermission` + `normalizeMenuHtml`),
  `MenuAssignLocationRouteDeps` (+ `navLocationBindingRepo`), `MenuDeleteRouteDeps {workspaceId, trashMenu: MenuTrashFn}`.
- `routes/menus/shared.ts` — `authorizeMenus`/`authorizeMenuHtml` (by-id routes pass `{ entityId }`), per-route ordered error
  mapping tables (`rejectMenuError`; subclass `MenuVersionConflictError` before `MenuConflictError`), `menuActorId`, `menuIdParam`.
- 7 export entries (+ `jini.entries` universal, isolation domain `navigation`), changeset `cms-menus-route-specs.md` (patch).
- `@jini-ai/http-kit`: `JsonRoutePorts.authenticate` may return `undefined` (type-only widening; adapter already passed
  `Context | undefined`). Test first in `adapter-ports.test.ts`; changeset `http-kit-authenticate-deferred.md` (patch).
- API baselines refreshed (cms menus entries; core `payloadTooLargeError` + http-kit hashes = base-merge drift from fix-mountjson-maxbody).
- `## Wiring`: `packages/cms/README.md`, `packages/http-kit/README.md`.

### Tovu
- Deleted: `inbound/admin-http/http/menus.ts` and the 6 `inbound/admin-http/routes/menus/*.ts` sources.
- `runtime/composition/modules/menus.ts` — keeps every `registerAdminMenu…Route` name and the registration order; builds each
  route's small deps from `RouteDeps` at registration; injects `MENU_RAW_HTML_PERMISSION`, Node `normalizeMenuHtml`
  (`@jini-ai/cms/navigation/node`) and the host `trashMenu`; `failure.operation` copied per route; get/list/update-tree/assign
  mount `"direct"`, create/delete `"guarded"` (as the hand-written routes did). `MenuRouteDeps`/`MenuRouteRegistrar` now live here.
- `inbound/admin-http/admin-json-route-ports.ts` — `authenticate` answers `undefined` without a session; `authorize` fails closed
  with `getAuthedPrincipal`'s message (same redacted 500). Needed for wire parity (below).
- Tests: import lines only, except `menus-dto.unit.test.ts`, whose `authorizeMenuHtmlOrRespond` unit test (helper deleted) is
  replaced by a wire test of the same rule (raw-HTML permission carries `entityId` on update, none on create).
- `development/why-comments-debt.json`: 20 entries for comment blocks that moved with the code into the Jini specs.
- `## Wiring`: `apps/website/src/server/INFO.md`. Template: `plans/K1-route-template.md`.

## Gates (fresh evidence)

| gate | result |
|---|---|
| Jini `pnpm -r build` (full, then cms + http-kit) | 0 |
| Jini `pnpm guard` | 0 (`zero violations found in packages/`) |
| Jini `pnpm api:check` | 0 (40 packages, 775 entries, 17537 symbols) |
| Jini `pnpm typecheck` | 0 |
| Jini changed vitest: `packages/cms` `src/admin-http` | 135 / 135 (menus specs: 46 / 46, 6 files) |
| Jini changed vitest: `packages/http-kit` (all) | 762 / 762 |
| Tovu `npm run typecheck` (incl. `typecheck:e2e`) | 0 (after the duplicate-import base fix) |
| Tovu menus wire tests + DTO + footer-page-links + roundtrip + `redirects-auth` + `admin-json-route-ports` | **119 / 119** |
| Tovu route-table pin | **red at base and on the branch, identical** (5,696 diff lines, `/internal/*` rows from the base merges; no menus row changes; handlers stay `<anonymous>`) |
| Tovu other families on the shared admin port (21 recovery/redirects/database/system test files) | 186 / 199, the **same 13 failures at base** (public-site redirect serving 404↔500, `composeSiteRouteDeps` B12/B13) — pre-existing |
| Tovu `check:why-comments --base 1885dad57` | ok (20 allow-listed, all moved-to-Jini) |
| Tovu `check:complexity` | ok (0 entries) |
| Tovu `check:size` | 7 worsened violations, **none in touched files** (posts editor hook, desktop SiteGrid, publish-agent-tools — base merges) |
| Tovu `check:boundaries` | 0 errors (113 warnings, unchanged class) |

Wire-parity finding fixed during the run: two existing Tovu wire tests went 400→500 after the mount
(`assign-location returns 400 for an absent body when mounted without a body parser`; update-tree direct call with no body)
because `mountJsonRoute` authenticates before `parse`, while the hand-written routes validated the body first. Fixed in the
port seam (http-kit type + Tovu port), not in the tests.

## Named mutations (RT-K1-adm-menus sheets)

Mutated Jini spec source, rebuilt `@jini-ai/cms` (Tovu imports the linked `dist/`), ran both sides, restored by byte copy, `cmp` clean, rebuilt, 46/46 green.
- **M1** `create.ts` parse accepts non-array `items` → Jini RED 3 (`refuses a non-array items {} / null / "bad"`), Tovu RED 3
  (`menu create: rejects malformed items … before repository writes`).
- **M2** `get-by-id.ts` drops `.trim().toLowerCase()` on the slug lookup → Jini RED 1, Tovu RED 1
  (`menu get: lookup failure is private, missing slug falls back to the unnormalized id`).
(The sheet's literal "parse accepts a missing required field" has no target in get-by-id — its only input falls back to `""` by
design — so M1 applies it to the first route that has a required body field, and M2 covers get-by-id's own rule.)

## Architecture audit — WARNING (one recorded deviation)

- PASS: specs import only `@jini-ai/core` contracts/errors and cms-internal modules; no Tovu/express/node imports in the
  universal entries (guard 0); every host policy/collaborator injected as a required dep; `RouteDeps` read only in the registrar;
  fn ≤ 80 lines, complexity check 0; `_optional` pads; no re-export shells; why-comments on non-obvious branches.
- **WARNING (behaviour, edge only):** update-tree's raw-HTML check was `authorizeOrRespond` ("guarded": a publishing credential
  answers from its grant) while its menu-permission check was `"direct"`. One mount mode now covers both, so the HTML check is
  RBAC-only for update-tree. Differs only for a publishing credential whose RBAC allows `admin.menus.update` but whose grant
  differs on `pages.edit_html`. No test pinned it. Smallest fix if the owner wants the old split: an optional `mode` field on
  `JsonRouteAuthorizeScope` (core) honoured by the Tovu authorize port. Not done: that is a cross-family contract change.
- Departure from the sheets: Tovu test imports repoint to `modules/menus` (registrars stay host composition), not to the Jini spec
  paths the sheet lists; same choice as the redirects lane. Recorded in the template.

## Pushed commits

Jini `codex/k1-pilot-jini` (remote = local = `180b27ff`):
`b11acc17` merge fix-mountjson-maxbody · `3fb4a880` merge ex5-fnd-inject-jini · `8f0adb43` tests first (RED) · `9c3d8a1c` menus specs ·
`f1543145` exports + baselines · `24055675` http-kit authenticate widening · `45e0bf3c` http-kit baseline · `180b27ff` Wiring docs.

Tovu `codex/k1-pilot-tovu` (remote = local = `c3b91bb66` before this report commit):
`c2ace60a8` merge ex5-fnd-routes-tovu · `1885dad57` merge ex5-fnd-inject-tovu · `2239c8585` untrack chat.db · `a2128f1fb` menus mount ·
`e5e152ef2` admin port defers missing principal · `d8e93fa56` settings duplicate import · `247dcbb20` Wiring · `0b6d172c7` template ·
`c3b91bb66` why-comments debt · (this report).

## Open items
- Route-table pin and the 13 public-site/compose tests are red on the provisional base (not K1); the integrator should regenerate
  or fix them on the real merge base.
- `redirects/create` is still hand-written (from the ex5 lane) — first easy target for the template.
- The update-tree HTML-check authorization mode (WARNING above) needs an owner call.
