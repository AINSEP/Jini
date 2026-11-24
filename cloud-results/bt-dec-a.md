DONE 02bb606f22 240e3ea72 (code FIXED where files are free; every blocked part is listed as AFTER-MERGE below)

# bt-dec-a — owner YES decisions of 11-23 (bugs/todos batch)

- Branches: Tovu `codex/bt-dec-a-tovu`, Jini `codex/bt-dec-a-jini`. Bases: `origin/integ/merge-16-2026-11-23` on both repos, re-merged at the end (Tovu +2 and Jini +1 upstream commits, no conflicts).
- Programmer skills: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. The workflow followed it: red first, root cause, green, a named mutation for each fix, then architecture and pre-completion checks.
- Owner decisions source: `origin/plan/whats-left-1122:plans/owner-decisions-1123-bugs-todos.md` ("approve all recs").
- Method: the coordinator ran 4 Opus (high) subagents on disjoint files. None of them committed. The coordinator reviewed each diff, re-ran its tests, and committed each item separately.
- Files avoided: everything changed on `origin/codex/w3-*` against merge-15. That is 4,017 Tovu paths and 2,528 Jini paths, because the w3 lanes are moving mail, newsletter, scheduled-publish, api-keys and parts of site-assistant into Jini packages.

## Results

| item | status | commit | test (mutation) |
|---|---|---|---|
| 1 B229: permanent site delete also removes appData DBs | **FIXED** | Tovu `47a342341` | `site-dir/__tests__/integration/site-trash.integration.test.ts` "B229: …" (+12, 42 green). Mutations: `skip-appdata-db-removal`, `allow-unsafe-db-dir`, `ignore-live-owner` |
| 2a Sent-email records deleted after 30 days | **ALREADY ON BASE** | — | `features/mail/retention.ts` `MAIL_ACTIVITY_RETENTION_MS = 30d` (+ `retention.unit.test.ts`) |
| 2b Captured test emails 7 days + "clear all" (approval card) | **AFTER-MERGE** | — | — |
| 3 B176: consent guard only when consent is configured | **AFTER-MERGE** | — | — |
| 4 Visitor-chat replay safety (turn-ID dedupe) | **FIXED (client + port)**; route wiring **AFTER-MERGE** | Tovu `da1819105` | `assistant/site/__tests__/visitor-turn-dedupe.unit.test.ts` (12), `site-chat/src/__tests__/site-assistant-transport.turn-id.test.ts` (4), `public-errors.test.ts` (+1). Mutations: `dedupe-ignores-turn-id` (6/12 red), `client-omits-turn-id` (3/4 red) |
| 5 Kill-switch: pause only agent-created items + record creator | **FIXED for webhooks (Jini engine)**; Tovu migration/wiring and the newsletter, publish and API-key parts **AFTER-MERGE** | Jini `1c0118c6` | `integrations/src/webhooks/__tests__/delivery.agent-pause.test.ts` (5), `tools/__tests__/tool-registrations.test.ts` (+1), `core/src/primitives/__tests__/creator-kind.test.ts` (2). Mutations: `pause-ignores-creator`, `hold-burns-attempt` |
| 6 Desktop + self-hosted updates through SiteUpdatePort, same approval, never automatic | **FIXED (Jini adapters)**; Tovu desktop IPC and approval card **AFTER-MERGE** | Jini `fee3ac4b` (contract cherry-picked from `codex/todos-a-jini` 437e9a0fe), `2723fbb8` | `devops/src/deploy/site-update/__tests__/{desktop,self-hosted}-site-update.test.ts` (6 + 12; folder 71 green). Mutations: `desktop-auto-apply`, `selfhosted-skip-rollback`, `selfhosted-allow-moving-tag` |
| ledgers | done | Tovu `02bb606f22` | `development/todos.md` (4 rows), `development/open-bugs.md` (B229 FIXED entry; there was no prior B229 row) |

## What changed

### 1. B229 (deletes owner data, so it stays behind the existing confirm)
- `permanentlyDeleteTrashedSite` still refuses first without checkbox + confirm (`SITE_CONFIRM_REQUIRED`).
- It then resolves the site's DB paths with `reserveIdentity:false`, so a delete never writes the catalog.
- It classifies every path with the new `classifySiteDatabaseDir` (`site-databases.ts`). Only a real, non-symlinked direct child of `<appData>/databases/` is removed. Every other shape throws `SITE_PATH_UNSAFE` before anything is deleted: a symlink, the shared `databases/` folder, anything outside appData, nested folders, `..`.
- If a live catalog entry has the same siteId (for example a Finder copy), the DBs are kept.
- It deletes the folder first and the DBs second. If the second step fails, it leaves orphaned DBs rather than a restorable Trash entry with its data gone.
- Tests prove that sibling sites' DBs and the shared parent survive, and that an unconfirmed delete keeps the DBs.
- Only production caller: `composition/modules/sites.ts:140` (the Trash route). No sweep calls it.
- **Not done:** `site-registry.ts` `removeUncommittedSite` still uses its own removal. Switching it to the shared helper breaks pinned test `site-registry-branches.integration.test.ts:263`, which uses an older `<appData>/sites/<id>/content.db` layout. The owner or coordinator should confirm that no build ever saved that layout, then switch it.
- **Remaining risk:** suppose two *trashed* copies share one siteId and the original's catalog entry is already gone. Deleting one copy then removes the DBs the other trashed copy would restore with. Only live catalog owners are protected.

