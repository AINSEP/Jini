PARTIAL 9b4bc1dceb f2a965472: 1 owned file held for an owner decision (contracts/core/extension-capability-vocabulary.ts, STOP 5); the other 163 are decided (37 moved/deleted, 15 thinned, 111 STAYS-HOST)

# w4-runtime (2026-11-24): server runtime + contracts + CLI lane

Unattended cloud run, Opus coordinator. I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Its root-cause-first, fresh-evidence and pre-completion rules applied to every batch, and the coordinator reviewed each diff and committed it.

- **Bases:** Jini `origin/integ/merge-16-2026-11-23` = `7490405a8`; Tovu `origin/integ/merge-16-2026-11-23` = `3a93322474`. merge-16 was re-fetched before the final push and had not moved (0 new commits), so there was nothing to merge.
- **Branches:** Jini `codex/w4-runtime-jini`, Tovu `codex/w4-runtime-tovu`. Plain `git push`; no force-push, no `--no-verify`, no tags/publish, no codebase-memory tools, and no other branch was touched.
- **Setup:**
  - Jini: `pnpm install --frozen-lockfile` and `pnpm -r build`, both 0 with 0 `error TS`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat (0/0/0/0); `link-jini.mjs` pointed at the Jini checkout; `packages/contracts` and `packages/sdk` built.
  - Node 22.23.5.
- **Base attribution:** clean worktrees at both bases (`jbase` with its own install and build; `tbase` linked to `jbase`). Every gate and every non-clean test was re-run there.
- **Owned files:** all 164 in `origin/plan/whats-left-1122:inputs/w4/runtime.txt` have a decision. "Moved" counts files deleted from `apps/website`, either moved to Jini/`@tovu/contracts` or deleted as forwarders after importers were repointed.
  - 37 moved or deleted.
  - 15 thinned: the generic part is in Jini and the host binding stays.
  - 111 STAYS-HOST (host wiring or product policy).
  - 1 LEFT for an owner decision.

## Batches

