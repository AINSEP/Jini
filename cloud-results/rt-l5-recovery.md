PARTIAL fbfd95f988 a0c983e999: publish-content (12 files / 19 regs left, all STOP: host-port context or non-JSON), plugins (4 files / 6 regs left, STOP: non-JSON or host-port context)

# K1 route families — L5 recovery + L6 publish (2026-11-23, unattended)

Branches: Tovu `codex/rt-l5-recovery-tovu` (base `origin/codex/k1-pilot-tovu`), Jini `codex/rt-l5-recovery-jini`
(base `origin/codex/k1-pilot-jini`). Jini linked into Tovu (`link-jini.mjs`), `packages/sdk` built.
Bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. I followed its
tests-first slice loop, architecture audit and pre-completion checklist. No codebase-memory tools were used.
Template: `plans/K1-route-template.md` (§2-7) and the Menus pilot code.
Method: I coordinated and wrote L5 myself. Four Opus subagents did the rest: plugins, publish-content
transport, publish-content import/export, and plugins set-enabled. They used disjoint files and made no
commits. I reviewed each diff against the §7 checklist and committed per family.

**Overlap check.** The `origin/codex/ex6-*` and `ex7-*` heads touch only import lines in publish-content
and plugins files. Nothing in these families was converted or deleted there, so no family was skipped. No
other `codex/rt-*` heads exist. Expect merge conflicts on those import lines (ex7-deploy-desktop,
ex6-fnd-shared-a, ex7-settings-sec).

## Per family

| family | routes converted / total | Tovu files deleted | stays (why) |
|---|---|---|---|
| database-recovery | type only (0 regs) | `database-recovery/deps.ts`. `DatabaseRecoveryRouteDeps` moved into `modules/database-recovery.ts` (host bag, template "Departures") | none |
| recovery | 4/4 (status; restore plan/confirm/execute) | `recovery/status.ts`, `recovery/restore.ts` | none |
| database | 3/3 (migrate-forward plan/confirm/execute) | `database/migrate-forward.ts` | none |
| publish-content | 7/26 (peers 4, destination 3), plus the report DTO and apply-report helpers moved | `peers.ts`, `destination.ts`, `report-dto.ts`, `apply-report.ts` | see below |
| plugins | 6/12 (list, files, uninstall, preview GET+POST, set-enabled) | `deps.ts`, `list.ts`, `files.ts`, `uninstall.ts`, `preview.ts`, `set-enabled.ts` | see below |

**Files left in Tovu** (counted by `plans/P9-data/tools/scan.mjs`): 8512 → 8502. 14 files were deleted.
4 were added: 3 composition modules and 1 wire test. Family dirs: recovery, database and
database-recovery are now empty. publish-content went from 16 files / 26 regs to 12 / 19. plugins went from
10 / 12 to 4 / 6.

### Stays, each a STOP condition
- **Host-port change needed in `admin-json-route-ports.ts`:** these routes read `res.locals.authCredentialKind`
  (`rejectUnlessSessionCredential`, `gatedPrincipalKindFor`) or the publish-trust grant
  (`getPublishTrustContext`). The `authenticate` port exposes neither to a spec.
  - publish-content `import.ts` (4), `backstop.ts` (5), `bundle-create.ts` (1, also has its own body cap),
    `capabilities.ts` (1), `peer-transport.ts` (4)
  - plugins `provider-settings.ts` (3)
  - Proposed port change, owner decision: the authenticate context also carries `credentialKind` and the
    request's publish-trust grant.
- **Non-JSON:**
  - publish-content `export.ts` streams with `res.write` and also reads publish-trust.
  - `blob-get.ts` is a binary download. `blob-put.ts` is a raw-body upload with its own 413.
  - plugins `install.ts` takes `express.raw` zip uploads. `chart-providers.ts` sends bytes, sets
    Cache-Control and uses an `app.use` guard.
- **413 body differs (template §4.4, raise):** publish-content `blobs-probe.ts` answers
  `{error:"Content too large to save.",code:"PAYLOAD_TOO_LARGE"}` before the workspace 404. That differs
  from http-kit's core envelope.
- **Not moved:**
  - `import-errors.ts`: its direct tests call `importErrorResponse({err})`, so moving it needs more than
    import repoints.
  - `route-helpers.ts` and `deps.ts`: still used by the routes that stay.
  - `local-installer.ts`: reads `process.env`, so it stays host-side and is injected as
    `localInstallAvailable`.
