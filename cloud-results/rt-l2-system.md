DONE 1269c4c2b8 bab419bb5   (tovu codex/rt-l2-system-tovu @ last work commit before this report; jini codex/rt-l2-system-jini @ last work commit before its report copy)

# RT-K1 lane L2 system — settings → sites → system (unattended, 2026-11-23)

- Bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work; every subagent was told to follow its
  tests-first slice loop, architecture audit and pre-completion checklist. No codebase-memory tools (owner rule); rg/git only.
- Base: Jini `origin/codex/k1-pilot-jini` (`28ce682b`), Tovu `origin/codex/k1-pilot-tovu` (`582db5967`); Jini linked into Tovu
  (`link-jini.mjs`), `packages/sdk` built. Mid-run the pilot heads gained the rv1123e corrections; both were **merged**
  (Jini `38c67e96b`, Tovu merge commit after `e5ec814923`) and the template's "Migration for families converted before
  582db5967" checklist was applied to every family converted here.
- Method: coordinator + up to 4 parallel subagents on disjoint files (Opus high for every route lane; Sonnet for the
  why-comment restoration), exports via a locked union helper, coordinator reviewed each report against the §7
  checklist, committed, wrote Wiring/changesets/baselines/debt.
- Skipped (already deleted on `origin/codex/ex6-pages-dash-tovu`): `system/observability-status.ts`, `server-logs.ts`,
  `tool-gaps.ts`. Other ex6/ex7 heads only re-point imports in a few system files (no conversion) → not skipped.

## Files left (non-test `.ts` under `inbound/admin-http/routes/<family>/`)

| family | before | after | what is left |
|---|---|---|---|
| settings | 11 | 3 | `deps.ts` + `shared.ts` (host composition: `createTovuSettingsService`, write fence copy, read policy), `events.ts` (SSE) |
| sites | 3 | 3 | trimmed: `sites-home.ts` (PUT config), `site-previews.ts` (binary), `warm-site-control.ts` (relay) |
| system | 26 | 16 | 3 skipped (other lane) + 13 holding STOPped routes (below) |
| **total** | **40** | **22** | |

## Per family