| batch | model | files moved / deleted (Tovu) | thinned | importers repointed | tests (Jini · Tovu) | status |
|---|---|---|---|---|---|---|
| B1a contracts events + barrels | Opus | `contracts/core/{index,events/index,events/memory-bus,events/jini-outbox-adapter,events/enqueue-only-outbox,commands/index,commands/appliers,admin-locales,secret-redaction}.ts` → `@jini-ai/infra/events/{memory-bus,domain-outbox}`, cms commands, `@tovu/contracts` | `events/outbox-worker.ts` (retry policy injected into infra `processDomainOutbox`) | 213 | infra 163/163 (+16 moved) · 159/159 + base-equal outbox files | done |
| B1b contracts rest | Opus | `model-facing-tool-errors` (→ core), `plugin-hook-failed-error` (→ `@jini-ai/plugins/host/hook-refusals`), `tool-access-change` (type → core, error → daemon); `widget-tables`, `redirect-tables`, `publish-history-list-limit`, `fs-folder-recovery`, `assistant-content-guidance`, `export-report` → `@tovu/contracts` | `gated-mutations/token`, `tool-failure-diagnostics`, `plugin-credential-card` (re-exports dropped) | ~120 | plugins 7/7, core · 157/158 (1 base-red) | done |
| B2 boot/lifecycle | Opus | `boot/{parent-watchdog,boot-listener,plugin-sdk-resolver}`, `lifecycle/{await-boot-work,close-store-on-shutdown}`, `memory-deps/lazy-proxy` → sidecar, devops `local-dev`, server `./shutdown`, `./shutdown/boot-work`, core `primitives` | — | 18 | 26 Jini · resolver 7/7, sqlite-shutdown 4/4 | done |
| B2b bind-host + idle park | Opus | `boot/bind-host.ts` → devops `local-dev` (label + error factory injected) | `lifecycle/site-idle-park.ts` → server `./shutdown/idle-park` | 9 | 16 + 12 Jini · 7/7, 11/11, 45/45, 27/27 | done |
| B3 assistant modules | Opus | `run-finalizer/{checkpoint-policy,ports,release-body,report}` → chat `./core/durable-runs/run-finalizer`; `jini-agents.ts` (dead adapter) | `lifecycle/agent-daemon-port.ts` → sidecar `./daemon-origin` | 8 | chat 38/38, sidecar 17 new · 180/182 (2 base-red) | done |
| B4 CLI + composition classification | Sonnet | — | `cli/commands/import-local.ts` (P13-C3: `@jini-ai/cli` `request-fields` + `parsePortValue`) | 0 | cli 619/619 (36 new), mutation · import-local 26/26 | done |
| B5b composition helpers | Opus | `vault-legacy-codecs` → platform `./secrets/legacy-codecs`; `plugin-activation-polling` → plugins host; `commerce-origin`, `commerce-settings` → commerce | `commerce-drain` (forwarder line removed), `vault-boot` (owner key injected) | 14 | 5+12+11 Jini · 84/84 | done |
| B6 worker + park recovery | Opus | — | `plugin-tier2/run-in-worker.ts` → sandbox `./node-worker/per-call-runner`; `lifecycle/daemon-demand-fetch.ts` → sidecar `./daemon-park-recovery` | 0 (signatures kept) | 14 + 5 Jini, 2 mutations · 35/35 | done |
| B7 composition follow-ups | Opus | `domain-binding-sweeper` → devops `dns`; `browser-diagnostics` → diagnostics `./browser-diagnostics`; `memory-deps/ports.ts` → core `Clock`/`IdGenerator` | `database-transfer-adapters` (`captureSqliteBackupBytes` → db `transfer`) | 13 | 7+27+2 Jini · 3/3 + base-equal faults file | done |
| B8 gate-row fixes | Opus | — (core contract type-only; `ToolAccessLoweringError` → daemon; 2 Tovu re-export lines removed) | — | 20 | daemon 8, devops 123, plugins 12, server 27, chat 38 · 43/51 (8 base-cancelled) | done |
| B9 product events | Opus | — | `composition/product-events.ts` → analytics `./product` projector (catalog injected) | 0 | analytics 8 new, mutation · 19/19, desktop 3/3 | done |
| coordinator | Opus | `deps.ts` site-path re-export and `store-bound-services.ts` type re-export removed; hook-refusals turned into object args; 2 test harnesses repointed; stale error-gate debt rows removed; Jini provenance ledgers, changeset, api baselines | — | 13 | hook tests 12/12 | done |

## Per-file decisions (164)

- **CLI (13):**
  - THIN: `import-local.ts` (P13-C3).
  - STAYS-HOST:
    - `adopt`, `export`, `import-site`, `init`, `reset-owner`, `site-rename`, `storage-move`: Tovu site-dir/store/backup composition and wording, per P13 §1.1.
    - `stdin-input`: Tovu wording adapter over `@jini-ai/cli` `readStreamText`.
    - `theme/{generate-index,migrate,normalize-build,sync-originals}`: themes stay in Tovu (owner).
- **contracts (33):**
  - MOVE / DELETE-FORWARDER: 21, listed under B1a/B1b above.
  - THIN:
    - `events/outbox-worker`: binds Tovu's `outboxRetryPolicyForEvent` table.
    - `gated-mutations/token`: `ctok_` tokens, the 600 s default and the positional store adapter.
    - `tool-failure-diagnostics`: injects Tovu's credential/secret detectors.
    - `plugin-credential-card`: injects the app identity.
  - STAYS-HOST:
    - `credential-token`: injects the Tovu key detector.
    - `agent-permission-mode`: `TOVU_AGENT_PERMISSION_MODE` + hosted-runtime policy.
    - `approval-i18n`: product locale copy.
    - `chat-delete-grant`: Tovu `PERMANENT_DELETE_TOOLS` + copy.
    - `credential-store`: an error class that is pure product copy.
    - `entry-refs/unindexed-ref-warning`: host console sink.
    - `theme-ids`: themes are owner-held.
    - `headless/secret-form-cards`: derived from Tovu `nativeToolMetadata`.
    - `rate-limit/rate-limit`: thin binding of `@jini-ai/http-kit/rate-limit`; Tovu profiles + trust-proxy fallback, 94 importers.
    - `operation-lock`: the one host-lifetime instance, GOV-ADR-002.
  - LEFT: `extension-capability-vocabulary` (owner question 1).
