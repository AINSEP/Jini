DONE 59b2f0206 79ed2bc3 — everything this lane could do on these bases is done. The rest is AFTER-COMBINE (in-flight files), NEEDS-OWNER, or UNVERIFIABLE-IN-CLOUD; see the table.

# Todos lane B — 2026-11-23 (cloud, unattended)

**Scope:** the second half of the OPEN groups in `origin/plan/whats-left-1122:inputs/todos-triage.md` → "OPEN, grouped for planning". Groups 1 and 2 go to the P9 and P6 lanes. Group 14 is parked. So the active groups are 3–13, and this lane took **8, 9, 10, 11, 12 and 13**. Group 7 has no code; its questions are listed again below so the owner sees them in one place. The step ids (P10-H1 and so on) come from `origin/plan/whats-left-1122:plans/P10-todos.md`. That plan covers these same groups.

**Programmer bootstrap:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before starting. I followed its rules: a failing test first, then the fix, then green, then a mutation; an architecture audit; a check before claiming done.

**Bases:**
- Jini `origin/integ/merge-14-2026-11-22` @ `4902a6a1`, on branch `codex/todos-b-jini`.
- Tovu `origin/integ/merge-13-2026-11-22` @ `f7185f15`, on branch `codex/todos-b-tovu`.
- Tovu is linked to this Jini checkout (`link-jini.mjs`, 82 links). `@tovu/sdk` and `packages/contracts` were built first.

**In-flight branches avoided:** I diffed each of these against its merge-base: `codex/ex6-*`, `ex7-*`, `p12-*`, `bugs-high-*`, `bugs-medium-*`, `visitor-chat-tovu`, `p11-next-*`. That gives 1,177 Jini paths and 2,406 Tovu paths. No edit touched any of them. Items that need one of them are marked AFTER-COMBINE.

## Results