- **plugin-hook-error:** L1 has not moved it on this base. The Tovu helper stays and is injected
  (`pluginHookFailedBody`) into plugins preview. publish-content `import-errors.ts` stays, so it needed no
  injection.

## Jini (`@jini-ai/cms`)

**Recovery and database specs:**
- `admin-http/routes/recovery/status.ts`: `RecoveryStatusRouteDeps {workspaceId, dbOps, siteStatusRepo, isOperationInFlight, resolveDegradedBanner}`
- `admin-http/routes/recovery/restore.ts`, three specs:
  - plan: `{planRestore}`
  - confirm: `{confirmRestore}`
  - execute: `{authorizeRestoreExecution, executeRestore}`
  - all three also take `missingPrincipalMessage`
  - The ceremony code → status table and the AUD-001 pre-check (403 NOT_AUTHORIZED + details) live in the spec.
- `admin-http/routes/database/migrate-forward.ts`, three specs:
  - plan: `planMigrateForward`; confirm: `confirmMigrateForward`; execute: `authorizeMigrateForward` + `executeMigrateForward`
  - all take `migrateForwardErrors` (the two db classes, injected) and `missingPrincipalMessage`
  - The six-rung `instanceof` ladder lives in the spec. The core gated-mutation errors come from `@jini-ai/core/gated-mutations`.

**Publish-content specs:**
- `admin-http/routes/publish-content/{peers,destination,transport-shared}.ts`
- `admin-http/http/publish-content.ts`: report DTOs moved verbatim. The planner report is typed structurally.

**Plugins specs:**
- `admin-http/routes/plugins/{shared,list,files,uninstall,preview,set-enabled}.ts`. cms does not import `@jini-ai/plugins`.
- set-enabled runs the cms `executeCommand` gateway with an injected raw `authorizeCommand` and 8 injected error classes.

**Package and docs:**
- Exports triple, `jini.entries` universal, and isolation domains (`publish`, `core`) for each new entry.
- 4 changesets: `cms-recovery-route-specs`, `cms-database-migrate-forward-route-specs`, `cms-publish-content-route-specs`, `cms-plugins-route-specs`.
- API baseline regenerated. `## Wiring` updated in `packages/cms/README.md`.

## Tovu
- **New composition modules:**
  - `modules/recovery-restore.ts` and `modules/database-migrate-forward.ts`. They bind the gateway,
    hooks, operation lock and db orchestrator per request and mount `"direct"`.
  - `modules/publish-content-transport.ts`. Its registrars are mounted `"guarded"`.
- **Extended modules:**
  - `modules/database-recovery.ts`: the status registrar, plus the `DatabaseRecoveryRouteDeps` type.
  - `modules/plugins.ts`: list/files/uninstall/preview are `"guarded"`; set-enabled is `"direct"`.
- **Unchanged:**
  - Every `register…Route` name and the registration order.
  - Every `failure.operation` string, copied verbatim. migrate-forward had no options and still mounts without `failure`.
- **Tests:** all repoints are import lines only, with two exceptions where a Tovu helper moved into a spec.
  Each was replaced by a wire test through the registrar:
  - `sendRecoveryError` "message-less payload falls back to its code" → new
    `__tests__/routes/recovery-restore-message-fallback.test.ts`. It uses `mock.module` on the orchestrator,
    because no real binding produces a message-less payload.
  - `sendRecoveryError` "Result error has the private 500 envelope" → rewritten inside
    `unexpected-route-errors.test.ts`, as a real plan request whose gateway returns an INTERNAL_ERROR Result.
- **Docs and debt:** `## Wiring` updated in `apps/website/src/server/INFO.md`.
  `development/why-comments-debt.json` gained ids only, for blocks that moved to Jini or became obsolete.
  `check:why-comments --base <merge-base>` reports ok.

## Tests and gates (fresh evidence on the final heads)

| gate | result |
|---|---|
| Jini `pnpm guard` | 0 |
| Jini `pnpm api:check` | 0 (40 packages, 787 entries) |
| Jini `pnpm typecheck` | 0 |
| Jini `pnpm --filter @jini-ai/cms build` | 0 (the full `pnpm -r build` ran at setup) |
| Jini cms `src/admin-http` vitest | 283/283, 36 files. New spec tests: recovery status 8, restore 23+, migrate-forward 17, publish-content peers 12 / destination 10 / DTO 12, plugins 59 |
| Tovu `npm run typecheck` (incl. e2e) | 0 |
| Tovu route sweep, 109 files (all touched families, ports, modules, publish-*, plugins, unexpected-route-errors) | 909/914. All 5 failures are pre-existing or flaky: 4 fail identically on base (`publish-site-route` ×3, `assistant-byok` preflight); 1 backstop pin failed only under full-sweep load and passes on re-run on both base and branch |
| L5 family set (12 files) | base 127/127 → after 132/132 |
| Family baselines (subagents) | transport 169/169, import/export 128/128, plugins 131/131, set-enabled set 135/135; identical before and after |
| `create-app-route-table.pin.test.ts` | red on base and branch, identical: 5,703 diff lines, 3 pass / 7 fail, the known `/internal` drift; 0-line diff base vs branch |
| `check:why-comments` | ok |
| `check:complexity` | ok (0) |
| `check:size` | no violations in touched files (the existing ones are base) |