- **server/runtime boot, lifecycle, plugin-tier2, configuration (32):**
  - Moved and thinned: as in the batch table.
  - STAYS-HOST:
    - `boot/bootstrap`: composition root.
    - `boot/content-db-schema-guard`: site-dir schema identity.
    - `boot/local-owner-signin`: owner-signin policy.
    - `boot/mail-provider-configuration`: product copy.
    - `boot/site-boot-readiness`: Tovu seeder names.
    - `boot/site-listener-origin`: `TOVU_SITE_LISTENER_ORIGIN` pin.
    - `boot/agent-daemon-wanted`: boot policy + product log.
    - `boot/site-daemon-listener`: Tovu callback paths.
    - `lifecycle/warm-site-retirement`: wiring.
    - `lifecycle/assistant-daemon-connection`: process IPC state + Tovu token.
    - `lifecycle/daemon-lifecycle-log`: `TOVU_DAEMON_LIFECYCLE_LOG` switch.
    - `configuration/capability-inventory`: Tovu's checked-in inventory data.
- **server/runtime composition (87):**
  - Moved and thinned: as in the batch table.
  - STAYS-HOST (host wiring), with reasons from the batch reports:
    - **Site deps:** `site-deps/*` (16) compose Tovu features from the `SiteStore` kernel.
    - **Memory deps:** `memory-deps/{create-route-deps-options,route-deps/*,slices/*}` and `memory-route-deps` are the in-memory test root over Tovu repos.
    - **HTTP mounting:** `http-app/*` handles Tovu route mounting.
    - **Composition root and app setup:** `deps`, `create-app-options` and `store-bound-services`/`sqlite-only-services` (the storage-engine seam).
    - **Modules:** `modules/{agent-daemon-core-rpc,analytics,api-keys,assistant-chats,assistant-daemon-client,assistant-tool-access-lowering,desktop-mcp-handoff,run-daemon-http-client,run-daemon-origins,tool-execution-caller-express,types}`. These are Express routers, Tovu daemon wiring and the `ServerModuleHandle`.
    - **Run finalizer:** `run-finalizer/{checkpointer,stream,shared}` are built on the `Watch` record from `watch-state.ts`, which belongs to another lane.
    - **Assistant flags and tools:** `admin-assistant-enabled` (`TOVU_ADMIN_ASSISTANT`) and `assistant-history-tools` (Tovu permission).
    - **Commerce:** `commerce-worker` (host file lock via `@jini-ai/db/pglite`) and `commerce-http` (Express + theme shell).
    - **Analytics and browser routes:** `browser-analytics(-http)` (Express + consent).
    - **Policy and catalogs:** `authoritative-dns` (address policy), `boot-data-repairs` (repair list), `core-extension-claims` (namespace reservations) and `provider-contracts` (domain list).
    - **Late-read and binding modules:** `credentials-host-ports`, `declared-content-types`, `plugin-install-attachment-reader` and `publish-backstop-ports`.
    - **Charts:** `charts-recharts-source` keeps the compiled-in review pins and integrity map deliberately in the host.
    - **Import:** `import-database/repo.sqlite` holds the share-archive policy.
    - **Observability:** `observability-export` reads Tovu launch facts and env.
    - **Site keys:** `other-site-keys` and `site-key-recovery`.
    - **HTTP clients:** `outbound-http` and `publish-content-http` (Tovu UA/env/OAuth binding).
    - **Provider watch:** `provider-revision-watch` (SQL over Tovu key format).
    - **Site guide:** `public-site-guide` and `site-guide-tools` (visitor card + copy).
    - **Site boot:** `host-signals`, `site-paths`, `registered-sites`, `open-site-content-db`, `open-site-store`, `site-app-boot-work` and `static-site-context` (Tovu site layout/registry/boot).

