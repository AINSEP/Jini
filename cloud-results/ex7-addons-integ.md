PARTIAL cff0b3902a dadfb0389: K4-plugins-1 (owner: persisted publisher), A-K2-plugins-1/2/3/4, A-K2-skills-1, A-K2-integrations-1, A-K2-providers-1, A-K2-email-1/2 (kit T half not mergeable + admin package.json owned by kit), K5-agent-plugins-1/3–8, K5-plugin-runtime-1 rest/2/3, K5-skills-1, K5-external-mcp-1–4, K5-webhooks-1 rest/2–4, K5-vendor-credentials-1, K5-custom-credentials-1–4, K5-api-connections-1/2, K5-platform-mail-1/2, K5-mail-1, K5-mail-status-1/2, K5-email-templates-1, X-mail-status-1, X-vendor-credentials-1.T project-scope (owner), SH-3 (owner), all RT-K1-adm/pub lane routes, BX-24–26, RN-J1/T1/J2 — prerequisites not landed, files owned by in-flight runs, or STAYS (host binding / K3 copy)

# ex7 — Add-ons + Integrations, Providers, Email, Notifications (continuation), 2026-11-23

Unattended cloud run. Opus coordinator, subagents in speed mode: 6 Opus-high and 2 Sonnet. No codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish, no RemoteTrigger. `main`/`integ/*`/`plan/*`/`release/*` were only fetched. Plain `git push` after `git pull --rebase`.

