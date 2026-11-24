PARTIAL ba702879c 84416023: users 4 routes STOPPED (list-roles, list-policies, list-policy-permissions, remove-policy-permission); owner MFA/passkey/recovery route files STOPPED (3); forms, widgets, taxonomy SKIPPED (in flight on codex/ex7-coll-small-tovu)

# rt-i1: K1 route conversion, independent batch 1 (2026-11-23, unattended)

The Tovu → Jini extraction of the users family (with the owner sheets) and the newsletter family. Route
specs are server-neutral `defineJsonRoute` specs that Tovu mounts through `mountAdminJsonRoute` with
small injected deps, following `plans/K1-route-template.md` (`codex/k1-pilot-tovu`).

- Branches: Tovu `codex/rt-i1-tovu` (base `origin/codex/k1-pilot-tovu` 582db5967), Jini `codex/rt-i1-jini`
  (base `origin/codex/k1-pilot-jini` 28ce682b). Jini is linked into Tovu (`link-jini.mjs`) and `packages/sdk` is built.
- Bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. I followed its
  tests-first slice loop, Architecture Audit, pre-completion checklist and why-comment rules. The run
  used no codebase-memory tools.
- Method: I was the coordinator. Lanes ran as subagents on disjoint files and never committed:
  - U1: users principal routes (Opus).
  - U2: users role and policy routes (Opus).
  - OWN: the owner MFA, passkey and recovery sheets (Opus).
  - N1: newsletter campaign routes plus the family's shared files (Opus).
  - N2: newsletter list and subscription routes (Sonnet, copying N1's recipe).
  - A Sonnet rework lane for U2 after a guard finding.

  At most 4 lanes ran at once. I reviewed each diff against the template §7 checklist, owned the shared
  files, ran the Tovu-side mutations and the route-table pin serially, and committed each family.

## Skipped before conversion (template rule: already converted elsewhere)
| family | where | evidence |
|---|---|---|
| forms | `codex/ex7-coll-small-tovu` (last commit 20:54Z, active) | 9 of 12 route files deleted, create/delete-submission/authoring modified, `http/forms.ts` deleted (commit 7301c03f1 RT-K1-adm-forms-2) |
| widgets | same branch | 13 of 15 deleted (d53755ceb, a694f2de8 RT-K1-adm-widgets-2/3) |
| taxonomy | same branch | 7 of 8 deleted (3e0b8b9e2 RT-K1-adm-taxonomy) |

Converting these here would collide with that lane.

## Per family

### users (RT-K1-adm-users-1..9): 16 of 20 routes converted
- **Jini home: `@jini-ai/user-management`, not cms (a departure from the sheets).** That package owns the
  identity services, records and errors and depends only on core; cms has no identity dependency.
- Specs: `packages/user-management/src/admin-http/routes/users/*` and the DTO helper
  `src/admin-http/http/users.ts`, moved verbatim. The optional DTO fields admit `undefined` because Jini
  uses `exactOptionalPropertyTypes`; the wire is unchanged.
  - Principal routes (9): list, create, update, disable, enable, reset-password, delete, assign-role, attach-policy.
    - Shared file: `shared.ts`. Tests: `__tests__/helpers.ts` plus 10 files, 70 tests.
  - Role and policy routes (7): create-role, update-role, delete-role, create-policy, update-policy,
    delete-policy, write-policy-permission.
    - Shared file: `access-shared.ts`. Tests: `__tests__/access-helpers.ts` plus 7 files, 57 tests.
- **Guard finding (SI-domain), and how it was fixed:** the specs value-imported `src/server/*` services.
  - Each service a spec calls is now a REQUIRED deps field typed `typeof fn` through a type-only import.
  - The registrar binds it from `@jini-ai/user-management/server`, like the template's `normalizeMenuHtml` precedent.
- Other injected collaborators:
  - the identity deps assembler, a per-request thunk;
  - the Trash index and the trash move;
  - `assertUserAccountAction` and `userAccountProtection`;
  - the host error classes, as predicates (`isUserInTrashError`, `isSelfDeleteError`, `isUserDeleteUnsupportedError`);
  - the ungrantable-permission list and its refusal copy;
  - the raw `decidePermission` for list. That route asks for two permissions ("either one") and sends no entity type.
- Tovu:
  - `runtime/composition/modules/users.ts` holds the 9 principal registrars; the new `modules/users-access.ts` holds the 7 role/policy registrars.
  - Registrar names and the `createUsersModule` order are unchanged.
  - Every mount is `"direct"`: none used the publishing-credential override.
  - `failure.operation` is `routes/users/<file>` with code `INTERNAL_ERROR`, copied per route.
- **Files deleted from Tovu (17):** 16 route sources plus `http/users.ts`. Its importers now read
  `@jini-ai/user-management/admin-http/http/users`. **Left:** `routes/users/deps.ts`, which has about
  40 composition importers, so it stays as host composition.
- **STOPPED (4), Tovu sources untouched:**
  - `list-roles`, `list-policies`, `list-policy-permissions`: they call authorize with no `entityType`,
    and `read-lists.test.ts` pins the exact params. Converting them needs `JsonRouteAuthorize.entityType`
    to be optional plus an `admin-json-route-ports.ts` change.
  - `remove-policy-permission`: its test overrides `res.send` and pins a bare 204 `send()`. http-kit
    answers 204 through `res.json(undefined)`; the wire is the same, but the test would need more than an import repoint.
- **Tests:**
  - Jini: written first and committed RED (wip snapshots), then GREEN. The full user-management suite is
    1484 of 1486; the 2 failing `runtime-boundary` tests also fail at base.
  - Tovu: imports repointed only. One replaced test: `reset-password.test.ts`'s direct call of the deleted
    `sendResetPasswordError` became a wire test of the same SelfDelete→409 rule through the registrar.
  - Tovu users plus backstop: 234 of 234 (baseline 230 of 230; the new files add tests).
- **Two package-contract tests updated:**
  - `public-args.test.ts`: the access helpers now take named argument objects.
  - `user-management-rename.contract.test.ts`: its exact entries list gains the 18 new entries.
- **Mutations** (Jini source mutated, dist rebuilt, both sides run, restored by byte copy, `cmp` clean):
  - **M1** (update: the non-string-username parse refusal disabled): Jini 1 RED, Tovu 1 RED (`UPDATE_USER route: a non-string username is rejected…`).
  - **M2** (create: the USERNAME_IN_TRASH re-check disabled): Jini 1 RED, Tovu 1 RED (`CREATE_USER route: 409 USERNAME_IN_TRASH…`).
  - The U2 lane's Jini-side mutations: create-role's `?? ""` fallback dropped, 1 RED; the ungrantable refusal disabled, 2 RED.
- **Not ported (behaviour changes on other branches):** `codex/bugs-high-tovu` (B151 enable, B152
  reset-password) and `codex/bugs-low-b-tovu` (B227 409 on create-role and update-role) edit the users
  sources this run deleted. **Whichever branch merges second must re-apply those fixes in the Jini specs
  or in the injected collaborators.**

### owner MFA, passkey and recovery sheets: 1 of 4 files
- `owner-mfa-deps.ts` became Jini `@jini-ai/user-management/admin-http/owner/mfa-deps` (`composeOwnerMfaDeps`, universal, type-only imports).
  - Tovu `modules/owner-auth.ts` binds it through `ownerMfaDepsFrom`, with the same signature and late-bound getters.
  - Jini: 6 tests. Jini-side M1 gave 1 RED and M2 gave 3 RED.
- **STOPPED: `owner-mfa-routes.ts`, `owner-passkey-routes.ts`, `owner-recovery-routes.ts`** (12 routes, non-JSON `ServerRoute` shape).
  - Their unit tests drive the handlers through a fake `app` (only `post`/`get`) with fake Express
    `req`/`res`. `mountJiniRoutes` would need `app.use` and real Node streams, so the tests would need rewrites.
  - A conversion would also need:
    - the local port in the request facts (`req.socket.localPort`);
    - web-Request versions of `resolveSiteConsentOrigin`, `isLocalAdminRequest`, `resolveClientIp` and the authenticators;
    - a `Set-Cookie`-identical answer for passkey sign-in;
    - a `sendAdminFailure` that returns a `Response`.
  - Pin impact if converted: 12 route layers would become 3 `app.use` layers.
- Tovu owner tests: 22 of 24. The 2 failures are the Playwright browser tests that also fail at base.

### newsletter (RT-K1-adm-newsletter-1..7): 19 of 19 routes
- **Jini home: `@jini-ai/cms`.**
  - Specs are in `packages/cms/src/admin-http/routes/newsletter/*` (the 19 routes plus internal `campaigns.ts`, `lists.ts`, `subscriptions.ts` and `shared.ts`).
  - `src/admin-http/http/newsletter.ts` holds the DTO types, `toDataResponse` and the `NewsletterErrorMapper` port.
  - Isolation domain: `newsletter`. Guard accepts an entry domain without a `src/` root, and the label flags any future cross-domain reach.
- The newsletter domain has no Jini code yet, so everything is injected. Each route gets:
  - the host services it calls (`saveCampaign`, `scheduleCampaign`, `openSendPipeline`, `saveList`, `importSubscriptions`, `issueConfirmationToken`, …);
  - `newsletterReady`, awaited after the permission check, as before;
  - `mapNewsletterError`. Its error-class table moved verbatim to Tovu `features/newsletter/http-error-responses.ts`. Unmapped errors are rethrown to the host's 500 port.
- Tovu `modules/newsletter.ts`:
  - Registrar names and order are unchanged; every route is `"direct"`, entity types are the same, and none sends an `entityId`.
  - `failure.operation` is `http/newsletter`.
- **Files deleted from Tovu (20):** 19 route sources plus `http/newsletter.ts`. **Left:** `routes/newsletter/deps.ts` (its bag and `toSendPipelineDeps`, used across composition).
- **Tests:**
  - Jini: written first, RED, then GREEN; 218 tests across 18 files. The full cms `src/admin-http` run is 353 of 353.
  - Tovu: newsletter routes plus features/newsletter plus the related http tests are all green inside the
    905-test run below (baseline 158 of 158 for `routes/newsletter/__tests__`).
  - Replaced tests (template §4.2). `http/__tests__/newsletter-errors.test.ts` and the `newsletter` row of
    `unexpected-route-errors.test.ts` tested the deleted helper. Their replacement is
    `routes/newsletter/__tests__/error-mapping.test.ts`, with wire tests through the registrar:
    - the 10 exact status/code/details fixtures, verbatim;
    - redaction for Error, object, null and string throws;
    - one test I added: log and tracker correlation by `errorId`, with no secret leak.
- **Mutations:**
  - **M1** (create-list parse refusal disabled): Jini RED (N2 counted 6), Tovu 1 RED (`create-list: missing name or slug returns 400`).
  - **M2** (import-subscriptions 207→200): Jini 1 RED, Tovu 1 RED.
  - **Coverage gap that predates this run:** M2′ (remove-subscription's cross-list 404 dropped) goes RED in Jini but not in Tovu. No Tovu wire test pins the cross-list 404; the new Jini test is its only pin.
- **Departure to review:** the 500 copy is pinned. `sendAdminFailure` builds the copy from method and route,
  which changed get/list/send's 500 text. `modules/newsletter.ts` therefore passes the pre-move copy
  (`describeRequestFailure({ operation: "http/newsletter" })`) as `failure.message`/`failure.failure`,
  with no cause. `FailureOptions.failure` is documented as "Only the export pilot may supply its
  authorized, redacted cause". Nothing secret is supplied, but the field is used.

## Route-table pin (`create-app-route-table.pin.test.ts`)
- It is red at base, as the template expects (5,974 normalized output lines).
- The branch diff against base is **not identical**. Exactly 1 row changes, in all 7 configs:
  `route post /api/admin/v1/workspaces/:workspaceId/users [forwardRejection]` → `[<anonymous>]`.
  - The hand-written create-user route was wrapped in `asyncRoute` (handler named `forwardRejection`); a `mountAdminJsonRoute` handler is anonymous.
  - The order and the path set are unchanged, and newsletter adds no diff.
  - The committed fixture `fixtures/create-app-route-table.snapshot.json` pins `[forwardRejection]` for that row.
  - I did **not** edit the fixture (no test edits beyond import lines). **Owner decision:** accept the
    one-line fixture update (`[forwardRejection]` → `[<anonymous>]` on the users POST rows), or keep
    create-user hand-written.

## Gates (fresh, end of run)
| gate | result |
|---|---|
| Jini `pnpm -r build` | 0 |
| Jini `pnpm guard` | 0 (zero violations) |
| Jini `pnpm api:update` / `api:check` | 0 (40 packages, 813 entries, 17639 symbols; cms + user-management baselines) |
| Jini `pnpm typecheck` | 0 |
| Jini cms `vitest src/admin-http` | 353 / 353 |
| Jini cms full vitest | 5427 / 5436. 7 failures also fail at base (forms `result-html` ×6, widgets `expand-partials` ×1). forms `package-boundary` fails at base too. `universal-entries.boundary` failed once under full-suite load and passes alone (6/6, 3.9 s against the 5 s default timeout). |
| Jini user-management full vitest | 1484 / 1486. The 2 `runtime-boundary` failures also fail at base. |
| Tovu `npm run typecheck` (incl. e2e) | 0. `tsconfig.tests.json` also 0, so no test importer was missed. |
| Tovu route tests (users, newsletter, owner, admin-json-route-ports, backstop, unexpected-route-errors, response-projections, features/newsletter, redirects) | 903 / 905. The 2 failures are the base owner browser tests. |
| Tovu pin | red at base and on the branch; diff = base + the users POST handler-name row (above) |
| Tovu `check:why-comments --base k1-pilot-tovu` | ok (27 moved blocks allow-listed with destinations) |
| Tovu `check:complexity` / `check:boundaries` | 0 / 0 |
| Tovu `check:size` | 6 worsened violations, all in files this run did not touch (admin page and post editors, desktop SiteGrid, publish-agent-tools); same class as the pilot |

## Files left (Tovu non-test sources)
| scope | before (k1-pilot-tovu) | after |
|---|---|---|
| `admin-http` users (`routes/users/*` + `http/users.ts`) | 22 | 5 (4 STOPPED routes + `deps.ts`) |
| newsletter (`routes/newsletter/*` + `http/newsletter.ts`) | 21 | 1 (`deps.ts`) |
| owner (`admin-http/owner-*.ts`) | 4 | 3 |
| widgets / forms / taxonomy | 16 / 13 / 9 | unchanged (skipped) |
| `scan.mjs` website non-test files | 2209 | 2174 |

## Shared files (union-merged)
- Jini:
  - `packages/user-management/package.json`: 18 entries.
  - `packages/cms/package.json`: 20 entries, all through the atomic `??=` helper.
  - `api-baseline/jini-ai__{cms,user-management}.json`, regenerated.
  - Changesets `.changeset/user-management-admin-route-specs.md` and `.changeset/cms-newsletter-route-specs.md` (patch).
  - `## Wiring` in `packages/cms/README.md` (newsletter) and `packages/user-management/README.md` (new section).
- Tovu:
  - `development/why-comments-debt.json`: 27 entries, ids appended, nothing overwritten.
  - `apps/website/src/server/INFO.md` `## Wiring`: users, owner and newsletter paragraphs.

## Commits (all pushed)
Tovu `codex/rt-i1-tovu`:
- 2e4ce8507, c7fd81ea7, 85fa0a046, 6dd8b3cc1 (wip snapshots of in-flight lanes, per the push-every-10-min rule)
- 1b7c1595e (users T)
- 8985f4e6a (newsletter T)
- 4e114fdd2 (why-comments + INFO.md)
- ba702879c (Tovu `http/users.ts` deleted)
- plus this report

Jini `codex/rt-i1-jini`:
- 3b6be76f (users DTO)
- a36189ed (owner mfa-deps)
- 727b8a62, ec4e6640, 02995b6c (wip snapshots)
- 3017671f (users specs)
- 23be4566 (newsletter specs)
- c9aaccdc (API baselines, cms Wiring, changeset)
- 84416023 (named-args + entry contract)
- plus this report copy

Pushes: the working tree held other lanes' uncommitted edits, so `git pull --rebase` could not run. Before
every push I ran `git fetch` and confirmed the branch was not behind (only this run pushes these branches).
There were no force-pushes and no `--no-verify`.

## Risks / follow-ups
1. The route-table pin row (users POST handler name) needs an owner decision; see above.
2. Merge order with `codex/bugs-high-tovu` and `codex/bugs-low-b-tovu`: those fixes target deleted users sources.
3. The newsletter 500-copy pin uses `FailureOptions.failure`, documented as export-pilot-only.
4. A 500 for a request with no session now omits `details` (`discloseDetails` false). This is template-wide
   (pilot §6.2); no test pins the difference.
5. These values are captured once at registration, not per request: newsletter `newsletterReady` and its
   repos, and users `ownerPrincipalId`. No test reassigns them.
6. Lifting the users STOPs needs `JsonRouteAuthorize.entityType` to become optional and the admin port to
   omit the key (3 list routes), plus an http-kit 204 written with `send()`/`end()` (remove-policy-permission).
   Both are shared-seam changes for a separate step.
7. Stale comment references to deleted files, outside this lane:
   - `runtime/composition/trash-user-tool-port.ts:10`
   - `inbound/admin-http/routes/api-keys/{create-principal.ts:20, revoke.ts:18, deps.ts:101}`
   - `inbound/admin-http/routes/workspace/get.ts:11`
   - `assistant/__tests__/mcp-ui-allowlist-completeness.test.ts:113` (an `owner-mfa-deps.ts` fixture string, already stale before this run)
   - `development/scripts/__tests__/route-coverage-lib.test.ts:61` (a `list-campaigns.ts` path string)
8. Architecture Audit: WARNING (no blockers). Two choices depart from the step sheets: users specs live in
   user-management rather than cms, and the newsletter domain is injected rather than moved (K5-newsletter
   not done). Both are recorded here; no hard boundary is breached (guard 0).