### Mutations (template §5)
Each mutation was restored by byte copy with `cmp` clean, then rebuilt and confirmed green.

| route | mutation | Jini RED | Tovu RED | Tovu tests that went RED |
|---|---|---|---|---|
| recovery restore | M1: plan accepts a non-string `restorePointId` | 3 | 2 | body-less 400; missing-field 400 |
| recovery restore | M2: execute AUD-001 pre-check dropped | 2 | 3 | AUD-001 ×2, instance-scope |
| publish-content destination | M1: connect accepts a bad URL | 1 | 1 | |
| publish-content peers | M2: DUPLICATE_LABEL rung dropped | 1 | 2 | |
| publish-content peers | M2a: PATCH full-replace | 1 | 0 | no Tovu wire test pins this; gap noted |
| plugins preview | M1: malformed draft accepted | 9 | 1 | |
| plugins preview | M2: not-enabled 409 dropped | 1 | 2 | |
| plugins set-enabled | M1 | 6 | 2 | |
| plugins set-enabled | M2: approval not recorded | 1 | 1 | |
| publish-content DTO | M2a | 1 | 3 | |
| publish-content DTO | M2b | 1 | 1 | |

## Deviations and risks (recorded, not silently changed)

**Mount mode.**
- restore and migrate-forward mount `"direct"`. The hand-written routes never called `deps.authorize`, because
  the gateway authorizes, so the port is never called.
- set-enabled mounts `"direct"`. `executeCommand` asks the raw `deps.authorize` with the `plugin-activation`
  entity.

**Body checks.** The ceremony routes and destination/preview validate in `handle`, after the principal or
authorize, not in `parse`. That keeps the hand-written order (500/403 before 400); `parse` is total. This
follows the existing `recovery/disclosure` precedent.

**Unmapped restore codes.** A restore Result code that is not mapped is rethrown. The host 500 then carries
`code: "INTERNAL_ERROR"`, where the old route used the payload's code. The only reachable unmapped code today
is `INTERNAL_ERROR` (`toRecoveryResult`'s closed set), so the wire is identical.

**`entityType`.** Core's authorize port requires an `entityType`. The plugins and publish-content
registrars strip `entityType`/`entityId` before `deps.authorize`, because the hand-written routes never sent
one and tests pin the exact params.

**Missing-session message.** `missingPrincipalMessage` is a host copy dep, bound to `getAuthedPrincipal`'s
text, because a wire test pins the redacted log diagnosis for a missing session.

**Peer DELETE 204.** It is now written as `res.status(204).json(undefined)`; Express strips the body.

**Commit leak.** My first L5 Tovu commit `0fd01c917f` swept up a subagent's staged `git rm` of
`report-dto.ts` / `apply-report.ts`. Their repoints landed in `4b4e2eb477`, so `0fd01c917f` alone does not
typecheck; every later head does.

**Jini `package.json`.** Commit `b1eadab58` also carried the publish-content DTO entries early. A duplicate
key that followed was removed in `525f07eff`.

**Stale comments** naming deleted plugin paths remain in files outside the families:
- `features/site-inspection/site-profile.ts:92`
- `server/routes/types.ts:997`
- `routes/agent-plugins/deps.ts:9`
- `routes/skills/list.ts:15`

## Commits (all pushed with plain `git push`; remote did not move during the run)

**Jini `codex/rt-l5-recovery-jini`:**
1ce7c99d6, b1eadab58, 1e6c67792, 9f6960c7f, 525f07eff, 2bf9c237d, d49b1a0d3, 1a2a0aae1, 525fb5742, a0c983e99

**Tovu `codex/rt-l5-recovery-tovu`:**
0fd01c917f, d11711b82e, 4b4e2eb477, d51f6badde, d13d8abe15, f1939b2798, 05ce9605b2, 8e577c30d6, fbfd95f988, plus this report.
