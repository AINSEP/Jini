PARTIAL T 1d0742c5e0 J 1838a01ed | FILES LEFT 977/449 | left: Jini guard 56 NEW (49 SI-domain + content-analyzer phantom plugin-sdk import); Tovu typecheck:tests 780 (baseline 733; 207 in 91 changed files); Tovu changed-test run unfinished (5329 ok / 145 not ok when cut; 6 failing files fixed after); Jini changed-tests only cms/daemon/agent-plugins run; leftovers J1a, J1c, T1-T3, T4c CLI, T5b schedule, T-GATE+J3a/J3b, J10/T10 Email, T18/T19, w3b-arch sheets 14/18/21/27, T6 renderer/IPC + T8 probe, 5 of 6 arch-crp mutations

# MERGE-24 — all of today's Tovu→Jini extraction on one integration branch (2026-11-25)

Unattended cloud run. Opus coordinated. It read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. It used 4 Opus-high subagents, one at a time per area:
- desktop P11 sheets
- w3b-arch Tovu sheets
- H2 actor-column migration
- Tovu typecheck wiring

No codebase-memory tools, no RemoteTrigger, no `--no-verify`, no force-push, no tag or publish. `main`, `release/*`, merge-23 and every `codex/*` branch were left untouched.

**Base:** `origin/integ/merge-23-2026-11-25` (Tovu `6ace8e8fb2`, Jini `50f8dfcd9`).

**Environment:** Node 22.23.5 (the repo pins `~24`), Jini `pnpm install` + `pnpm -r build`, Tovu `npm ci --ignore-scripts --legacy-peer-deps` (root/admin/desktop/site-chat), `link:jini`, contracts + sdk build. The contracts `prepare` script was suppressed during install only and then restored, because it needs linked Jini first.

## Per-branch merge table

### Jini → `integ/merge-24-2026-11-25`

| branch | result | conflicts / resolution |
|---|---|---|
| `integ/w3-ext-w1w2-2026-11-25` | merged | none |
| `integ/w3-arch-crp-2026-11-25` | merged | none |
| `integ/w3-ext-a-2026-11-25` | merged | `cms`, `core`, `integrations` package.json: 3-way JSON union (no keys dropped). pnpm-lock taken as ours and then regenerated. |
| `integ/w3-p4-p11-2026-11-25` | merged | `api-baseline/jini-ai__cms.json`: ours, then regenerated on the tip |
| `codex/w3-r2allj` | merged | cms package.json union. One scalar clash, `jini.entries ./html/site/export-html-policy` (node vs universal): kept the reviewed `node`. `daemon/agent-executor/launch.ts`: kept the reviewed neutral cleanup temporaries (guard R15 fix). |
| `codex/r3-w1aj` | merged | none |
| `codex/r3-w1bj` | merged | add/add on `platform/secrets/root-key/{reconcile.ts, __tests__/reconcile.test.ts}` and the changeset. The two sides are functionally equivalent; kept the w1a copy. |
| `codex/r2y-ext-w1j` | merged | package.json/lock union |
| `codex/adm-dom2-j` | merged | package.json/lock union |
| `codex/p411-j` | merged | none |
| `wip/merge-24-h2` (this run) | merged | none |

### Tovu → `integ/merge-24-2026-11-25`

