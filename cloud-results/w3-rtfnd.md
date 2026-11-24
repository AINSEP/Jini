PARTIAL 3ea9bab49e 5b38059da: route plumbing done (Jini J1-J5 + Vary/protocol, Tovu T1-T8 + grant-only accessor); 19 STOPPED families converted fully or partly; left: owner-decision STOPs listed below (asyncRoute pin names, gate-order changes, visitor-analytics Request capture, owner-admission mount, analytics nested 500 body) + budget leftovers (media list/original, publish-content blob-get/blob-put/export/blobs-probe, external-mcp shared GET, admin-surfaces GET, posts/themes previews, public site, members sign-in family)

# w3-rtfnd — route plumbing + blocked route families (wave 3)

Branches: Jini `codex/w3-rtfnd-jini`, Tovu `codex/w3-rtfnd-tovu` (plain `git push`, never forced).
Programmer contract read: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) — confirmed; every subagent brief
carried its rules (tests first + named mutation, object args with `_optional = {}`, <=80 lines/complexity 10,
why-comments move with code, `## Wiring`, no re-export files, no server-framework types in Core).

## Base
- Jini/Tovu from `origin/integ/merge-15-2026-11-23` (Jini 0a44b54ca, Tovu bd89a2aa83), then merged
  `origin/codex/k1-pilot-*` (incl. the k1fix round) and every `origin/codex/rt-{i1,i2,l1-content,l2-system,l3-pubsite,l4-oauth,l5-recovery}-*`.
  Conflicts: package.json/why-comments-debt 3-way JSON union; api-baselines regenerated; README/INFO.md text union;
  Tovu files the base modified but a lane moved to Jini were taken as deleted, and the base's changes were
  carried into the Jini specs (see FIX/sync below). `cms-media.ts` both-added → both declaration sets kept.
  No non-trivial conflict skipped.
- Final: latest merge-15 head merged again before the last push (Jini 60c6cd52a, Tovu 33701312a1 — report/test-fake commits; clean).
- Jini linked into Tovu with `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`.

## FIX items applied
- rv1123e K1-jini #1/#2 and K1-tovu #1–#3 were already applied by the k1fix round on `codex/k1-pilot-*`
  (Tovu bf3ece80cc, Jini c73309b4a); verified present after the merge. rv1123a ex5-fnd-routes FIX 1 (chat.db) present (2239c8585c).
- Merge sync (base fixes whose route files the lanes had moved to Jini): **B151** users enable owner guard,
  **B152** reset-password permission before Trash, **C058** members disable 409 VERSION_CONFLICT (copy stays
  Tovu, K3) — Jini fe3fd69d9, Tovu 89f5ed2297; tests first (4 RED), mutations enable-skips-owner-guard,
  reset-trash-before-perm, member-conflict-500 caught. Merge import fallout repointed (external-mcp,
  integrations webhooks, media content-type, sites DevRestartPort, response-projections test).
- rt-l2 merge had left `api-baseline/jini-ai__cms.json` invalid JSON → regenerated (0b53d1f9c).

## Plumbing (owned by this lane)
| side | what | commits |
|---|---|---|
| Jini core | `RouteInputContext.headers` / `.facts` (opt-in), `RouteRequestFacts {clientAddress,userAgent?,host?,protocol?}`, `routeReply`/`isRouteReply`, `JsonRouteAuthorize.entityType` optional (key omitted) | f5229302e, protocol: see log |
| Jini http-kit | spec `readHeaders` / `requestFacts` / `responseHeaders`, port `requestFacts`, reply writer (bare `send()` for empty bodies), `defineRawRoute`/`mountRawRoute` (app[method], pin-safe; web Response incl. Set-Cookie list + streams), `Vary` appended via `res.vary` | f5229302e, 91976f895 |
| Tovu ports | `sessionCredentialOnly`, `forbidden`, `failureFor`, `failureCopy`, authorize forwards entityType only when given, requestFacts bound to the host resolver (+protocol), public ports w/ workspace 404, `mountAdminRawRoute`/`mountPublicRawRoute`, `adminRequestFactsFor` + `adminPublishTrustFor` | 5ac4b02216, a359028be7, 5e6a382974 |
| template | `plans/K1-route-template.md` §9 "Request context, replies and raw routes (w3-rtfnd)" + §9.6 migration table; `ok({ value: routeReply(...) })` fix | 5ac4b02216, a359028be7 |
Tests first everywhere; http-kit 780/780, core 3029/3029; 7 Jini + 9 Tovu + 2 coordinator mutations caught.
Every existing port test unchanged and green.