| item | status | commit | test name |
|---|---|---|---|
| G11 · P10-H1 Validate tool OUTPUT schema (Jini) | FIXED | Jini `e2def4fb` + `80bec0e7` (WIP checkpoints that hold the whole change) | daemon `tool-executor.output-schema.test.ts`: «a tool returning the wrong shape fails in enforce mode», «log mode passes the result through and reports the mismatch once», «a tool without outputSchema is unchanged», «enforce is the default when the host chooses nothing»; stack «a wrong-shaped tool output fails through the assembled stack in plain words with an error id». RED first: 3 failed, 2 passed. Mutation "skip validation" turns them red. |
| G11 · P10-H2 Actor kind on every mutation and outbox event (Jini half) | FIXED | Jini `80bec0e7` (contract + db row) and `79ed2bc3` (cms stamps it) | db «a change set round-trips its actor kind», «a change set without actor kind reads back undefined», «a host table not yet migrated to actor_kind still accepts change sets that carry no actor kind» (sqlite + postgres); cms «an agent's command stamps actor kind agent on its change set and event». RED first: 8/16 in db, 3 in cms. Mutations "drop the write" and "drop the stamp" both turn red. |
| G11 · P10-H2 (Tovu half: `change_sets.actor_kind` migration + witness) | FIXED | Tovu `b7eb1a7dc` (WIP) + `c3c6626c7` | «an assistant (agent-tool) post create persists a change set and outbox event whose actor kind reads back 'agent'» and «a human admin post create … reads back 'user'». Both run the real handler and route over a migrated SQLite `change_sets` and `outbox_events`. Also «actorKind round-trips through change_sets.actor_kind». RED first: `table change_sets has no column named actor_kind`. Mutations: no column → red; agent stamped as user → red. Migration step **0043** (ADR-066 TS step; the Drizzle chain is frozen) adds a nullable `actor_kind` with no backfill. **Left:** post-trash, post-retire, the widget routes and delete-user build a bare `{ principalId }` actor outside `executeCommand`, so they don't record a kind yet. |
| G11 · P10-H3 Two-sided read-only conformance test | ALREADY-FIXED in Jini (`packages/daemon/src/__tests__/read-only-tools.test.ts:20`). Tovu test ADDED. | Tovu `86da6a6d4` (WIP checkpoint that holds the test) | Tovu `read-only-tool-constraint.composition.test.ts` «a read-only principal neither sees nor can invoke write tools». It goes through the production listing pair `buildToolCatalogQuery` + `filterReadOnlyToolCatalog` (`byok-tool-surface.ts:685`). It passed at once, as a conformance test should. The mutation "unconstrained listing" turns it red. |
| G11 · P10-H6 Event-handler idempotency policy (Jini) | FIXED (code + policy); package export is AFTER-COMBINE | Jini `e2def4fb` + `80bec0e7` | infra `processed-event-guard.test.ts`: «a redelivered event runs the handler once», «a failed handler run can be retried», «different handlers each run once for the same event», «a failed release reports both the handler failure and the stuck claim». RED first: 4/4. Mutations "skip claim" and "skip release" both turn red. **Left:** the one-line `export * from './processed-event-guard.js'` in `packages/infra/src/events/outbox/index.ts` and a README section. Both files are on an in-flight branch. Until that line lands, hosts cannot import the guard. |
| G11 · P10-H4 Kill-switch completeness | NEEDS-OWNER and AFTER P3 | – | **Verified open.** `TOVU_ADMIN_ASSISTANT=off` (`admin-assistant-enabled.ts:28`) only skips the routes and the daemon. Webhook subscriptions, scheduled newsletter campaigns, scheduled publishes and API keys keep running, and none of them records whether a person or the agent created it. **Question:** when the assistant is turned off, should things the agent created stop too? **Recommend:** yes. Add a `created_by_kind` column (the same `ActorKind` as H2) to those tables and to P3 routines. Turning the assistant off pauses the agent-created ones. Turning them back on needs an approval card. Build after P3, as the plan says. |
| G11 · P10-H5 Per-principal discriminator and cache keys | AFTER-COMBINE | – | `packages/daemon/src/http/tool-catalog.ts` is on an in-flight branch. |
| G10 · P10-U1 Site-update contract (Jini) | FIXED | Jini `cec5df2f` (+ the first files in `e2def4fb`) | devops `site-update/__tests__/fake.test.ts` runs the reusable `siteUpdateContractSuite` (19 cases). It covers: never auto-update (an approval naming that exact plan is required); backup first; a failed readiness check never deploys; a failed deploy or verify rolls back (`rolled_back` / `rollback_failed`); plain ERR- messages. During review I added «refuses a rollback without a person approving that version, and changes nothing»: a rollback replaces the live site, so it needs an approval card too. That test was red first. The mutations "readiness gate off" and "rollback approval off" both turn red. |
| G10 · P10-U2 "Update available" in the admin + `site_update_check` tool | AFTER-COMBINE | – | It needs U1 in a Jini release, plus the admin notice UI. A UI pass is scheduled after the lanes. |
| G10 · P10-U3 One-approval update flow | AFTER-COMBINE | – | Waits on U1/U2. It uses deploy-ops and site-backup, which are touched by `ex7-deploy-desktop-*`. |
| G10 · P10-U4 Desktop and self-hosted path | NEEDS-OWNER (G7-11) | – | **Question:** should the desktop app update itself and migrate the site, and should self-hosted sites bump the image tag, both through the same port? **Recommend:** yes, through the same `SiteUpdatePort` with a local adapter, and never automatically. |
| G12 · P10-C1 Per-CLI `defs/<cli>.ts` → `defs/<cli>/index.ts` | AFTER-COMBINE | – | Verified open. Four of the files are already one-line shells: `amp.ts`, `amr.ts`, `codebuddy.ts`, `hermes.ts`. The move would break the path-keyed debt ratchets in `scripts/error-gate-debt.json` (`defs/pi.ts`) and `scripts/hardwiring-debt.json` (`defs/reasonix.ts`). Both files are on in-flight branches. Also update `scripts/check-model-fallback-freshness.ts:117-153` and `scripts/env-access-debt.json:13-34`. Baseline for the retry: `src/defs` has 42 files and 631 tests, all green; `pnpm guard` is green. |
| G12 · P10-C2 xAI (`grok`) → provider plugin | NEEDS-OWNER | – | The plan itself says STOP. **Question:** move only the media provider entries (`integrations/src/media-providers/providers.ts:52,102`), or also the 47 KB `daemon/src/http/xai.ts` chat/BYOK path? **Recommend:** do the media entries first ("read old id, write new"). Plan `xai.ts` with the P9 XC-4 row, which already marks it "due to move". |
| G8.1 Cookie-consent thorough test | UNVERIFIABLE-IN-CLOUD | – | Needs Chrome on the owner's localhost (plan: "Opus + Chrome on the owner's localhost"). |
| G8.2 Attachment preview modal shows a decoded image | UNVERIFIABLE-IN-CLOUD | – | Same reason. |
| G8.3 AssistantDock mode/model save failure → 5 s toast | AFTER-COMBINE (verified open) | – | When the mode/model pick (`hooks/local-cli-selection.hooks.ts:44`) fails to save, it only logs `[AssistantDock] failed to save Local CLI selection`. No toast appears. Display, plugin and runtime saves do show a lasting "Couldn't save" header notice, but not a 5-second toast. `local-cli-selection.hooks.ts` and `AssistantDock.state.hooks.ts` are on an in-flight branch. |
| G8.4 Gemini chat re-check | UNVERIFIABLE-IN-CLOUD | – | Needs a live Gemini key in the owner's localhost. |
| G8.5 Tool-call screenshot deadline / Chrome tab collisions | UNVERIFIABLE-IN-CLOUD | – | Needs live Chrome. |
| G9 Production email (tovu.dev provider, Resend key, sender/domain) | NEEDS-OWNER (owner-gated, skipped by rule) | – | This is a production action for the owner. The owner said on 11-21 to skip it. |
| G13 End of refactor (coverage, 10% test-quality sample, Stryker, fuzz tests, performance budgets) | NEEDS-OWNER (the owner runs it last; P7-C) | – | Not started, by the owner's rule. |
| G7 Owner decision batch (13 questions) | NEEDS-OWNER | – | See below. I re-checked three of them on this base: trash retention is still `TRASH_RETENTION_DAYS = 60` (`features/trash/ports.ts:33`); the new-site password still comes from `DEFAULT_OWNER_PASSWORD` (`identity/default-credential-exposure.ts:40`); the `<<SUBAGENT_DISPATCH>>` prefix is still added (`agent-daemon-run-start.ts:378`). |

