PARTIAL 3e296e40f 95688ca4: 39 lane steps not started (prerequisites not landed in these bases), SH-3 (owner-held), X-vendor-credentials-1.T project-scope half (STOP 5), RT-K1-pub-oauth-1 (STAYS, product copy)

# ex4 — Integrations, Providers, Email, Notifications (2026-11-22)

Unattended cloud run, Opus high. No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish. Only the two lane branches were pushed, with plain `git push`.

- **Tovu** `codex/ex4-integrations-tovu`, based on `0d7f78fa4`. That is `origin/integ/merge-13-2026-11-22` minus its docs-only tip `f7185f153`.
- **Jini** `codex/ex4-integrations-jini`, based on `origin/integ/merge-14-2026-11-22` `4902a6a1a`.
- **Spec:** `origin/plan/whats-left-1122` at `18f1b17c0`.

**Bottom line.**
- Of the lane's 45 steps, only 5 have all their prerequisites in these bases: `X-webhooks-1`, `X-vendor-credentials-1`, `X-external-mcp-1`, `S6b` and `RT-K1-pub-oauth-1`. `SH-3` is owner-held.
- Every other step needs `K4-seam-{2,4,5,9,10,11,13,15,20}`, `K5-contracts-core-*`, `X-identity-1`, `A-adm-*`, `A-K2-shell-*`, `K5-project-keys-1` and similar. None of those are in Jini merge-14. I checked: 0 of their sheet destinations exist.
- Results:
  - S6b and X-webhooks-1 landed.
  - X-vendor-credentials-1 and X-external-mcp-1 landed partly. One file in each stays, with the reason below.
  - RT-K1-pub-oauth-1 is STAYS.
- **Files left (scanner): 2,489 → 2,484 (−5).** Excluding the scanner's theme areas: 2,378 → 2,373.
- No new red: every red test and gate is BASE-RED. One cross-repo pairing finding is listed (admin tsc, finding 1).

## Commits
| repo | SHA | content |
|---|---|---|
| Jini | `c2b7ff75` | X-webhooks-1.J |
| Jini | `f2422bd2` | X-vendor-credentials-1.J |
| Jini | `3f0a48aa` | X-external-mcp-1.J (as first committed) |
| Jini | `732ee0a9` | X-external-mcp-1.J fix: the agent catalog goes back to the host (guard) |
| Jini | `95688ca4` | S6b.J (tip) |
| Tovu | `15db68026` | X-webhooks-1.T |
| Tovu | `806686614` | X-vendor-credentials-1.T (abort-guarded-repo half) |
| Tovu | `d1f1a3034` | X-external-mcp-1.T |
| Tovu | `78480e844` | X-external-mcp-1.T fix: agent-tools.ts restored |
| Tovu | `03c99afef` | S6b.T |
| Tovu | `3e296e40f` | why-comments debt rows for the moved comments |

Each Tovu commit names the Jini SHA it was linked against. Copy of this report: Jini `cloud-results/ex4-integrations.md`.