## Skipped / LEFT (exact reason)
- **`contracts/core/extension-capability-vocabulary.ts`:** STOP 5, a new owner decision. Jini already has an identical `@jini-ai/core/extension-capability-vocabulary`. Tovu `contracts/core/__tests__/unit/extension-capability-vocabulary.unit.test.ts` pins `host-binding.ts`'s import with a regex on the relative Tovu path.
  - **Recommendation: approve.** Rewrite the regex to `@jini-ai/core/extension-capability-vocabulary`, repoint `host-binding.ts:10` and the test, then delete the Tovu file. The test's purpose (import identity, no re-declared literals) is unchanged.
- **Next candidates (not owned here or not worth it):**
  - `memory-deps/ports.ts` is done (B7).
  - `run-finalizer/{checkpointer,stream}` need `watch-state.ts` (another lane) to move first.
  - A THIN split of `agent-permission-mode` would leave about 4 lines.
  - P13-C1/C2 (`cli/{main,errors,help}.ts`, `commands/introspect.ts`) and the `owner-store.ts`/`serve.ts` halves of P13-C3 are not in this lane's list. The Jini helpers they need (`request-fields`, `parsePortValue`) now exist.

## Behaviour changes (all test-pinned with named mutations)
- **Log lines no longer embed raw error text (B8, required by the Jini `check:log-safety` ratchet).** The four lines are:
  - `[shutdown] closing <label> failed`
  - the domain-binding sweep failure
  - plugin attach failure
  - activation poll failure

  Each now logs the bare message with the error in the logger's error bag. The Jini modules take a REQUIRED `logger` port (no `console` default); Tovu passes `createConsoleLogger`. Mutations: re-inline `${error.message}`, drop `{ error }`, or restore a console default → red.
  - **Owner note:** Tovu's console logger prints only the error class name. If operators need the message on these four lines, give Tovu a logger that formats it (host-side) — the Jini side should stay as it is.
- **`describe-error-for-log.unit.test.ts` "hostile getters":** red before and after this run (Jini's `describeErrorForLog` never throws, so the old Tovu try/catch was dead). The assertion was left unchanged.
  - **Recommendation:** update it to the Jini behaviour, or delete it (Jini covers this).

## Gates (base-diff vs merge-16; "= base" means the same rows, not only the same exit code)
**Jini.** Raw outputs are in the scratchpad as `jbase-*` / `jfin-*`.
- Build: `pnpm -r build` 0 (0 `error TS`).
- `pnpm typecheck`: 0.
- `api:check`: 0 (baselines updated; changeset `.changeset/w4-runtime-host-helpers.md`).
- `guard`: 1 = base (only `HW3 packages/admin/src/shell/lib/shell-failure-log.ts`).
- `check:size`: 1 = base.
- `check:complexity`: 1 = base.
- `check:hooks`: 0.
- `check:why-comments`: 1 = base.
- `check:errors`: 0 (WARN) = base.
- `check:log-safety`: 1 = base.
- **XP** (`check:cross-package`): 1 = base, plus 2 environmental XP3 rows: `absolute JINI_DECLARATION_BASELINE_DIR required` for `commerce/src/catalog/index.ts` and `devops/src/dns/index.ts`. Their barrels changed, and XP3 needs a declaration-baseline snapshot that this environment does not have.
- Changed vitest/node tests: 36 files, all green (analytics 8, chat 8, cli 36, commerce 11, core 2, daemon 8, db 2, devops 27, diagnostics 3, infra 17, platform 7, plugins 19, sandbox 15, server 27, sidecar 29).
- Provenance ledgers updated (`devops`, `plugins`, `platform`, `commerce` `source-map.md`).

**Tovu.**
- Same exit codes as base:
  - `typecheck` 0
  - `typecheck:e2e` 0
  - `typecheck:tests` 0
  - `typecheck:scripts` 2
  - admin tsc 0
  - `check:boundaries` 0
  - `check:inventory` 0
  - `check:complexity` 0
  - `check:hooks` 0
  - `check:errors` 0
  - `check:src-complexity-drift` 0
  - `check:governance-adr-scope-drift` 0
  - `check:outbox-bridge` 1
  - `check:coverage-integrity` 1 (no lcov in either tree)
- `check:size`: 1, same row (`assistant-byok.ts` 532 → 531).
- `check:architecture`: 1. Its non-blocking WARNING propagation-cost ratchet rose from 3.14 to 3.21, because files left the graph (2077 → 2040 nodes). The deep-import edges fell 2593 → 2483.
- `check:why-comments`: 1 = base: the same 78 open blocks. The 75 why-comments that moved with code are recorded per id in `development/why-comments-debt.json` (65 moved/kept reworded, with destination; 4 restored in Jini `packages/infra/src/events/outbox/policy.ts`; 6 obsolete forwarder/barrel headers).
- **Changed tests:** 237 node test files. 220 are clean; the other 17 were re-run on base:
  - 15 are identical to base (base-red): `serve-command-wiring`, `describe-error-for-log`, `forms-notification-{retry,restart}`, `outbox-retry-policies`, `site-exporter`, `commit-site.unit`, `forms-submit`, `forms-module-sender`, `site-title-preservation`, `index-bind-host-wiring`, `plugin-host.integration`, `webhook-delivery-worker`, `close-store-on-shutdown` (8 cancelled), and `outbox-worker`. `outbox-worker` has one fewer pass because that test moved to Jini.
  - 2 were new reds and are fixed: `outbox-drainer.scheduling` (eval child imported the deleted memory-bus) and `process-root-parity` #7 (harness lacked the injected daemon logger). They are now 2/2 and 6/7 (#5 is base-red).
- **Admin vitest:** `credential-fidelity` and `untranslated-copy`, 94/94.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, themes excluded)
| | moving (FILES LEFT) | excl. themes |
|---|---|---|
| before (merge-16 `3a93322474`; reproduces combine-16) | 2,187 | 2,076 |
| after (this branch) | **2,169** | **2,058** |