- **Branches:** Jini `codex/ex7-addons-integ-jini` (tip `dadfb0389`, plus the report-copy commit). Tovu `codex/ex7-addons-integ-tovu` (last content commit `cff0b3902a`, plus this report's commit).
- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`, Tovu `origin/integ/merge-13-2026-11-22` `f7185f153`.

## Provisional foundation (merged before branching)
| repo | merged | result |
|---|---|---|
| Jini | `codex/ex4-addons-jini` `28289de48`, `codex/ex4-integrations-jini` `c5dafebd7`, `codex/ex3-c0b-jini` `a34ea2194`, `codex/ex5-fnd-kit-jini` `c03c3cd1c`, `codex/ex5-fnd-seams-jini` `805237318`, `codex/ex5-fnd-routes-jini` | clean. The seams merge conflicted only on `api-baseline/jini-ai__core.json`, which was regenerated (`52c4879c5`, additions only) |
| Jini | **`codex/ex2-holds-tovu-jini`** `13d8cba57` (not in the dispatch list) | clean. It was added because Tovu `ex2-holds-tovu` needs its Jini pair (`Tier2ImportPolicy`). Merge `c44f33f94` |
| Jini | **`codex/ex5-fnd-inject-jini` — SKIPPED** | non-trivial: 20 conflicting files against `ex5-fnd-seams` (both runs wrote the same `core/contracts/site/*` seams differently). Seams was kept because it is broader for this lane (mail seam-4, agent-plugins lifecycle seam-7, secrets seam-13) |
| Tovu | `codex/ex4-addons-tovu` `4760b1dc11`, `codex/ex4-integrations-tovu` `7b86bb9b1f`, `codex/ex2-tovu-halves`, `codex/ex2-holds-tovu`, `codex/ex5-fnd-seams-tovu`, `codex/ex5-fnd-routes-tovu` | the `development/why-comments-debt.json` conflicts were resolved as a union by id. In the seams merge, 9 `contracts/core/tool-metadata/*.ts` files were modify/delete; halves only repointed an import and seams moved the files to Jini, so the deletion was taken. `plugin-runtime/tool-registrations.ts` imports were resolved to seams' core owners plus ex4's `@jini-ai/plugins/runtime/plugin-tool-ids` |
| Tovu | **`codex/ex5-fnd-kit-tovu` — SKIPPED** | non-trivial: 8 conflicting files (`App.hooks.ts`, `use-sites-sidebar-nav.hooks.ts`, `settings-api.ts` moved in opposite directions, and others) |
| Tovu | **`codex/ex5-fnd-inject-tovu` — SKIPPED** | its pair is skipped, and it conflicts with seams in 47 files |

**Setup** follows combine-13. Node 22.23.5; there is no `/opt/node24` on this image. pnpm 10.33.2 through a corepack shim (the global pnpm 10.28 fails `engines`), npm 11.
- Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0.
- Tovu: `npm ci --ignore-scripts` ×4 0, `link-jini.mjs` → this run's Jini branch 0, contracts tsc 0, sdk build 0.

**DO-NOT-EDIT set.** 1,574 Tovu and 741 Jini paths. It is the union of:
- `git diff --name-only HEAD...<b>` for every in-flight `ex6-*`, `ex7-*` (not mine), `p12-*`, `bugs-*`, `visitor-chat-tovu`, `p11-next-*` and `sec5-jini` branch;
- every file the foundation branches touch (`ex5-fnd-*`, `ex2-*`, `ex3-c0b`), including the two skipped ones.

Most lane files and their importers are in this set. That is the main reason so little moved.

## Batch table
| batch | subagent | step(s) | files moved | importers repointed | tests | status |
|---|---|---|---|---|---|---|
| A | Opus | K5-agent-plugins-1 | 0 | — | — | **SKIP**: every candidate has a DO-NOT-EDIT importer (`lifecycle.ts`, `tool-registrations.ts`, `access-token-tool.ts`, `connect-sign-in-wait.ts`, `composition/agent-plugin-connections.ts`). Also K3: `card-host-bindings.ts` carries `uriNamespace: 'tovu'`; `host-plugin-guidance.ts` reads `TOVU_AGENT_PLUGIN_OVERLAYS_DIR` |
| B | Opus | K5-plugin-runtime-1 (partial) | 1 + test: `plugin-runtime/plugin-export.ts` → `@jini-ai/plugins/runtime/plugin-export` (K4: `@tovu/sdk` `Plugin` → core `contracts/plugin-sdk` `DefinedPlugin`) | 1 (`plugin-runtime/host-binding.ts`) | Jini 8/8. Mutation `setup === "function"` → `!==`: **2/8 red**, restored 8/8 | DONE for the movable file; 8 STAY (below) |
| C | Opus | K5-external-mcp-1 | 0 | — | — | **SKIP**: `contracts.ts` and the vault are DO-NOT-EDIT. `external-mcp-revocation.ts` is K3 copy ("Integrations → External MCP") over `@jini-ai/mcp/federation/hosted`. `external-mcp-store.memory.ts` is a binding subclass over the staying vault. `external-mcp-repo.writes.ts` is half of `SqlExternalMcpServerRepo` (see follow-ups) |
| D | Opus | K5-webhooks-1 (partial) | 1 + test: `webhooks/repo.memory.ts` → `@jini-ai/integrations/webhooks/site/repo.memory` | 27 files: 14 direct importers, 8 barrel consumers. The `features/webhooks/index.ts` re-export block was removed. All 29 `new InMemoryWebhookSubscriptionRepo()` calls bind `{ assertVersionedWrite }` | Jini webhooks/site 23/23 (13 → 15 cases). **K5 seam, tests first:** 2 new cases on the injected collaborator. Mutation: bind `async () => undefined` → **1/15 red**, restored 15/15 | DONE for the movable file; 5 STAY |
| E | Opus | K5-mail-1, K5-platform-mail-1 (file-level) | 0 | — | — | **SKIP/STAYS**: the repos need `MailRepoDeps` (Tovu `ledger.repo.ts`) and `KyselyKernel`, which has no core owner, plus runtime `kysely`. `feedback-route.ts` needs `MailFeedbackIngestOptions/Response` in core `contracts/site/platform-mail.ts`, which is DO-NOT-EDIT. `feedback-sources.ts` has a persisted K3 vault label "Tovu Mail — … Webhook Secret". The 4 `platform/mail` files are permanent host bindings (vendor `nodemailer` loader, K3 copy, Tovu positional `HttpClientPort`, K4-seam-2 BLOCK) |
| F | Opus | K5-api-connections-1/2, K5-agent-plugins-5/7 (file-level) | 0 | — | — | **STAYS**: the 5 api-connections files are host bindings or the composition root (K3 copy, `ownerKey: "tovu"`, `@jini-ai/oauth` binding). `connection-status.ts` is a shim, deleted in G. `analytics-provider-registry.ts` needs `AnalyticsForwarderModule`/`AnalyticsHooks` in core (K4-seam-16 did not copy them) and has K3 manifest names. `search-provider-registry.ts` is host wiring by design. `host-signals.ts` has no Jini owner for `@tovu/contracts/host-signals` |
| G | coordinator | forwarding-seam removal | 1 deleted: `agent-plugins/connection-status.ts` (shim over `@jini-ai/agent-plugins/connect`) | 3 (`routes/agent-plugins/list.ts`, 2 tests). Also removed `byo-client.ts`'s re-export of `byoClientLabel`/`ByoClient` (3 tests repointed) | connection-status 2/0, mcp-projection-seam 4/0, api-connection-slice 26/0, byo-client 2/0 + 3/0, plugins-list 1/0, agent-plugins-http 8/0 | DONE (no behaviour change) |
| H1 | Sonnet | re-export removal: agent-plugins, plugin-runtime, skills | 0 (lines only, 8 files) | 5 | approval 10/0, mail-provider-contribution 13/0, declarative-content-types 25/0, agent-plugin-tokens 3/0, init-agent-plugin-tokens 6/0 | DONE. 2 lines stay because DO-NOT-EDIT importers use them (`APPROVAL_FAMILY_BY_EFFECT`, `MailAdapterRegistry`) |
| H2 | Sonnet | re-export removal: api-connections, custom-credentials, external-mcp, platform/mail | 0 (lines only, 12 files) | 14 | covered by the 172-file run below | DONE (partial). DO-NOT-EDIT importers or identity tests keep: `plugin-credential-card.ts` (2 lines), `plugin-state.ts` `AgentPluginStateStore`, `external-mcp-store.ts` (4 names), `platform/mail/index.ts` (8 names) |

**Commits.**
- Jini: `52c4879c5` (core api baseline after the seams merge), `72297d47d` (B), `dadfb0389` (D).
- Tovu: `4ecc582fe6` (G), `890a4207c9` (H1), `a41e1269fd` (B.T), `7072d06095` (D.T), `0742af3311` (H2), `6d966f5a77` (G typecheck:tests fix), `cff0b3902a` (3 why-comments debt rows).
- Each Jini half carries a changeset (`.changeset/p9-k5-plugin-runtime-1.md`, `.changeset/p9-k5-webhooks-1.md`, patch) and an api-baseline entry (additions only).

## STAYS / skipped, and why (beyond the batch table)
- **K5-plugin-runtime-1** rest:
  - `built-ins/word-count/index.ts`: K3, persisted id `tovu/word-count`.
  - `invocation-core-deps.ts`: host binding over `createPluginInvocationBinding`.
  - `capability-card.ts`: K3, host tool names and `/admin/addons/plugins`.
  - `repo.sqlite.ts`: host binding over `@jini-ai/plugins/host/sql`.
  - `service-ports.ts`: 5 DO-NOT-EDIT importers, and `HostSignals` has no core owner.
  - `tiptap-blocks.ts`, `install-archive.ts`, `widget-partials.ts`: DO-NOT-EDIT.
- **K5-webhooks-1** rest:
  - `delivery.ts`: K3 `tovu-signature`/`tovu-delivery-id` headers over the Tovu positional HTTP port.
  - `http.memory.ts`: the Tovu positional `HttpClientPort`. **K4-seam-2 is BLOCK (B7).**
- **K5-vendor-credentials-1:**
  - `types.ts` would leave a forwarding re-export in the barrel for 3 DO-NOT-EDIT consumers.
  - `repo.memory.ts` and `vendor-credential-repo.sqlite.ts` extend staying classes.
- **Owner-held:**
  - K4-plugins-1: persisted publisher `"tovu-core"` (ex5-fnd-seams STOP).
  - X-vendor-credentials-1.T project-scope: barrel key-set test.
  - SH-3: test-block decision.
  - RN-J1/T1/J2: last slot of a night, while other lanes are in flight.
  - BX-24–26: no sheet.
- **A-K2-* screens:** the Tovu kit half (`ex5-fnd-kit-tovu`) did not merge. Jini `packages/admin/package.json` is owned by the kit branch, so no admin export can be added.
- **Every other K5/RT-K1 step in the lane** waits on `K5-contracts-core-1/2/3/4/6/7/10`, `K5-contracts-headless-2`, `V-agent-plugins-2`, `K4-seam-2`, `K5-project-keys-1` or `X-identity-1`. None of those is in this base. The `K5-contracts-core-*` steps are also on the skipped inject branch or need an XP4 destination decision.

## Gates (base = the merged provisional base above, same checkout; final = tip)
**Jini** (`--base 4902a6a1a` for why-comments and XP):

| gate | base | final |
|---|---|---|
| guard | 0 | 0 |
| api:check | 0 | 0 |
| typecheck | 0 | 0 |
| hooks | 0 | 0 |
| errors | 0 | 0 |
| size | 1 | 1, identical rows (daemon `launch.ts`, sidecar stale) |
| complexity | 1 | 1, identical rows |
| log-safety | 1 | 1, identical |
| why-comments | 1 | 1, identical 8 blocks (chat transport etc., foundation) |
| XP | 1 | 1. XP3 85, XP4 760: identical counts, none in touched files |

vitest: plugins **1042/1042**, integrations **2118/2118**.

**Tovu:**

| gate | base | final |
|---|---|---|
| typecheck | 2 | 2, identical. **BASE-RED foundation skew**, 1 error: `plugin-tier2/worker.ts:63` `importPolicy`. Jini `ex2-holds-tovu-jini` `6fe486567` (11-23 18:19) made it an optional input, and Tovu `ex2-holds-tovu` has not followed yet |
| typecheck:tests | 2 | 2, identical (same error) |
| typecheck:scripts | 2 | 2, identical |
| admin tsc | 2 | 2, identical (kit-T not merged) |
| size | 1 | 1, identical |
| boundaries | 0 | 0 |
| complexity | 0 | 0 |
| hooks | 0 | 0 |
| errors | 0 | 0 |
| why-comments (`--base f7185f153`) | — | 1 left, BASE-RED (ui-ux-design overlay test, from `331143d396`). Mine: 3 rows recorded |
| architecture | 1 | 1. Files 2216 → 2213, API surface 676 → 675, hubs 278 → 276, no new rows |
| desktop tsc ×4 | — | 0/0/0/0 |

**Tovu tests.** Every changed test plus the tests of every changed production file's importers: 172 files, each run alone, 3 in parallel.
- Result: **2,502 pass / 9 fail in 7 files**. All 7 are **BASE-RED**, with identical counts on a clean base worktree:
  - automatic-agent-plugins 41/2
  - tw2-L224 3/1
  - webhooks tool-contract.characterization 10/2 (+3 cancelled)
  - composition-served-site-dir 9/1
  - mail-send.golden 0/1
  - webhook-delivery-worker 13/1
  - webhook-delivery-worker.shutdown 2/1
- 2 entries are the moved tests, now in Jini.
- Admin vitest was not needed: no admin file changed.

## Self-check (Codex 11-22 failure list)
1. No new re-export or forwarding files. This run removed 1 shim and ~25 forwarding lines. The ones that remain are listed above.
2. No custom hooks were moved.
3. No Express or host log formatters went into Jini.
4. No components were moved.
5. No size or complexity debt rows. 3 why-comments rows follow the ex4/combine precedent.
6. No new shared wire type. `InMemoryWebhookSubscriptionRequired` reuses the S6b `AssertVersionedWritePort`.
7. The behaviour-changing slice (D's injected collaborator) has tests first and a named mutation. B's mutation was also run.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`)
| tree | moving | shells | **FILES-LEFT** | themes excluded |
|---|---|---|---|---|
| Tovu merge-13 `f7185f153` | 2,483 | 3 | 2,486 | 2,375 |
| provisional base (foundation merged) `9e5e4a56e2` | 2,433 | 0 | **2,433** | **2,322** |
| tip `cff0b3902a` | 2,430 | 0 | **2,430** (−3) | **2,319** (−3) |

Lane areas, base → tip: agent-plugins 61 → 60, plugin-runtime 32 → 31, webhooks 13 → 12. Unchanged: plugins 2, skills 7, vendor-credentials 7, external-mcp 16, custom-credentials 20, api-connections 17, mail 12, mail-status 12, email-templates 4, platform-mail 8.

## Findings / follow-ups (listed, not done)
1. **The foundation pair skew blocks a green Tovu typecheck.** `ex2-holds-tovu`'s `worker.ts` must stop passing `importPolicy` in the required object. That is the Jini C043 FIX 1-2.
2. **`ex5-fnd-seams` and `ex5-fnd-inject` overlap** on ~20 core seam files and 47 Tovu files. One must be rebased on the other before combine-15.
3. **External MCP SQL repo:** one follow-up step should move `external-mcp-repo.ts` and `external-mcp-repo.writes.ts` together to `@jini-ai/mcp/federation/hosted/sql`, following S6b, with the vault taken through `HostedMcpVaultPorts`.
4. **Mail repos** need `KyselyKernel` in core (or an S6b-style `StorageKernel` rewrite), a kysely opt-in peer on user-management, `ledger.repo.ts` first, and `MailFeedbackIngestOptions/Response` in core.
5. The Jini `webhooks/__tests__/memory-fixtures.ts` (242 lines) is a near-copy of the moved `site/repo.memory.ts`. Those 7 test files could use the real adapter.
6. A stale comment at `.dependency-cruiser.mjs:787` names `webhooks/repo.memory.ts` (DO-NOT-EDIT here).
7. The sheet labels are stale. "verbatim" is wrong for `external-mcp-revocation.ts`, `external-mcp-store.memory.ts` and `connection-status.ts` (all already binding subclasses or shims). Missing importer: `content/agent-plugin-overlays/shopify/__tests__/shopify-overlay.test.mjs:6` → `host-plugin-guidance.ts`.
8. Mark these as permanent host bindings (STAYS) rather than pending moves:
   - `agent-plugins/{issued-sign-ins,card-host-bindings}.ts`;
   - `platform/mail/{adapter-module,adapters/smtp.nodemailer,delivery-availability,sender-identity}.ts`;
   - `api-connections/{connect,oauth,plugin-state,host}-bindings.ts` and `byo-client.ts`;
   - `plugin-runtime/{invocation-core-deps,repo.sqlite}.ts`.
9. The environment has Node 22, not 24. All Jini vitest here was green, so the `RegExp.escape` env reds were not hit.