### Group 7 questions, with recommendations (from P10-todos)
1. New-site password: keep the desktop default; server sites ask for a password at setup.
2. Dev CORS: off outside dev; an explicit allow-list only.
3. Menu-widget HTML mode: require `pages.edit_html`.
4. Trash retention: 30 days instead of 60.
5. Q-M2: decide it together with the media single-limit step.
6. Delete sent-email records after 30 days: yes.
7. Delete test emails automatically: yes, after 7 days.
8. Pages rendered before consent: never cache them when tracking scripts are on the page.
9. Captions: an optional caption file on media, rendered when present.
10. The 4 handlers whose catch blocks await: fix them in the P4-T4 sheet.
11. The `<<SUBAGENT_DISPATCH>>` prefix: add it only when the site folder has AI-Dev-Shop `AGENTS.md`.
12. Theme `/` layout: park it until the owner designs it.
13. Page tagging after save: run it only when the owner asks.

## Review notes (coordinator)
- **H1.** The input side never checks shape: `normalizeToolInput` coerces values instead. So the daemon has a small checker with no new dependency, `tool-executor-output-schema.ts` (121 lines, every function ≤ 80 lines). It covers type, enum, required, properties, `additionalProperties:false` and items, and ignores any other keyword. `@jini-ai/cms` widget `config-validation.ts` has a similar subset; merging the two into core is a candidate for the duplication pass. The default is `'enforce'`. No tool declares `outputSchema` yet, so nothing changes today. `packages/server/src/kernel-base.ts:245` takes the default; a host that wants `'log'` in production passes it there. **MCP `outputSchema` publishing is NOT done.** The MCP spec then requires `structuredContent`, and the delegated gateway returns text only.
- **H2.** I did not reuse `PrincipalKind` because it includes `api_key`, which says what credential was used, not who acted. The new closed type is `ActorKind = 'user'|'agent'|'system'`.
- **U1.** The fake is not exported. Only one export line in `deploy/index.ts` was allowed, and `packages/devops/package.json` is on an in-flight branch.
- **API baseline:** `pnpm api:check` exits 0. It reports additions (`ActorKind`, `SiteUpdate*`) and changed exports (`ToolDescriptor`, `DomainEvent`, `ChangeSetRecord`, `ChangeSetsTable`, `createToolExecutor` options, `AssistantToolExecutorDeps`). I did not run `pnpm api:update`, because it rewrites every package's baseline. Run it in combine-15.
- **Commits per item:** under the "commit every 5–10 min" rule, two WIP checkpoints (`e2def4fb`, `80bec0e7`) were taken while the subagents were still editing. They hold H1, H6 and the H2 contract/db part. Separate item commits are `cec5df2f` (U1) and `79ed2bc3` (H2 cms).

## Gates (base → tip, no new red)
- **Jini base** (unmodified tree, measured by the batch-1 agent before any edit): `pnpm guard` exit 0. agent-runtime `src/defs` 631/631.
- **Jini tip:**
  - `pnpm guard` 0: zero violations, self-test passed.
  - `pnpm typecheck` 0: 0 `error TS`.
  - `pnpm api:check` 0.
  - Rebuilt packages, all exit 0: core, db, infra, cms, daemon, devops.
- **Jini changed vitest:**
  - core tool-registry 28/28
  - daemon tool-executor + tool-recovery + read-only 301/301
  - infra outbox 149/149
  - db events 31/31
  - cms commands 27/27
  - devops deploy 241/241
- **Full suites (daemon, server, mcp, cms):** daemon 4873 ✓ (1 skipped); server 469 ✓; mcp 1885 ✓; cms 5020 ✓ and 2 ✗. Neither cms failure comes from this lane. `create-tables.reference` timed out under load and passes alone (2/2). `forms/package-boundary` fails because the changelog says 0.7.2 and the package says 0.7.3-next.2; this lane did not touch those files.
- **Tovu base:** `npm run typecheck` 0 (0 `error TS`, after the `@tovu/sdk` build).
- **Tovu tip:** `npm run typecheck` 0, with 0 `error TS`. `tsc -p tsconfig.tests.json` 0. I ran node tests file by file on base and tip over the changed areas and their importers: `platform/db/{migrations,sqlite,.}/__tests__`, `features/post/__tests__` and the read-only test, 187 files in all. **Base: 1615 pass, 37 fail. Tip: 1620 pass, 36 fail.** The only differences are new or extra passing tests, plus one base red (`change-set-repo.sqlite`, which runs against the linked Jini mapper) that is now green. Every remaining red is also red on base, for example `checksums.test.ts`: the 0002/0012 digests also mismatch on the untouched base. Postgres-only tests can't run here because there is no server.
