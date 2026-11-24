TRAIN 3 merged | FILES LEFT 2,260 / 2,149 | 00:34Z 2026-11-24 (running)

# combine-16 (2026-11-23/24): rolling merge train, Jini + Tovu `integ/merge-16-2026-11-23`

Unattended cloud run, Opus high. `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work; its root-cause-first, fresh-evidence and pre-completion rules apply to every FIX below.

- **Bases:** Jini `origin/integ/merge-15-2026-11-23` = `60c6cd52a`; Tovu `origin/integ/merge-15-2026-11-23` = `33701312a1`. Tovu is linked to the Jini merge-16 tree (`JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`).
- **Pushed:** only `integ/merge-16-2026-11-23` on both repos, plain pushes after every merge. No force-push, no `--no-verify`, no tags/publish, no codebase-memory tools; no other `integ/*`, `main`, `release/*`, `plan/*` touched.
- **READY rule:** final report `cloud-results/<name>.md` first line `DONE`/`PARTIAL <sha>` AND a Codex row in `origin/plan/whats-left-1122:reviews/rv1123*.md` AND not yet merged. Plan branch re-fetched each loop.
- Column key: FIX ap = applied in this merge, st = already fixed on the branch head (dropped as stale), df = deferred.

## Branches
| branch | merged at (J · T) | FIX ap / st / df | tests |
|---|---|---|---|
| k1-pilot (incl. the rv1123e fix round) | J `ca058f871`+`1b2fa989c`+`b59b4d88f` · T `7a86849062`+`f3b3703fad` | st K1-jini #1 (update-tree keeps two auth decisions, `3638b1fd9`), st K1-jini #2 (Core `contracts/site/cms-menus` DTOs + object-arg serializer, `04b2ebf9c`/`2729295d0`), st K1-tovu #1/#2 (per-permission override + per-mount deferral opt-in, `069155845c`/`f3d0234197`), st K1-tovu #3 template (`b23e4cde8b`). **ap K1-tovu #3 types:** combine-15 had moved `menus-api.types.ts` into Jini `@jini-ai/admin/screens/menus/api/`, so the Core-DTO consumption was applied there. Conflicts: k1 re-merged foundation lanes that combine-15 already resolved → combine-15 owners kept (tool-metadata `taxonomy.ts` stays deleted, `i18n-common`), k1's menus mount kept (host `http/menus.ts` + `routes/menus/delete.ts` deleted), k1 mount repointed to `@jini-ai/cms/navigation/site/{menu-html-permission,trash-menu}`; package.json exports merged semantically (also dropped a duplicated `core-runtime-mode` key) | J build 0 · typecheck 0 · guard 1 (base row, untouched file `admin/shell/lib/shell-failure-log.ts` HW3) · cms menus+http 56/56 · http-kit 762/762 · admin menus 26/26. T typecheck 0 · admin tsc 0 · boundaries 0 · hooks 0 · why-comments 78 = base (2 moved comments recorded) · menus route + DTO + changed tests 116/116 |
| p12-cut7 | J `d701b0f18` (report only) · T `6e4f319109` | APPROVE, no FIX. 12 conflicts: combine-15 had already repointed the same render/menus/taxonomy files to `@jini-ai/cms/*` → kept combine-15's code and re-applied cut7's intent (escape → `@jini-ai/core/text`, slug → `@jini-ai/cms/html/site/slug`) across the tree; `features/post/slug.ts` stays deleted; Tier-2 `trustedImports` + its allowlist refusal test now name `@jini-ai/cms/html/site/slug` (the old host slug module is gone; the content analyzer already imports the cms one) | T typecheck 0 · admin tsc 0 · html boundary + plugin-tier2 + dev-lite + changed-dir tests 593/593 on Node 24 (3 reds on the container's default Node 22 are env-only: `RegExp.escape`, tsx hook order, postgres) |
| p12-cut46 | J `70923582c`+`7f45a58ae` · T `4fd4983650`+`2cca47a20d` | **ap J FIX 1** (one shared header-merge stage: `mergeHeaders({ sources })` exported from `admin/core/transport/http.ts`, used by `createHttpTransport` and `buildFetchInit`; legacy record shape + caller `Content-Type` precedence kept; a Headers instance / tuple array no longer dropped/mangled). **ap J FIX 2** (`buildFetchInit({ init }, _optional)`, bound `fetchOrThrowUnreachable(required, _optional)`; Tovu test callers repointed). **df T FIX 1** (F4.1 follow-up + zero unblock credit belongs in the P12 ledger on `plan/*`, which this run may not touch → recorded here for the coordinator). Conflicts: README Wiring (kept both sections), Tovu widgets module (kept combine-15's `@jini-ai/admin/screens/widgets` type + cut46's injected `UseAdminLocaleHook`) | J build 0 · typecheck 0 · admin 3634/3634 (+5 new; RED 2 first; mutation `default-type-wins` → 7 red → restored byte-exact). T typecheck 0 · admin tsc 0 · hooks 0 · boundaries 0 · why-comments 78 = base (2 locale-port docs moved to Jini, recorded) · admin changed+integrations+hooks 1061/1061 (2 skip) |

## FILES LEFT
`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`; FILES LEFT = moving + shells; excl. themes subtracts the `theme` + `adm-themes` area files. The base value reproduces combine-15's final exactly.

| after | moving | shells | FILES LEFT | excl. themes |
|---|---|---|---|---|
| base (merge-15 `33701312a1`) | 2,269 | 0 | **2,269** | **2,158** |
| 3 merges (k1-pilot, p12-cut7, p12-cut46; T `2cca47a20d`) | 2,260 | 0 | **2,260** | **2,149** |

## Held branches
(none yet)

## Not READY at last loop
- `codex/rt-*` (all 7 families): finished reports exist, but no Codex row in any `rv1123*.md` yet.
- `codex/w3-*`: still running (no final `w3-<lane>.md` report, except `w3-screens` which has no review).

## Environment notes
- The container's default `node` is 22; both repos require Node 24 (`engines`). All gates/tests here run with `/opt/node24/bin` first on PATH. Under Node 22, `RegExp.escape` (Jini `cms/forms/result-html.ts`) and tsx's hook order make 2 Tovu tests red — env-only, green on 24.
- Jini `pnpm guard` reports 1 row on base and head alike: `HW3-module-state packages/admin/src/shell/lib/shell-failure-log.ts` (file untouched by this train; combine-15 recorded guard 0, so it is likely a guard-rule change landed with merge-15).

## New bugs
1. (from the cut46 FIX worker, not fixed) `authenticatedAdminRequest` in Jini `admin/shell/lib/admin-http/request.ts` still object-spreads `{ ...payload.headers, ...options.headers }` before `buildFetchInit`; a Blob body's `Content-Type` plus a differently-cased caller `content-type` would be sent joined. Route it through `mergeHeaders` too.
