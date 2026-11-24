PARTIAL 531fc8a68 9a3f13e8: posts create/update/delete + pages create/update/delete (Idempotency-Key seam), presentation PATCH (500-copy seam), posts template-preview + themes preview (non-JSON)

# rt-l1-content — K1 route template, lane L1 (content)

Branches: Tovu `codex/rt-l1-content-tovu` (base `origin/codex/k1-pilot-tovu`), Jini `codex/rt-l1-content-jini`
(base `origin/codex/k1-pilot-jini`). SHAs above are the last work commits; this report is the next commit on
each branch. Run 2026-11-23, unattended, coordinator + 6 subagents (≤ 4 concurrent).
Confirmed read: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work.

**29 routes converted** to Jini `defineJsonRoute` specs; 10 left hand-written (all listed with a STOP reason).
Files left (lane dirs + http helpers, `scan.mjs`-based): **39 → 26**; 9 of the 26 are already converted on
`ex7-*` heads (content-types 5, entries 4… see Skipped), so **17 after those merge**.

## Skipped (already converted on other heads — not touched)
| family | where | files |
|---|---|---|
| content-types | `origin/codex/ex7-coll-small-{tovu,jini}` | all 5 route files deleted there, specs in Jini `routes/content-types/*` |
| entries | `origin/codex/ex7-coll-small-{tovu,jini}` | all 4 route files deleted there |
| posts get-by-id + list | `origin/codex/ex7-media-posts-{tovu,jini}` | 2 files; this lane avoided its file names (`posts/shared.ts`, `__tests__/helpers.ts`) |
`ex6-*` heads only touch an import line in `pages/get-by-id.ts` (not a conversion) — pages was not skipped.

## Per family
| family | routes converted / total | Tovu files deleted | Jini tests | Tovu wire tests | notes |
|---|---|---|---|---|---|
| plugin-hook-error (helper) | n/a | 0 (binding stays, K3) | 7 | 8/8 | envelope → Jini `admin-http/http/plugin-hook-error` (`createPluginHookErrorEnvelope`); Tovu file is now a 30-line binding of class + `pluginHookRefusalText` + `redactSecretShapes` (callers pass no args object → K3 STAYS rule) |
| content (`routes/content/deps.ts`) | n/a | 1 | — | importers repointed (53) | `ContentRouteDeps`/`ContentRouteRegistrar` moved to Tovu `modules/content.ts` (host bag stays host-side, as menus). Departure from the sheet (it moved deps.ts to Jini) |
| change-sets | 3/3 | 3 (`list,get,revert`) | 21 | 215/215 with email-templates set | all `"direct"`; get/revert pass `{ entityId }`; revert uses cms's own `revertChangeSet`; `http/change-sets.ts` stays (shares `toChangeSetView` with the agent tool), injected as mappers |
| email-templates | 7/7 | 1 (`routes.ts`) | 53 | (above) | all `"guarded"`; capped writes keep Tovu's own `rejectOversizedJsonBody` in the same registration (`modules/capped-route-app.ts`) because the kit's 413 envelope differs (template §4.4) |
| posts (write) | 3/8 (autosave PUT/GET/DELETE) | 1 (`autosave.ts`) | 15 | no new red | create/update/delete: STOP (Idempotency-Key); template-preview (2 regs): non-JSON |
| pages | 3/6 (list, get-by-id, update-html) | 3 | 26 | no new red | create/update/delete: STOP (Idempotency-Key; create/update also cap) |
| presentation | 2/3 (get, rescan-themes) | 2 | 24 | no new red | PATCH: STOP (500 copy) |
| themes | 11/12 (list, duplicate, 9 Explore) | 2 (`list,duplicate`); `explore.ts` 1244 → 571 lines (host helpers only) | 13 + 46 | no new red | `themes/preview.ts`: non-JSON (302) |

Mount modes are per route, copied from the hand-written helper (`authorizeOrRespond` → `"guarded"`,
`authorizeDirectOrRespond`/`authorizeThemeSetPermission` → `"direct"`); no family mixes modes inside a route.
Every `failure.operation` string is the hand-written `sendAdminFailure` operation, verbatim (plus its `message`
where it had one).

## STOP list (left hand-written, with reason)
1. **posts create/update/delete, pages create/update/delete — `Idempotency-Key` header.** These read
   `req.get("Idempotency-Key")` (tests pin replay → 409 `DUPLICATE_COMMAND`). Core `RouteInputContext` /
   http-kit `rawInput` carry only body/query/params, so a spec cannot see it. Needs a shared seam
   (e.g. optional `headers` on `RouteInputContext`, filled by `rawInput`) — an engine contract change, raised, not made.
2. **presentation PATCH — 500 copy.** It answers through `adminFailureResponse` with only its operation
   ("The presentation setting operation could not be completed." + details policy); the mount's
   `sendAdminFailure` derives action/step from method + route, so the body would change.