Registrations converted / in scope. Every converted route: Jini `defineJsonRoute` spec with its own `<Name>RouteDeps`
(Pick'd / function-typed, host copy + permissions injected), mounted by a Tovu `modules/*.ts` registrar via
`mountAdminJsonRoute` with the old registrar name, order, `"direct"/"guarded"` and `failure` options copied verbatim.
Tovu wire tests changed import lines only (+2 new deferral pins, below). Wire DTOs moved to Core per rv1123e §2.1.

| family (Tovu module) | converted | Jini spec tests | M1 / M2 (RED both sides, restored + cmp) | STOPped routes (stay hand-written) + why |
|---|---|---|---|---|
| settings (`modules/settings.ts`) | 7/8 | 26 + parity test | get-raw: query refusal accepted / 404 dropped | `events.ts` SSE (non-JSON; no admin-ported ServerRoute mount exists) |
| assistant owner grants (`modules/system-assistant.ts`) | 4/4 | 14 | permanent-deletes: selection accepted / ack rule dropped | — (`mountSettingsJsonRoute` deleted, no callers) |
| sites + `system/sites.ts` (`modules/sites.ts`) | 5/10 | 19 (+10 local-sites) | sites-home: missing path accepted / directory rule dropped | PUT sites/config (two failure copies by phase), card preview (binary), warm relay (`app.use` proxy), list (reads `req.socket`), `/internal/dev-warm-site` (header gate, `sendStatus`) |
| system mail (`modules/system-mail.ts`) | 13/14 | 124 | mail-test-send: non-object body accepted / 429 dropped; providers: refusal status / activate permission | PUT mail-provider credential (reads `res.locals.authCredentialKind`) |
| saved credentials (`modules/system-credentials.ts`) | 11/16 | 26 | source-control: VALIDATION rung / project-bound non-default rule | custom list + update (credential kind), publish GET list (test pins a direct-call rejection), credential-copy ×2 (socket/headers, `Cache-Control`) |
| system deploy (`modules/system-deploy.ts`) | 6/10 | 36 | export: non-boolean `clean` accepted / overview default-password check | publish trigger (blocked-publish product events + host precondition chain), destinations (publish-trust peer read), dockerfile-source ×2 (ETag / If-Match) |
| shares / imports / backups / share-password | 0/18 | — | — | all: per-response security headers, `{code,message}` refusal + workspace-404 body, publish-trust branching, raw/stream uploads & downloads, per-error failure copy |
| site-key, browser-telemetry | 0/7 | — | — | site-key: session-credential gate before the workspace 404 + `no-store`; telemetry: 204 beacon, `Retry-After`, content-length |
| **total** | **46/87** | **245 + parity** | | 41 registrations, every one a template STOP (host-port seam needed) |

Tovu files deleted (21): settings/{assistant-subagents-access,get-raw,get-effective,list-definitions,set,clear,reset,register-definitions},
system/{mail-status,mail-dns,mail-test-send,mail-activity,source-control-credentials,deployment-overview,export-site,
assistant-owner-grant,assistant-permanent-deletes,assistant-subagents}.ts (+ `custom-credentials.ts`, `publish-credentials.ts`,
`publish-site.ts`, `mail-providers.ts`, `sites.ts`, `sites-home.ts` trimmed to their STOPped routes).

Jini: `packages/cms/src/admin-http/routes/{settings,sites,system}/**` (specs + `__tests__`), Core wire DTOs
`packages/core/src/contracts/site/cms-{settings,sites,mail,system-deploy}.ts`; exports unioned into cms/core `package.json`;
changesets `cms-{settings,sites,system-mail,system-credentials,system-deploy}-route-specs.md`,
`core-cms-{mail,settings,sites,system-deploy}-wire-dtos.md`; `## Wiring` in `packages/cms/README.md` and Tovu
`apps/website/src/server/INFO.md`.

## rv1123e migration (applied to every family above)

- Deferral audit vs the 582db5967 originals: only **mail-test-send** refused its body before `getAuthedPrincipal` →
  `deferMissingPrincipal: true` + 2 wire pins (`mail-dns-and-test-send.unit.test.ts`: malformed ⇒ old 400; valid ⇒ 500, nothing
  sent); mutation (drop the option) ⇒ RED. Settings read the session first (old settings ports), all others too.
- Authorization: one spec `authorize` per hand-written call; no converted route mixes modes (`authorizationByPermission` unused);
  the only mixed-mode route (publish destinations) stays hand-written.
- Object arguments in all new helpers and host `mountOptions` (object form). Error ladders re-checked against the original bodies.
- Admin client consumes Core DTOs where shapes match (settings value/reset, sites home); others differ and are listed in the lane
  reports (mail status lanes, deployment env `source` union, token plugins mutability, create-site optional tokens).

## Gates (fresh, final tree)

| gate | result |
|---|---|
| Jini core + cms build | 0 |
| Jini `pnpm guard` | 0 (zero violations) |
| Jini `pnpm api:update` → `api:check` | 0 (40 packages, 812 entries, 17747 symbols); baselines committed |
| Jini `pnpm typecheck` | 0 |
| Jini cms vitest `src/admin-http` | 383 / 383 |
| Tovu `npm run typecheck` (+e2e) | 0 |
| Tovu route tests (266 files: family + all `__tests__/routes` + touched + admin-json-route-ports + redirects-auth) | 2305 / 2367; **62 failures = identical set on the base worktree** (pilot head; Node 22 lacks `RegExp.escape` for real export/publish runs, compose/public-site drift); no new red |
| route-table pin | red at base and branch (7/10); diff vs base = only the 11 converted credential rows × 7 scenarios: handler label `forwardRejection` → `<anonymous>` (those routes were `asyncRoute`-wrapped; inherent to mounting a spec); every other row incl. all settings/sites/mail/deploy rows identical |
| `check:why-comments --base 582db5967 --other-root Jini` | ok — 31 blocks restored verbatim, the rest restored reworded-neutral or obsolete with per-id reasons (64 allow-listed) |

## Architecture audit — WARNING (recorded, not hidden)

1. Pin-row label change on the 11 credential routes (above) — no path/order change; the integrator regenerates the pin.
2. Sites gate-before-session order: config GET, home PUT, create, activate and the 5 lifecycle mounts answered the
   deployment-gate 403/409 before reading the session. With the corrected (opt-in) deferral, "no session + gate closed" now answers
   the redacted 500. Unreachable in the app (`requireAdminSession` runs first), no test pins it. Owner call: add
   `deferMissingPrincipal: true` on those 9 mounts (+2 pins); specs already run gate → authorize before any side effect.
3. Three Jini specs are tested and exported but not mounted (publish-credentials list, custom-credentials list/update) — ready
   once the admin ports carry the credential kind.
4. Tests-first deviations: settings and the publish-credentials/publish-site specs were written before their spec tests (tests
   written straight after; both mutations RED on both sides).
5. Owner decisions needed to convert the 41 STOPped registrations (all `admin-json-route-ports.ts` seams): an admin-ported
   `ServerRoute` mount (binary/SSE/headers), per-route response headers, route-owned refusal/404 bodies, the publish-trust and
   credential-kind context for specs, and per-phase/per-error failure copy.
6. `respondToSettingsError` and `touchesAssistantSubagents` (Tovu `routes/settings/shared.ts`) now have only test callers;
   removing them needs test rewrites beyond import repoints (STOP rule).

## Commits

All pushed with plain `git push` (`git pull --rebase` was blocked by in-flight subagent edits, so the remote was checked as
an ancestor before each push; nobody else pushed to these branches). Interim `wip:` snapshots were taken every ~10 minutes
while subagents worked, so some family commits are split across a wip commit and a later docs/feat commit.
- Jini `codex/rt-l2-system-jini`: `c32e7c3c1` `635205550` (wip) · `0e9904bdb` sites · `e07eb772c` docs · `0a9afb2c4` wip ·
  `c2371d7a3`… docs · `f63fe9251` deploy · `092b96137` mail-providers · `494df2373` assistant grants · `fc6648658` baseline ·
  `fb9c36ab1` why-comments · `38c67e96b` merge pilot · `59a692050` `438b0995a` `bb60a0c20` `14aac202d` migration · `bab419bb5` baselines · (report copy).
- Tovu `codex/rt-l2-system-tovu`: `0245be9266` (wip) · `cc7a469d8e` `1267c5da7a` `9cda2faf57` docs · `c54874d3de` credentials ·
  `36a826da3c` deploy · `a53f12848f` mail-providers · `e5ec814923` assistant grants · `2e9be3ae3f` imports · `fc1ebce5f4`
  why-comments · merge pilot · `a800d618a8` deferral pins · `efa7cfe987` (wip, migration) · `1269c4c2b8` debt · (this report).