### 4. Visitor-chat dedupe
- The cited auto-retry (`transport.ts:302`) is **not on this base**. It came with `codex/visitor-chat-tovu` 758461edf, which combine-15 reverted in 06b872e64. Today the transport POSTs once.
- The turn ID is now minted once per message in `startRun` and kept in `RunArgs`, so the held `postChatWithOneRetry` sends the same ID when it is re-merged.
- The server port is in-memory: at most 10k entries, finished turns are refused for 10 min, a stuck in-flight turn is dropped after 30 min, and the oldest entry is evicted when full.
- A repeat gets a 409 `DUPLICATE_TURN` with a plain message. A server failure before the reply releases the ID so a retry can run. A request with no ID gets today's behaviour.
- The server already parses the body loosely (`site-assistant.ts:300`), so the new `turnId` field is safe before wiring.
- **Risks:** the store is per process (a restart fails open, as today), and the scope includes the client IP (a retry after a network switch is admitted).

### 5. Kill-switch (webhooks, Jini)
- `@jini-ai/core/primitives` gains `CreatorKind`, `resolveCreatorKind` and `isPausedByAgentSwitch`. Unknown or legacy values count as `person`, so nothing an owner made is ever paused.
- Subscriptions record `createdByKind`. The agent tool path writes `agent`; edits keep the existing value.
- `processDueDeliveries` takes an optional `isAgentEnabled()`. While it is off, agent-made deliveries are handed back to `pending` with their attempts restored and are re-checked every 60 s. They are never failed, dead-lettered or deleted, and the subscription stays `active`.

### 6. Site update adapters (Jini)
- `createDesktopSiteUpdate`: injected app-updater and site-migrate ports. Order is stage, migrate, swap. Verify checks the running version, then health. Rollback restores both app and data.
- `createSelfHostedSiteUpdate` and `imageTagForVersion`: the tag is derived from the release version only. `latest` and other moving tags are refused with an ERR- id in plain words. Rollback restores the previous tag.
- `checkForUpdate` and `planUpdate` never apply anything. Applying only happens through `runSiteUpdate`, with the owner's approval for that exact version.

## AFTER-MERGE (each needs a file a running w3 lane owns)

1. **Captured test emails 7 d + "clear all"** (w3-addons moves `features/mail/*` to Jini `packages/platform/src/mail/sql/`):
   - In `retention.ts`, set `MAIL_CAPTURE_RETENTION_MS` to `7 * 24 * 60 * 60_000` and update the header comment and the retention test boundary.
   - In `capture.repo.ts`, add `clearAllCaptured({ workspaceId })`.
   - Add an admin route plus a "Clear all captured emails" action behind the approval card. Pin it with a test that `mail_capture` empties while `mail_activity_attempts`, `mail_send_ledger` and suppressions survive.
2. **B176** (`features/newsletter/{subscriptions,confirmation,agent-tools,tool-registrations}.ts` and `admin-http/http/newsletter.ts` are changed by w3-pages-members, w3-addons, w3-fnd and w3-rtfnd):
   - Start from `cloud-results/combine-15-held/bugs-medium-B176-B201.patch` (on merge-15).
   - Invert its guard. `refuseUnboundConsent` must be a **no-op when no `MembersConsentCapability` is configured**, which keeps today's behaviour: tokens are issued and the email is sent. Enforce the consent request and confirm steps (and the 503 refusals) only when a capability is bound.
   - Keep the held patch's plain 503 confirm page for a bound-but-failing capability.
   - Tests: "unbound: subscribe issues a token and sends (today)"; "bound: refusal before the pending row is written".
3. **Visitor-chat route wiring**: in `composition/modules/site-assistant.ts` `handleChat`, right after `if (!preflight.ok) return;`:
   - Call `context.turnDedupe.admit({ scope: \`${workspaceId}|${clientIp}\`, turnId: readVisitorTurnId({ body: req.body }) })`.
   - On a refusal, return 409 `VISITOR_TURN_DUPLICATE_CODE`.
   - Add `res.once("close", () => admission.finish({ delivered: res.headersSent && res.statusCode < 500 }))`.
   - Create the dedupe in `createSiteAssistantContext` with `createVisitorTurnDedupe({ clock: deps.clock })`.
   - Add a route test: the same turnId gives 200 then 409 with one provider call.
   - Once `codex/visitor-chat-tovu` is re-merged, add a client test that a retry reuses the same turnId.