| branch | result | conflicts / resolution |
|---|---|---|
| `integ/w3-ext-w1w2-2026-11-25` | merged | none |
| `integ/w3-arch-crp-2026-11-25` | merged | consent `tools.test.ts`: kept both new tests. `site-deps/site-sharing.ts`: Jini `artifact-provider` path plus the new `isShareArtifactKey` import. |
| `integ/w3-ext-a-2026-11-25` | merged | `development/open-bugs.md`: union |
| `integ/w3-p4-p11-2026-11-25` | merged | Import-only conflicts in `oidc-start.ts`, `site/search.ts`, `modules/members.ts` and `source-control/project-scope.unit.test.ts`. Kept both intents: the moved import and the P4 `RouteErrorPorts` / route-incident reporter binding. |
| `codex/tv-all` | merged | none |
| `codex/tv-w3-ext-crp2`, `codex/tv-w3-ext-w1x` | already contained | already ancestors of the tip |
| `codex/tv-r2-ext-a2` | merged | AssistantDock `execution-config.hooks.ts`: kept the Jini hook move, with `EXECUTION_NAMESPACE` now from the Jini ledger. The ledger hook stays deleted (moved). |
| `codex/tv-r2-ext-crp` | merged | `pages/response.ts`: took the Jini `publicPageCache` move. `publish-content/peer-transport.ts`: kept the imports still in use. |
| `codex/tv-r3-w1a` | merged | `custom-credentials/tool-registrations.ts`: both moves (core categories + integrations confirmation UI). `pages/response.ts`: reviewed `finalizePage` ports, with w1a's widget-partials `render` port folded in. |
| `codex/tv-r3-w1b` | merged | none |
| `codex/tv-w2all` | merged | 64 files. w2all re-did extractions the reviewed branches had already landed, so every conflicted file was resolved to the reviewed side; w2all's non-overlapping changes were kept. The importers left dangling were repointed afterwards (see bugs). |
| `codex/tv-adm-dom2` | merged | `AdminByokKeyPanel.tsx` and `deployment/rules.ts` deleted (moved to Jini; HEAD's copy change re-bound in the admin). `size-debt.json`: union. |
| `codex/tv-p411` | merged | none |
| `codex/tv-ghfix` | **absent** | not on the remote |
| `wip/merge-24-h2`, `wip/merge-24-arch`, `wip/merge-24-desktop` (this run) | merged | none |

## Leftovers

| item | status | notes |
|---|---|---|
| tovu-theme 1.1.4 (owner) | **built** | `plugin.json` and `SKILL.md` admitted from b-g2 (`3a57fd9e7c`). The theme package test passes 1/1. The other "6 tovu-theme tests" were not individually identified. |
| H2 actor columns (owner) | **designed+built** | Migration `0050_ledger_actor_kind.ts`, checksum `8451263a8850109e6257deb1e29bd681aceacbacd55e3413c5c75fae0522dda9`. Nullable `actor_kind TEXT` + `actor_id TEXT` on `trashed_items`. `taxonomy_revisions`/`post_revisions` get `actor_kind` only: they already have a NOT NULL `actor_id`, so the kind qualifies it, as in 0047. No CHECK, no backfill, no VACUUM; restore ledger gets no column (B7). One shared list `RECORDED_ACTOR_KINDS` in Jini `core/contracts/events/ports.ts`. Writers persist the columns only when given a typed actor; no caller passes one yet, so it stays dark. Jini cms trash+taxonomy 464/464 pass; mutations drop-trash-kind and drop-taxonomy-kind red. The Tovu migration tests (`ledger-actor-kind-step`, `checksums`, `no-vacuum`, `migrated-copy`) were **not run**. |
| T5a `withIdleTurn` | already built (p4-p11) | The review decided "busy" when the kernel owns the transaction. Followed. |
| T4d / T6 / T7 / T8 desktop | **designed+built, staged, unwired** | T6: storage item IDs, report CLI reader, IPC sheet, OS Trash for dismissed folders only. T7: capability-gated Clean/Compact actions. T4d: idle compaction trigger, not bound. T8: verdict logic only. 26/26 tests pass; 10 mutations all red. LEFT: the T6 renderer/preload/App entry and `main/index.ts` binding; the confirmed-removal race against the real Jini interlock; the T8 probe main and builder. |
| w3b-arch Tovu sheets | **32, 34, 24 built; 29 partial; 14, 18, 21, 27 left** | 18 and 21 lack their Jini halves (R01.CHAT.J and R01.USER-MANAGEMENT.J are not on the tip). 27 (identity incl. desktop preboot, ~20 consumers) and 14 ran out of budget. Sheet 34's import-path threading needs a Jini `actor?` on `importPostEntity`/`importMenuEntity` (missing). |
| arch-crp API baselines | **built** | `pnpm api:update` once on the tip (Jini `1838a01ed`, 20 baselines) |
| arch-crp 6 named mutations | **1 of 6 re-run** | `M-migrate-assistant-as-confirmer` **survived** (10/10 still pass) in the 3 database unit files; its real pin was not found. The other 5 were not re-run. |
| CRP-05 deviation | accepted | as the owner noted |
| p11rest J1a / J1c | **left** | Needs the `createBlobGc` + journal/provenance design (Opus). Tovu now binds the merged cms fenced-write major with an **in-process** fence only (`features/media/blob-write-bindings.ts`), so multi-process sites are not protected. |
| p11rest T1–T3 | **left** | T1/T2 need J1. T3 has J2's type mismatch and needs the Postgres two-connection proofs. |
| T4c CLI wiring | **left** | Needs `--resolve/--resume` in the storage CLI under the file-size rule (program split). |
| T5b schedule wiring | **left** | The sheet anchors it at the serving-app registration plus a shutdown drain, behind the G1–G3 hold. That is not mechanical, and the policy stays unscheduled. |
| p4mounts T-GATE → J3a/J3b | **left** | `errors` is still optional in the Tovu wrappers (42 mounts). J3a/J3b stay gated on it. |
| ext-a J10/T10 Email views | **left** | Needs-opus §5–6; out of budget |
| ext-w1 T18/T19 | **left** | Jini `@jini-ai/cms/fs-files/agent-tools` does not exist |

## Gates (NEW vs old = against merge-23 / the p4-p11 report baselines)

**Jini**
- `pnpm install` + `pnpm -r build`: **green** after fixes (Sol code did not build: cms ×12, admin, daemon, plugins, integrations, ui, cms/forms).
- Strict typecheck (`pnpm -r typecheck` + scripts): **0** after the db test fix.
- `pnpm guard`: **red, 56.** All NEW, from the Sol moves:
  - 49 SI-domain.
  - 7 from `cms/seo/content-analyzer-plugin/plugin.ts` importing a phantom `@jini-ai/plugin-sdk`.
  - 45 other NEW violations were fixed this run (N1/N2 wording, HW3 maps, R5, R8, mcp react peer, N0).
- Tests, `vitest --changed merge-23` per package. The run was paused after 3 packages for the one-heavy-job rule:
  - cms 10 red / 8954 pass. 7 are ENV (`RegExp.escape`, Node 22 vs `~24`). 2 are old (`universal-entries.boundary`, forms `package-boundary`). 1 is NEW (`subpath-isolation.contract`, same as the guard SI-domain).
  - daemon 4892/4892.
  - agent-plugins 3 NEW red (R03 identity tests).
  - Not run: ui, admin, user-management, devops, integrations, db, core, plugins, the rest.

**Package intake into Tovu:** link flow as in combine-23 (`npm ci --ignore-scripts --legacy-peer-deps`; `link:jini`; contracts + sdk build): OK.

**Tovu**
- Typecheck (website tsc): **0**. `typecheck:e2e`: **0**. admin tsc: **0** (was 22 → 17 → 0).
- `typecheck:tests`: **780**. Baseline merge-23 733 (p4-p11 branch 723). 207 are in 91 files changed since merge-23, and those are treated as NEW.
  - Largest: `mail/capture-clear-retention.dialects.test.ts` ×52 (ContentKernel vs `MailSqlKernel<unknown>`).
  - Some project-keys/contract tests were fixed after the count.
- Desktop gates (`apps/desktop npm run gates`): tree-quiet, tests, typecheck, coverage and js-backslide **PASS**. complexity **FAIL → fixed**: 3 NEW from the subagent's T8 verdict and T7 staging, split under 9/9. Re-run of complexity: OK; storage tests 21/21; desktop typecheck 0. The full gate script was not re-run after the fix.
- Admin changed tests: 5 files / 127 tests pass (byok footer, agent-handle, SiteKeyTab, credential-copy, execution-credential).
- Website/content changed test files (645 files, concurrency 4): the run was **cut at the cap**. At that point: 5329 ok / 145 not ok.
  - 7 files failed to load because tests still imported modules w2all had deleted. **All 7 fixed and re-run green** (project-keys ×3 25/25, contracts 40/40, saved-keys, static-copy-policy, database-transfer postgres not re-checked).
  - The remaining not-ok tests are not yet triaged NEW vs old.

## FILES LEFT (excl. themes; planner / true)

**977 / 449** at Tovu `1b05ab3763`. combine-23 was 1060 / 527 at `fa958cb01`, so −83 / −78. 115 files left the moving set and 32 new host bindings entered it (e.g. `media/blob-write-bindings.ts`, `deployment/deployment-classes.ts`, `recovery-panel.tsx`).

Method: `cloud-results/combine-18-plan.mjs` (moving minus the 120 theme-area files) + `plans/P9-data/tools/scan.mjs` + 3615 anchored keep rules expanded from `plans/count-1124/*.md`:
- count1124 js block
- count2-a/w2 brace globs
- count2-w1 table globs
- count2-crp regexes with `c/ p/ r/` expanded

It reproduces combine-23's **1060 / 527 at `fa958cb01` exactly**.

## Bugs found
Logged in `development/open-bugs.md` under "MERGE-24 integration".

**Highlights:**
- **Real a11y bug, fixed.** `PostEditorViewBar` tabs are keyed by `key` but the TabBar index rule reads `id`, so every tab became tabbable.
- **Fixed.** External-mcp poll/probe specs had no principal context, so they could not be mounted signed-in.
- **Fixed.** The Byok footer port no longer matched the copy-based rule.
- **Fixed.** w2all's parallel re-extraction left reviewed importers and tests pointing at deleted modules.
- **OPEN.** The cms fenced-write major is merged with only a single-process host fence.
- **OPEN.** Guard SI-domain plus the content-analyzer phantom import.
- **OPEN.** R03 identity tests.
- **OPEN.** Missing R01.CHAT.J / R01.USER-MANAGEMENT.J.
- **OPEN.** Sheet 33 import `actor?`.
- **Mutation finding.** `M-migrate-assistant-as-confirmer` survives the database unit tests.

## Continuation list (exact)
1. Jini guard: reclassify cms/admin/db/plugins isolation domains for the 49 SI-domain rows. Refactor `cms/seo/content-analyzer-plugin/plugin.ts` to `createContentAnalyzerPlugin({ definePlugin, beforeSaveHook })` (word-count pattern) and delete its ambient `plugin-sdk.d.ts`. Update the Tovu built-in entry and its test.
2. Jini agent-plugins: update the 3 R03 identity tests to pass the host read policy.
3. Finish the Tovu website changed-test run and triage the not-ok tests against merge-23.
4. Run the rest of the Jini `vitest --changed` sweep (ui, admin, user-management, devops, integrations, db, core, plugins, …).
5. Tovu `typecheck:tests`: fix the 207 errors in changed files, starting with mail dialects (generic `MailSqlKernel<DB>`).
6. Run the Tovu H2 migration tests (`apps/website/src/platform/db/migrations/__tests__/*`, `features/post/__tests__/repo.rows.test.ts`). Regenerate `content-database.generated.ts` with `UPDATE_DATABASE_TYPES=1`.
7. Re-run the full desktop `npm run gates`.
8. Leftovers in the table above (J1a/J1c design first).