3. **posts template-preview (2 regs) and themes preview** — non-JSON (HTML + urlencoded body; 302 redirect):
   `ServerRoute` variant, out of this template.

## Behaviour notes (no wire change intended; record)
- **entityType:** where the hand-written route passed NO `entityType` to `deps.authorize` (pages list/get/
  update-html, posts autosave, email-templates), the registrar's port binding drops the spec's type
  (`({ entityType: _e, ...p }) => deps.authorize(p)`, the ex7 precedent) so a resource-scoped grant cannot
  start matching. Routes that named one (change-sets, presentation, themes) forward the same type.
- **Body caps:** no spec declares `maxBodyBytes`. Capped routes (email-template writes, pages update-html,
  autosave PUT) keep Tovu's cap middleware in the same registration via `cappedApp`; verified 413 body
  `{"error":"Content too large to save.","code":"PAYLOAD_TOO_LARGE"}` unchanged. This is the template §4.4
  "keep the host's binding" path — raised here as the seam to settle (kit 413 copy vs host copy).
- **Missing session** now fails closed through the `authorize` port with the route's own redacted 500
  (template §6.2) on routes that used `asyncRoute`/Express error handling (autosave) — unreachable behind `requireAdminSession`.
- **update-html:** the hand-written ladder checked `ToolInputError` first, so its `PluginEmbedValidationError`/
  `EntityNotLiveError` branches were dead (always 400 VALIDATION_ERROR; the "trashed page → 409" test is red at
  base). The spec keeps the 400 and drops the dead branches with a comment; reordering would be a wire change.

## Tests
- **Jini:** cms `src/admin-http` 340/340 (47 files). Full cms vitest 5408/5423: the 15 reds are environmental and
  in untouched files — 7× 5 s timeouts under load (pglite repo dialects, `universal-entries.boundary` which passes
  alone in 4.5 s) and 7× Node 22 `RegExp.escape is not a function` (`widgets/markers/expand-partials`). http-kit 762/762.
- **Tovu lane suite** (175 files touching the lane): base 2009 tests / 125 fail → branch 2067 / 124 fail;
  **0 new reds**. The 6 names that looked new (themes-activation + slug-change real-composition) failed at file
  level in my contaminated baseline; re-run on a pristine base worktree they fail identically (Node 22
  `RegExp.escape` in public render). 7 base reds fixed (file-level loads).
- **Typecheck:** Tovu `tsc -p tsconfig.json` EXIT 0 (base EXIT 0).
- **Mutations (M1/M2, restored by cp + cmp):** pages get-by-id M1 J1/T1, M2 J1/T2; posts autosave M1 J1/T4, M2 J1/T2;
  change-sets M2 J1/T2 (M1 J1/T0: no wire test sends a truthy non-`true` `force` — gap); email-templates M1 J1/T1,
  M2 J7/T2; presentation M1 J3/T1, themes list M2 J1/T2; explore page-publish M1 J1/T1, file-put M2 J1/T2;
  update-html + autosave PUT M1 J2/T2, M2 J3/T4 (+ expectedVersion J1/T1).
  ⚠ Jini wip snapshot `ed215b9a` was taken while M1 was applied (two `false &&` guards); fixed in `492155be`.

## Route-table pin (`create-app-route-table.pin.test.ts`)
Red at base (7/10, `/internal/*` drift). Branch: same 3 pass / 7 fail. The failure diff equals base **except 3 rows**:
`PUT/GET/DELETE …/posts/:postId/autosave` handler label `forwardRejection` → `<anonymous>` (the `asyncRoute`
wrapper is gone; method, path, order and handler count unchanged). **Gate deviation, label only** — not faked.

## Gates
Jini: `pnpm -r build` ok, `pnpm guard` EXIT 0 (zero violations), `pnpm api:update` (+260 lines, additions only) then
`api:check` EXIT 0, `pnpm typecheck` EXIT 0. Tovu: typecheck EXIT 0, lane tests no new red, pin as above,
`check:why-comments --base origin/codex/k1-pilot-tovu --other-root ../Jini` ok (66 moved blocks allow-listed).

## Union files
Jini `packages/cms/package.json` (+29 exports: exports triple + `jini.entries` universal; isolation domains:
`pages/get-by-id` widgets, `presentation/get` + `themes/list` presentation, change-sets core), `api-baseline/jini-ai__cms.json`
(regenerated), 7 changesets (one per family). Tovu `development/why-comments-debt.json` (+66), `apps/website/src/server/INFO.md`
`## Wiring` (+ Jini `packages/cms/README.md` `## Wiring`).

## Merge notes
- `ex7-media-posts-tovu` edits `modules/content.ts` and imports `ContentRouteDeps` from the deleted
  `routes/content/deps` — repoint it to `#src/server/runtime/composition/modules/content` (or `./content.js`) on merge.
- Family registrars live in `modules/{change-sets,email-templates,posts,pages,presentation,themes,theme-explore}.ts`;
  `content.ts` keeps the original registration order and imports the still-hand-written routes from their files (no re-export shells).