4. **Kill-switch remainder:**
   - (a) Jini `webhooks/sql/repo.rows.ts` and `sql/webhook-repo.ts`: map `created_by_kind`. Until this lands, Tovu's SQLite store drops the field, so agent-made webhooks still deliver while the assistant is off.
   - (b) Tovu migration `0043_creator_kind` (0043 is free: all w3 lanes top out at 0042). Add `created_by_kind text NOT NULL DEFAULT 'person'` to `webhook_subscriptions`, newsletter campaigns, scheduled publishes and `api_keys`. Wire it like 0042 (index, checksums, source-digests, fresh-content-db, generated types, both schemas). `schema.sqlite.ts` is w3.
   - (c) `composition/webhook-delivery-worker.ts`: pass `isAgentEnabled: () => isAdminAssistantEnabled(env)`.
   - (d) Newsletter `send-pipeline.ts`: skip claiming agent-made scheduled campaigns while the assistant is off, leaving them `scheduled`.
   - (e) Scheduled publish (Tovu `contracts/core/scheduled-publish.ts` and Jini `core/contracts/site/scheduled-publish.ts`): leave agent-scheduled items pending.
   - (f) API keys (`features/identity/api-key-*.ts`, `repo.authentication.ts`): reject agent-made keys with an ERR- error while the assistant is off. Never revoke or delete them.
5. **Site update, Tovu side:**
   - Desktop: wrap `apps/desktop/src/main/updates/desktop-updater.ts` (already `autoDownload=false`) as `DesktopAppUpdaterPort`. Add check/plan/approve IPC in `main/index.ts` and `preload.mts`.
   - Approval card: a new `apps/admin/src/features/deployment/SiteUpdateCard.tsx`, shared by every platform. Desktop Settings "Check for updates" opens that card.
   - Self-hosted: an `ImageTagPort` adapter next to `DockerfileTab.tsx`.
   - Desktop rollback needs the host to keep the previous installer (electron-updater does not keep it).
6. **Jini api-baseline**: `api-baseline/jini-ai__devops.json` is w3-owned. Run `pnpm api:update` after merge. `pnpm api:check` passes today; it only lists the new devops exports as advisory "added export".

## Gates (end state, after re-merging merge-16)

| gate | result | vs base |
|---|---|---|
| Jini build (`core`, `integrations`, `devops`, `cms`; full `pnpm -r build` at setup) | 0 | = |
| Jini `pnpm typecheck` | 0 (0 `error TS`) | = |
| Jini `pnpm guard` | 1 violation: `HW3-module-state packages/admin/src/shell/lib/shell-failure-log.ts` | **pre-existing** (file untouched; last changed in f527535e3 on base) |
| Jini vitest: devops site-update 71/71, integrations webhooks 157/157, core creator-kind 2/2; full packages run by subagents (devops 1454, integrations 2110, core 3027) all green | green | = |
| Tovu `tsc -p tsconfig.json --noEmit` | 0 errors (base: 0) | = |
| Tovu node:test, the 4 changed test files plus 40 importers of `site-trash` / `site-databases` / `public-errors` | 494/497 | the 3 reds also fail on the untouched base worktree: `serve-command-wiring.unit` ("passes the resolved host into app.listen"), `production-readiness-boot.integration` ("BR-07 shutdown…", "AC-23/24/REQ-12 … inventory") |
| Tovu webhook tests vs rebuilt Jini (kill-switch subagent) | 501/507 | the 6 reds are the same with the Jini change swapped out (pre-existing) |

## Owner / coordinator must check locally
- Pre-existing `apps/site-chat/src/__tests__/site-assistant-transport.test.ts` fails to load ("Incompatible React versions") on base, so the old transport suite was not re-run in the cloud. Run it locally.
- Desktop and self-hosted updates have no Tovu UI yet. Nothing changes for owners until AFTER-MERGE item 5 lands.

## Commits
- Tovu `codex/bt-dec-a-tovu`: `da1819105` (visitor dedupe), `47a342341` (B229), `0cbb9ecc2f` (merge merge-16), `02bb606f22` (ledgers), plus this report.
- Jini `codex/bt-dec-a-jini`: `fee3ac4b` (SiteUpdatePort contract cherry-pick), `2723fbb8` (adapters), `1c0118c6` (webhook kill-switch), `240e3ea72` (merge merge-16).