## Steps
| step | files moved (Tovu → Jini) | importers repointed | tests | mutation | status |
|---|---|---|---|---|---|
| **X-webhooks-1** | 3 of 4: `features/webhooks/{signing,signing.keyring,subscriptions}.ts` → `integrations/src/webhooks/site/*`. Exports `./webhooks/site/{signing,signing.keyring,subscriptions}` | 20 sheet lines. The barrel's subscription re-export block is deleted, and its 4 users (`routes/integrations/{create,delete,deps,pause}.ts`) now import the Jini subpath | `signing.test.ts` moved (vitest: `t.mock.method(Date,"now")` → `vi.spyOn`, a one-line swap). Jini webhooks 136/136. Tovu 12 files: 195 pass / 2 fail. Both fails are BASE-RED (`webhook-delivery-worker` 13/1 and `.shutdown` 2/1, identical at base) | `SIGNATURE_VOCABULARY` `t`→`x` in the Jini copy → `signing.test.ts` 2/8 **RED**, restored green. The sheet's named file stays (next column) | DONE (1 STAYS) |
| **X-vendor-credentials-1** | J: both files → `integrations/src/vendor-credentials/{abort-guarded-repo,project-scope}.ts`. T: only `abort-guarded-repo.ts` deleted | 8 abort-guarded lines. `publish-agent-tools.ts:7`'s re-export is removed; the one test that read it through that module now imports from Jini (name split) | Tests first: 9 new Jini characterization cases (red before the move, then green). Tovu 16 files: 6 sheet tests + 10 importers' tests, all green except `mcp-ui-allowlist-completeness` 9/1, BASE-RED | `if (!project)` → `if (!!project)` in `credentialScopes` → 3/9 **RED**, restored | PARTIAL: project-scope T half HELD (STOP 5, see below) |
| **X-external-mcp-1** | 1 of 2: `built-in-connections.ts` → `mcp/src/external/built-in-connections.ts` (`./external/built-in-connections`, universal) | 6 lines. BREAKS rename at every Tovu use: desktop `tovu-server.ts` now sets `JINI_BUILT_IN_MCP_SERVER_IDS`. `built-in-mcp-ownership.test.ts` was renamed first (red 0/1), then the writer was fixed (1/0) | Roster test moved (import line + renamed literal). Jini mcp 1894/1894. Tovu 14 files, all green | `? value : []` → `? [] : []` → 1/12 **RED**. An extra plant on the catalog test (before the revert) also went RED. Both restored | DONE (agent-tools.ts STAYS) |
| **S6b** | `platform/db/repos/webhook-repo.ts` → `integrations/src/webhooks/sql/{webhook-repo,repo.rows,index}.ts` (`./webhooks/sql`). S6a constructor shape `({ kernel, tables: { webhookSubscriptions, webhookDeliveries } }, {})`. Port types come from `../ports.js` / `../types.js`, with identical members (Tovu's own ports re-export Jini's). `kysely` optional peer; devDeps `kysely`, `@electric-sql/pglite`, `@jini-ai/db` (LOCK: `pnpm-lock.yaml` +9) | 5 sheet lines. `sqlite/webhook-repo.sqlite.ts` is the binding (`WEBHOOK_TABLES` + `schemaErasedKernel`, so production call sites are unchanged). S6a precedent: `platform/db/__tests__/webhook-adapters.ts` builds the Jini classes on any dialect, and only the four tests' import and `make:` lines change | Tests first: 12 SQLite + PGlite cases (lost update, conditional save, topics, claim, lease, fence, release, envelope). Tovu: p1-lock-keys 11/0, lost-update 6/0, delivery-repo 73/0, subscription-repo 21/0. shutdown 2/1 BASE-RED. Composition identity 6/0 | Drop `.where("version", "=", expectedVersion)` → lost-update **RED** on sqlite and postgres (2/12), restored | DONE (outside the area table) |
| **RT-K1-pub-oauth-1** | 0 | — | — | — | **STAYS (STOP 3).** `callback-page.ts` is now only the host's copy: every failure body names the product, and it sets the message type `tovu:external-mcp-connected`. The markup, XSS and origin logic are already in `@jini-ai/oauth/callback-page` |
| **SH-3** | 0 | — | — | — | Owner-held (`P9K-fix-B1-B3.md` §SH-3: removing the test block needs owner approval) |

**Stays and holds, with reasons:**
- **`features/webhooks/seal-aad-invariant.ts` STAYS (STOP 3).**
  - It is the host's `npm run check:seal-aad` repo scanner.
  - `REPO_ROOT` resolves 5 levels up from its own location, its scan root is `apps/website/src`, and its exemption list names host files.
  - Moved into Jini, it would scan the wrong tree.