## Batch table
| batch | model | routes moved (Tovu files deleted) | importers repointed | tests (Jini / Tovu) | status |
|---|---|---|---|---|---|
| sync B151/B152/C058 | Opus | 0 (behaviour into moved specs) | 6 composition modules | +4 RED→green / users+members 274/274 | done |
| J1–J5 seams | Opus | — | — | http-kit 779, core 3029 | done |
| T1–T8 seams | Opus | — | — | ports 366 (7 = pre-existing pin reds) | done |
| C1 users | Opus | 4 (list-roles, list-policies, list-policy-permissions, remove-policy-permission) | 6 tests (import lines) | 19 new / 242/242 | done |
| C1b posts+pages writes | Opus | 6 (posts+pages create/update/delete) | 4 tests | 87/87 / 200/200 | done |
| C2 consent+presentation | Opus | 7 (consent 6 regs in 1 file, presentation PATCH) | 4 | 17+7 / 13/13, 45/45 | done; skills list stopped→fixed seam |
| C2b skills list | Opus | 1 | 3 tests + panel-access path | 6 / 68/68 | done; publish-trust/analytics stopped |
| C2c publish-trust | Opus | 3 (handshake.ts) | 3 | 18 / 491/491 | done |
| C2d members request-magic-link | Opus | 1 | 3 tests | 10 / 89/89 | done; owner MFA/passkey/recovery STOPPED |
| C3 plugins provider-settings | Opus | 3 (provider-settings.ts) | 2 | 14 / 38/38 | done |
| C3b bundle-create | Opus | 1 | 2 tests | 18 / 94/94 | done |
| C3c capabilities+import | Opus | 5 (capabilities.ts, import.ts) | 4 tests | 25 / 132/132 | done |
| C3d backstop | Opus | 5 (backstop.ts) | 7 tests | 12 / 139/139 | done |
| C3e peer pull | Opus | 1 (peer-transport.ts kept for push) | 7 | 7 / 102/103 | partial: push ×3 STOPPED |
| C4 memory + where-used | Opus | 3 (memory.ts, where-used.ts) | 4 tests | 19 / 23/23, 82/82 (+1 new pin) | done |
| C4b import-url | Opus | 1 | 2 tests | 10 / 108/108 | done; external-mcp + admin-surfaces POST STOPPED |
| C4c media text/replace/upload | Opus | 3 | 14 tests (+h4-text → wire tests) | 71 / 219/219 | done |
| C5 public sign-out | Opus | 1 (raw route) | 2 | 7 / 64 | done; commerce + sign-in family STOPPED |
| C5b public me/login-providers/forgot/reset/set-password | Opus | 5 (4 files + 1 registration) | 3 tests | 24 / 145 | done; unlink-identity left (budget) |
Totals: **54 route registrations** moved to Jini specs across **19 batches**; ~37 Tovu route source files deleted.
Container restart at ~23:53 killed 4 agents; their on-disk partial work was resumed and finished by fresh agents.
Subagents: 22 Opus (opus-high), 3 Sonnet sidekicks (gates). Every diff reviewed before its commit; Jini
package.json exports staged per batch (only that batch's keys).

## Skipped / STOPPED (exact reason; owner decision + recommendation)
1. **asyncRoute handler name in the route-table pin** (`[forwardRejection]` → `[<anonymous>]`): external-mcp probe,
   oauth/sign-in, oauth/shared DELETE+POST, oauth/connect, oauth/device/poll; public commerce /return,/cancel;
   rt-i2 fs-files mount (patch held). Recommendation: approve regenerating the pin (`UPDATE_ROUTE_TABLE_PIN`) once,
   or add an opt-in handler name in http-kit; then convert all together.
   NOTE: the merged lane heads already changed 15 pin rows this way (rt-l1 posts autosave, rt-l2 system
   custom/publish/source-control credentials + providers, rt-i1 users POST) — none touched by a w3 commit
   (git log check). The pin test is 3/10 at merge-15 base too (`/internal/tool-*` drift).
2. **Gate order** (hand-written route refuses BEFORE the workspace 404 / authenticate): agent-plugins admin-surfaces
   POST ×2 (same-origin 403 → credential 403 → 404), publish-content push plan/confirm/execute (live-site 403 before
   404). Recommendation: accept "workspace 404 first" (both answers are refusals) and pin the combined cases, or add a
   pre-workspace refusal port.
3. **Visitor analytics capture from the Express Request**: public members complete-sign-in, password-sign-in, sign-in,
   oidc-callback, oidc-verify-email, oidc /start; commerce purchase. Recommendation: an analytics port that takes
   request facts instead of `Request`, or a per-request host scope passed to `handle`.
4. **Owner MFA/passkey/recovery (12)**: pre-session-gate owner admission + Express origin/content-type gate +
   `resolveClientIp`. Recommendation: a host "owner admission" mount (pre-gate authenticate + origin-policy port), pinned.
5. **analytics recent-hits**: nested 500 envelope; recommendation: `failureBody` admin mount option.
6. **ops /readyz** (deploy-config regex-reads the source) — owner decision unchanged from rt-i2.
7. Budget (no blocker): media list/original, publish-content blob-get/blob-put/export/blobs-probe, external-mcp shared GET,
   admin-surfaces GET, posts template-preview + themes preview, public site (26 files), members remaining (unlink-identity).

## Gates (base-diff vs merge-15)
| gate | HEAD | BASE (merge-15) | verdict |
|---|---|---|---|
| Jini build | 0 `error TS` | — | green |
| Jini typecheck | 0 | — | green |
| Jini guard | 2 | 8 | **1 NEW**: SI-domain `cms/admin-http/routes/presentation/patch.ts` imports `../../../presentation/index.js` (fix: import the presentation subpath it needs); HW3 shell-failure-log pre-existing; base's 7 SI-resolution gone |
| Jini api:check | green (39 pkgs, 1207 entries) | — | green |
| Jini complexity | 7 errors | 6 | **1 NEW**: `cms/admin-http/routes/plugins/provider-settings.ts:108 cardField` complexity 11 (fix: split the per-field kind switch) |
| Jini check:size | red | red (same 3 lines) | pre-existing |
| Jini check:why-comments | red (10 blocks) | red (same 10) | pre-existing (lost 377 vs 379) |
| Jini check:hooks | green | — | green |
| Jini XP | no such script | — | n/a |
| Jini vitest http-kit / cms routes / user-management | 780/780 · 1675/1675 · 1506/1508 | um 1343/1345 | 2 runtime-boundary reds pre-existing |
| Tovu tsc main / tests / admin | 0 / 0 / 0 | 0 / 0 / — | green |
| Tovu admin vitest panel-access | 29/45 | 45/45 | **NEW**: ENOENT on route source paths it reads (users/list, list-roles, themes/list, system/mail-status, deployment-overview, settings/get-effective — moved by the merged rt lanes and w3); fix: repoint SERVER_EVIDENCE to the Jini spec paths like the skills row |
| Tovu node (153 changed+importer files) | INCOMPLETE (3 chunks hit timeout 600 under load) | — | per-batch runs above all green; re-checked reds (owner-passkey ×2, member-password-auth 1) are pre-existing |
| route-table pin | 3/10 | 3/10 | w3 rows identical; 15 rows changed by merged lane heads (see STOP 1) |

## FILES LEFT (plans/P9-data/tools scan.mjs → plan.mjs "moving", themes excluded per combine-15's metric)
`moving`: BASE **2269** → HEAD **2086** (−183). Themes-excluded items: 742 files / 56310 LOC → 742 / 56280 LOC (items.json, inferred method).

## Behaviour notes (no wire change claimed beyond these)
- C058 body key order `{error, code}` (was `{code, error}`); backstop send/undo unmapped failures answer via
  sendAdminFailure (`details` before `error`); presentation/consent unchanged.
- sessionCredentialOnly refuses before the principal read: a non-session credential with no principal now gets
  403 instead of 500 (unpinned edge).
- C1b posts/pages: a missing session fails in authenticate before id/slug work (same 500 copy).