Note: `plan.mjs` counts only files under its planned area prefixes. `contracts/core` is an area, so its 18 removals show. `server/runtime/**` is treated as composition and is not counted, so the 19 runtime files deleted here (and the 15 thinned files) do not move the number.

## Self-check (before final push)
- **No forwarding files:** no re-export/forwarding files remain in the lane. Two re-export lines were removed by the coordinator and two more by B8.
- **Object args:** every new Jini export takes object args with an `_optional`/`optional` pad. The hook-refusals positional signatures were fixed by the coordinator.
- **Framework types:** no server-framework types in Jini. The Express adapters (`site-idle-park` middleware, `tool-execution-caller-express`, `browser-analytics-http`) stay in Tovu.
- **Logging:** no host log formatters in Jini; loggers are required ports.
- **Product words:** none in Jini additions (`git diff | grep -i tovu` = 0).
- **Shared wire types:** in core contracts; the core `contracts/site` additions are type-only (XP4 clean).
- **No new size-exception entries.** The stale error-gate debt rows for deleted Tovu files were removed (3).
- **Why-comments** moved with the code, or are recorded per id with their destination (75 entries).
- **Wiring sections:** `## Wiring` was added or extended in the READMEs of core, infra, plugins, platform (+ `src/secrets/README.md`), commerce, sandbox, sidecar, server, devops, chat, cli, db, diagnostics, analytics and daemon.
- **Notes:**
  - `apps/desktop/src/product-telemetry-ipc.ts` now reaches `@jini-ai/analytics/product` through `product-events.ts`. `apps/desktop/package.json` does not declare `@jini-ai/analytics`; it resolves through the root `node_modules`. Desktop tsc and its test pass. Declaring it means a registry lockfile change, which was left to the owner.
  - The comment at `apps/desktop/src/tovu-server.ts:494` still names `bind-host.ts`.
  - `development/scripts/write-path-inventory.baseline.json` still lists `events/memory-bus.ts`. Its checker crashes here (ts-morph), so it could not be regenerated.