- **`features/external-mcp/agent-tools.ts` STAYS (STOP 3).**
  - Jini `pnpm guard` failed on the moved copy:
    - `R5-neutrality: host tool name "content_read"`
    - `N3-host-copy: line 96 "Settings →"`
  - The catalog's model-facing descriptions are assistant guidance that names host tools and screens.
  - Reverted in Jini `732ee0a9` and Tovu `78480e844`. Guard is back to 0.
- **`vendor-credentials/project-scope.ts` T half HELD (STOP 5).**
  - The sheet says to delete `vendor-credentials/index.ts:11-12`.
  - `vendor-credentials/__tests__/index.unit.test.ts` asserts the barrel's exact key set, including `credentialCreateTarget` and `credentialScopes`. Deleting the lines therefore needs an assertion edit, not just an import edit.
  - The Jini copy has landed. The Tovu file and its 7 importers are unchanged.
  - **Owner decision:** allow dropping the two names from that test's expected set. The T half is then 7 importer lines + 2 barrel lines + 1 delete.

## Steps not started (prerequisite not landed in Jini `4902a6a1a` / Tovu `0d7f78fa4`)
Landed in these bases: only `K4-seam-1`, `K4-i18n-common`, `RT-K1-0`, `A-K2-0a` and the C/D/T/SH steps listed in Jini `.changeset/p9-*`.

| step | missing prerequisite(s) (first ones from `INDEX-EXTRACTION.md`) |
|---|---|
| K5-platform-mail-1, K5-platform-mail-2 | K4-seam-4, K4-seam-2, K4-seam-9 |
| K5-webhooks-1, -2, -3, -4 | K4-seam-2/9, K5-contracts-core-3 (then K5-webhooks-1, K4-seam-11, K5-contracts-core-4/6/10) |
| K5-external-mcp-1, -2, -3, -4 | K4-seam-5/20/11, K5-contracts-core-1/3/4, K5-api-connections-1, K5-contracts-headless-2 |
| K5-custom-credentials-1, -2, -3, -4 | K4-seam-10/15, K5-contracts-core-1/7, K5-project-keys-1, K5-source-control-1/2, K5-deployments-1 |
| X-mail-status-1 | X-identity-1 |
| K5-api-connections-1, -2 | K4-seam-13/8/15, K5-contracts-core-3, K5-agent-plugins-4 |
| K5-mail-1, K5-mail-status-1, -2 | K4-seam-4/5/13, K5-platform-mail-2, K5-custom-credentials-3, K5-newsletter-2, K4-contracts-core-5 |
| K5-vendor-credentials-1 | K4-seam-5, K5-webhooks-4, K5-source-control-1 |
| K5-email-templates-1 | K5-pages-1, K5-contracts-core-3/4, V-post-5 |
| A-K2-integrations-1, A-K2-providers-1, A-K2-email-1, -2 | A-adm-other-1/2/5/6, A-adm-shell-*, A-K2-shell-lib-4, K4-seam-5, A-K2-pages-1/2, A-K2-plugins-2 |
| RT-K1-adm-integrations-1, -2 | K5-webhooks-4 |
| RT-K1-adm-external-mcp-1 … -5 | K5-external-mcp-1/2/3, K5-api-connections-1, RT-K1-pub-external-mcp-1 |
| RT-K1-adm-email-templates-1 | K5-email-templates-1, K5-pages-1, R-admin-http-1, RT-K1-adm-content-1 |
| RT-K1-adm-system-9 | K5-mail-status-1, X-mail-status-1 |
| RT-K1-pub-api-connections-1, RT-K1-pub-external-mcp-1 | K5-api-connections-1/2, K5-external-mcp-1/2, K5-contracts-core-3 |
| RT-K1-pub-mail-feedback-1 | K5-mail-1 |
| P9F-check additions (K5-project-keys-1 is Security's) | as above |

## Gates (base-diff)
**Jini, at `95688ca4`.** Base is combine-14's final at `4902a6a1a`. Node is v22.23.5 (pnpm's shim), not 24.

| gate | base | final |
|---|---|---|
| build (`pnpm -r build` at setup; changed packages rebuilt) | 0, 0 `error TS` | integrations 0, mcp 0 |
| `pnpm -r typecheck` | 0 | **0** |
| `pnpm guard` | 0 | **0** (after the agent-tools revert) |
| `pnpm api:check` | 0, 695 entries | **0**, 702 entries / 17,286 symbols. +7 entries: integrations `./webhooks/site/{signing,signing.keyring,subscriptions}`, `./vendor-credentials/{abort-guarded-repo,project-scope}`, `./webhooks/sql`; mcp `./external/built-in-connections` |
| size (base ref `4902a6a1a`) | 1 (3 rows + 3 stale) | **1, identical** (BASE-RED) |
| complexity | 1 (4 rows) | **1, identical** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base 4902a6a1a` | 0 | **0** |
| log-safety | 1 | **1**, no row in a touched file (BASE-RED) |
| error gate | 0 | **0** |
| plugin guards | 0 | **0** |
| XP | — | The script's default `--base 35c4961af` is missing from this clone (bad revision). Run with `--base 4902a6a1a` instead: **XP1/2/3/5 = 0**; XP4 760, all in untouched `core/src/contracts` (= combine-14 base XP4 760). No contract runtime added (XP4 rule kept) |
| vitest integrations / mcp | — | **2106/2106** (105 files) / **1894/1894** (115 files) |

**Tovu, at `3e296e40f`** (gates measured at `03c99afef` plus the debt rows). Base is combine-13's final outputs at the same commit, `0d7f78fa4`.

| gate | base | final |
|---|---|---|
| size | 1 | 1, the same rows. `publish-agent-tools.ts` 775 → 774 (one re-export line fewer) |
| boundaries | 0, 112 warnings | 0, **111** (the `types.ts → features/webhooks/signing.ts` deep import is gone) |
| admin tsc | 0 (with Jini merge-13 linked) | **2, 4 errors — BASE-RED with merge-14 linked**: the unmodified Tovu base gives the same 4 (finding 1) |
| desktop tsc ×4 | 0/0/0/0 | **0/0/0/0** |
| typecheck (+e2e) / typecheck:tests | 0 / 0 | **0 / 0** |
| hooks / errors / worker-import-graph / complexity | 0 / 0 / 0 / 0 | identical |
| typecheck:scripts | 2 | 2, identical |
| why-comments | 1, 80 open | 1, **80 open** (9 moved-comment rows recorded in `why-comments-debt.json`, Tovu `3e296e40f`) |
| architecture | 1 | 1. Edges 309 → 306, API surface 687 → 683, hubs 313 → 312. Runtime-only propagation 3.29 → 3.30 is the same single ratchet row the combine runs saw |

**Tovu tests at the tip.** Each file ran alone under a 15-min watchdog, 3 in parallel. The set is every changed test, every sheet "must stay green" test, the importers' tests, and all tests under `features/{webhooks,vendor-credentials,external-mcp}` and the `integrations`/`external-mcp` admin routes.
- **95 files: 1,640 pass / 11 fail** (94 node files 1,639/11 + desktop `built-in-mcp-ownership` 1/0).
- All 11 fails are BASE-RED, with identical counts on a clean worktree at `0d7f78fa4`:
  - mcp-ui-allowlist-completeness 9/1
  - access-choice.postgres 0/2 and external-mcp-frozen-db.postgres 0/2 (no Postgres server)
  - secret-scan-guard 16/2 (`git ENOBUFS` and a missing contracts path in the temp copy)
  - tool-contract.characterization 13/2
  - webhook-delivery-worker 13/1
  - webhook-delivery-worker.shutdown 2/1
- Admin vitest was not run: no admin file changed.

**Owner rules check:**
- No `_optional` pad was removed from a surviving declaration. The 5 removed pad lines are all in deleted (moved) files, and each copy in Jini keeps its pad.
- No re-export shells, no `apps/`/`#src` text in Jini, no `/tovu/i` in Jini source.
- No new XP3.
- Moved functions are unchanged in length and complexity.