## Pushed SHAs
Tovu `codex/w4-runtime-tovu` (newest first):
- T `9b4bc1dceb` wip(w4-runtime): report draft; why-comments reconciliation in flight
- T `c2ee9e5010` test(w4-runtime): import site paths from site-paths.ts (deps.ts re-export removed)
- T `e29d0c3445` test(w4-runtime): repoint eval-child memory-bus import to @jini-ai/infra; parity harness supplies the injected daemon logger
- T `ab2dd29515` fix(w4-runtime B8): type-only core contract (ToolAccessLoweringError -> @jini-ai/daemon), required logger ports instead of console defaults, named error idioms
- T `0ceaac2b9a` wip(w4-runtime): checkpoint — B8 (gate-row fixes) in flight
- T `02d8601936` wip(w4-runtime B9): product-events keeps the catalog + admin rewrite; projection over @jini-ai/analytics/product
- T `cdd73335a2` wip(w4-runtime): checkpoint — B7 in flight
- T `02ffc893f1` wip(w4-runtime): checkpoint — B7 in flight
- T `4b237bf80b` wip(w4-runtime): checkpoint — B7 in flight
- T `99edaa509b` wip(w4-runtime B6): tier-2 worker runner and daemon park recovery thinned to host bindings over Jini sandbox/sidecar
- T `92a35ef260` wip(w4-runtime): checkpoint — B5b (composition helpers) and B6 (tier2 worker, demand-fetch) in flight
- T `693e0d4f75` wip(w4-runtime B2b): bind-host moved to @jini-ai/devops/local-dev; site-idle-park thinned to the express adapter over @jini-ai/server/shutdown/idle-park
- T `f58cb893d5` fix(w4-runtime): pass handlers/err as objects to @jini-ai/plugins hook-refusals
- T `6ac33d6001` wip(w4-runtime): drop deps.ts site-paths re-export and store-bound-services type re-export (importers repointed); remove stale error-gate debt rows for moved files
- T `35125a084e` wip(w4-runtime B2): boot/lifecycle helpers to Jini (sidecar parent-watchdog, devops boot listener, server shutdown, core lazy-proxy); plugin-sdk-resolver forwarder removed
- T `de8519e7e2` wip(w4-runtime): wave-1 checkpoint — B1b done (contracts/core shims out, Tovu tables/copy to @tovu/contracts); B1a/B2/B3 in flight

Jini `codex/w4-runtime-jini` (newest first):
- J `f2a965472` docs(w4-runtime): restore moved outbox policy why-comments in @jini-ai/infra (keep the existing equal-jitter line verbatim)
- J `2dca3f9bf` wip(w4-runtime): why-comments reconciliation in flight
- J `a4f35a498` fix(w4-runtime B8): type-only core contract (ToolAccessLoweringError -> @jini-ai/daemon), required logger ports instead of console defaults, named error idioms
- J `9d6aecf7f` wip(w4-runtime): checkpoint — B8 (gate-row fixes) in flight
- J `4973c862b` wip(w4-runtime B9): analytics ./product projectDeclaredProductEvent + freezeProductEventCatalog (host catalog injected)
- J `1b8733738` chore(w4-runtime): api baselines for the new host-helper subpaths; changeset covers db/diagnostics
- J `c706a6974` wip(w4-runtime): checkpoint — B7 in flight
- J `691b2ee6d` wip(w4-runtime): checkpoint — B7 in flight
- J `91061d9c1` wip(w4-runtime): checkpoint — B7 in flight
- J `be1613bfa` docs(w4-runtime): provenance ledger entries for moved host helpers; changeset
- J `ec8e55d7a` wip(w4-runtime B6): sandbox ./node-worker/per-call-runner (Tier-2 runner core) and sidecar ./daemon-park-recovery
- J `e3677e6eb` fix(w4-runtime B5b): legacy-codecs decoder table is a ReadonlyMap (HW3 module state)
- J `32c257cef` wip(w4-runtime): checkpoint — B5b and B6 in flight
- J `72a7366cc` wip(w4-runtime B2b): devops local-dev resolveBindHost (host label + error factory injected); server ./shutdown/idle-park core
- J `fde79c3cf` fix(w4-runtime): plugins host/hook-refusals exports take object args with _optional pad
- J `fcaccf0ed` wip(w4-runtime B2): sidecar supervision/parent-watchdog, devops local-dev reserveBootListener, server ./shutdown + ./shutdown/boot-work, core primitives lazy-proxy
- J `446f12f4b` wip(w4-runtime): wave-1 checkpoint — B1b (plugins host/hook-refusals, core tool-access-change); B1a/B2/B3 in flight