## FILES-LEFT
Measured with `plans/P9-data/tools/scan.mjs` + `plan.mjs` (plan ref `18f1b17c0`), on the clean base worktree and on the tip. FILES-LEFT = moving + shells.

| tree | moving | shells | **FILES-LEFT** | excluding theme areas (`theme` + `adm-themes`, 111) |
|---|---|---|---|---|
| base `0d7f78fa4` | 2,486 | 3 | **2,489** | 2,378 |
| tip | 2,481 | 3 | **2,484** (−5) | **2,373** (−5) |

- Per area: webhooks 16 → 13, vendor-credentials 8 → 7, external-mcp 17 → 16.
- S6b's file sits in `platform/db`, which is outside the area table (per `P9-extraction.md`).
- This plan.mjs version gives 2,486 moving at base. combine-13 reported 2,483 with `75b14f028`.

## BREAKS ledger rows (for `plans/P9-BREAKS.md`; not edited, since `plan/*` is read-only here)
| step | literal | new name | what breaks for existing installs |
|---|---|---|---|
| X-external-mcp-1 | `env.TOVU_BUILT_IN_MCP_SERVER_IDS` (`built-in-connections.ts:7`) | `JINI_BUILT_IN_MCP_SERVER_IDS` | Nothing persisted. Desktop sets the variable at each site launch, and Tovu's writer was renamed in the same commit. A site process started by hand with the old name would treat no server as built-in. |

## Findings (listed, not fixed)
1. **Admin tsc is red when Tovu merge-13 is linked to Jini merge-14.**
   - Errors: `jini-kits.ts:20` is missing `Icon`, `jini-kits.ts:22` is missing `useT`, `main.tsx:89` is missing `values`, plus `render-with-jini-kits.tsx:23`.
   - Cause: Jini A-K2-0a (merge-14) made those kit fields required, and Tovu has not taken the A-K2-0a host assignment yet.
   - Not caused by this lane. The base worktree shows the same errors.
2. `vendor-credentials/project-scope.ts` now exists in both repos (Jini copy unused) until the held T half lands.
3. Stale strings and comments name moved files:
   - `features/external-mcp/tool-registrations.ts:779` `catalogModule: "features/external-mcp/agent-tools.ts"` is still correct, since the file stayed.
   - Comments in `apps/admin/.../integrations-api.types.ts:62`, `assistant/external-mcp-reauth-tool.ts:83` and `agent-plugins/connect-tool.ts:36` cite `agent-tools.ts` (still valid).
   - Stale `development/scripts/write-path-inventory.baseline.json` rows (`signing.keyring.ts`, `subscriptions.ts`) and `check-architecture.baseline.json` edge rows for `abort-guarded-repo`. Neither is in the gate set.
4. Sheet defects:
   - X-webhooks-1 names `seal-aad-invariant.ts` (a host repo scanner) for Jini.
   - X-external-mcp-1's named mutation targets the wrong test.
   - RT-K1-pub-oauth-1 sends a pure-copy file.
   - X-vendor-credentials-1 does not foresee its barrel key-set test.
5. Jini `check:cross-package`'s hard-coded `--base 35c4961af` cannot run in a shallow cloud clone.
6. `signing.test.ts` in Jini: its old comment about `TestContext` narrowing described the removed `node:test` mock, so it was reworded to say what the vitest spy does.

## Setup
- **Jini:** `pnpm install --frozen-lockfile` 0, then `pnpm --no-bail -r build` 0 (0 `error TS`).
- **Tovu:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, re-linked after each Jini build.
  - `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Base worktree:** `/home/user/tovu-base` at `0d7f78fa4`, sharing the main tree's `node_modules`, used for base attribution.
- **Why-comments base:** `origin/refactor/terra` fetched (`b5fbf2a5e`).
