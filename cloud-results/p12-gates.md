PARTIAL 70a2d05773 ec08bb82a: Gate C1 published-reader extension (devops RuntimeImportRef + changeset), role-tag-bypass fixture, tsconfig-alias-to-private-impl detection, Jini-side Wiring check; C043 worker pairing (foundation) left red

# P12 gates — Gate C1 (Jini), Gate B (Tovu), ADR-071 / DR-006, Wiring check, P0.T residual (2026-11-23)

Unattended cloud BUILD run, Opus high. Role bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Dispatch marker `<<SUBAGENT_DISPATCH>>` → repo bootstrap files skipped as instructed. No codebase-memory tools, no force-push, no `--no-verify`, no tags/publish, no RemoteTrigger; `main`/`integ/*`/`plan/*`/`release/*` only fetched.

- Branches: Tovu `codex/p12-gates-tovu`, Jini `codex/p12-gates-jini` (plain `git push`, `git pull --rebase` before each).
- Subagents (3, Opus high, disjoint files, none committed; I reviewed and committed): Gate B inventory; Gate B checker; P0.T residual + Wiring check.
- Tooling: Node 22.23.5 (no Node 24 in this image), pnpm 10.33.2. Jini `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0. Tovu `npm ci --ignore-scripts` root/admin/desktop/site-chat 0/0/0/0; `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` 0 (82 links); `packages/sdk` build 0.

## Bases and foundation merges
| Repo | Base | Merged (plan-named) | Result |
|---|---|---|---|
| Jini | `origin/integ/merge-14-2026-11-22` `4902a6a1` | `codex/ex2-holds-jini`, `codex/sec4-jini`, `codex/ex3-c0b-jini` | all clean (`fe2103e3`, `212f3b4e`, `c73aa50d`) |
| Tovu | `origin/integ/merge-13-2026-11-22` `f7185f153` | `codex/ex2-tovu-halves` (fast-forward), `codex/ex2-holds-tovu` | holds: one union conflict in `development/why-comments-debt.json` (both sides' allow-list entries kept, JSON validated) → `6af1e69f4` |

**Skipped merge (non-trivial):** Jini `codex/ex2-holds-tovu-jini` (C043 Tier-2 import policy, the Jini half `ex2-holds-tovu` needs). It merges cleanly, but its review fixes (`6fe48656`: policy is an *optional* worker input; package root must be host-registered) do not match the Tovu caller (`plugin-tier2/worker.ts:63` passes `importPolicy` in the required object). Moving it to the optional object makes Tovu typecheck 0 but `worker.unit.test.ts` "main() without an importer…" goes red ("no registered package root") — a real Tovu follow-up, not a merge. Merge dropped locally (never pushed). Consequence: Tovu root `typecheck` has 2 errors in `plugin-tier2/worker.ts` (`Tier2ImportPolicy` not exported), present on the foundation-merged base and untouched by this run.

Cut #7 (`codex/p12-cut7-*`) has **not** landed: `platform/html/{escape,slug}.ts` still exist (GB.4) — see Gate B.

## Step 1a — Gate C1 (Jini)
Commits: `b641ba48` (ratchet + seed), `eb97f173` (guard:drift + CI + self-test), `24890262` (complexity split), `ec08bb82` (entrypoint harness stubs).

**What it does** (`scripts/lib/`):
- `injection-debt.ts` — debt file now `{ _comment, metadata: { approvedRuntime, initialized, seedSha }, entries }` (GC.1). Validated: unknown top-level/metadata keys, `approvedRuntime` sorted+unique, `initialized` ⊆ bootstrap rules, unique entry keys, positive counts, initialized markers persist vs base. Bootstrap (C3): `L5-resolved`/`XP4-runtime` may seed new keys only when the base has no entries and no marker for the rule and the head marks it; exactness = no missing key + no slack. Stale allowances print `update baseline`. Key stays `{rule,file,spec,kind}`, `lane` outside it.
- `public-exports.ts` — runtime value exports per public entry (`exports` key as written, e.g. `@jini-ai/core/contracts/server#defineJsonRoute`, GC.2), followed through local re-exports; type-only syntax never counts. Syntactic, so the same enumerator reads the trusted base tree through git.
- `runtime-approvals.ts` — every approval must name a shipped runtime export (type-as-runtime, phantom, private alias fail: `injection-debt-invalid`); additions only in the change that adds the export (base export set diff: `injection-approval-growth`); dropping an approval whose export still ships fails (`injection-approval-narrowed`, GC.1).
- `base-entry-sites.ts` + `base-entry-policy.ts` — `L5-resolved`: Core/Protocol private entries (type or value), unapproved named values (original exported name, so renames still check), opaque loads (namespace, `export *`, bare side effect, inline type list under `verbatimModuleSyntax`, dynamic, `require`), sibling-relative paths resolved to the owning package. `injection-edges.ts`: `optionalDependencies` as `manifest-optional` under `L5-resolved`. Old `L5-injected-edge` coverage and keys unchanged; no occurrence reported by both.
- `contract-runtime.ts` — `XP4-runtime`: runtime syntax (and references leaving Core `src`) under Core `src/contracts/**` production files, keyed `path / SyntaxKind:name|target / kind`. `validContractStatement` moved here; legacy `check-no-cross-package.ts` CLI, snapshot writer and empty-emit assertion kept.
- `check-guard-drift.ts` — legacy diff uses `checkPackageLayers(…, { injection: false })`; `injectionViolations` runs separately and fails directly. `guard-baseline.json` had no injection rows (nothing to reconcile). Raw `pnpm guard` unchanged.
- `debt-base.mjs` — `baseCommit` + `fileAtCommit` (shared base reader), `debtAtBase` built on them.
- `injection-baseline.ts` — prints the full GC.1 shape; approvedRuntime from live exports; keeps existing lanes.
- `.github/workflows/ci.yml` — `quality-gates`/`id: guard`/`INJECTION_BASE_REF`/`INJECTION_FIRST_PUSH_COMMIT` kept; the step now runs the 3 focused vitest files, then `pnpm guard:drift`.

**Seed** (`pnpm exec tsx scripts/injection-baseline.ts`, seedSha `91a2968e`): `L5-injected-edge` 71 keys / 72 occurrences (identical to the pin — 0 keys missing, 0 counts changed), `L5-resolved` 74/74 (opaque-side-effect 56, unapproved-value 17, opaque-export-star 1), `XP4-runtime` 286/286, `L6` 1/1, `L7` 158/174. `approvedRuntime`: 599 pairs. Reprinting after the refactor gives byte-identical entries and approvals.

**Tests first** (`scripts/__tests__/check-package-layers.injection.test.ts`, new describe "L5-resolved: Core and Protocol public entries…"): 16 new cases red before implementation (16 failed / 50 passed), then 66/66. Named anchors: `passes imports of core and protocol, value and type alike` (now with a Core export map + approval), `resolves package.json imports (#aliases)…`, `passes a debt hit, fails a higher count, and fails a stale (too high) allowance`; q2 tests `lists no exception at all…` and `surfaces a re-added infra db shim…` unchanged and green; XP4 tests in `check-no-cross-package.test.ts` green. Cases cover: public type + approved values pass; mixed import / namespace / side-effect / inline type list / private entry / dynamic fail; sibling-relative `.js`; aliased optionalDependencies; approval-only addition fails; export+approval together passes; type-only export cannot authorize; narrowing fails; schema rejects; exact first seed passes; reseed after zero fails; dropped marker fails; cut prints `update baseline`, exact shrink passes; XP4 frozen count passes, added syntax / new runtime file fail, types-only module passes, `__tests__` ignored. Self-test fixture gained a Core public entry, an approval and "an unapproved Core runtime value must fail L5-resolved".

**Mutation `C-same-specifier-value`:** removed `type` from the passing Core type fixture and used the binding as a value (same path and specifier) → red with `+ "L5-resolved packages/daemon/src/a.ts"`; restored (`cmp` identical) → green.

**Handoff probes** (real tree): `INJECTION_BASE_REF=91a2968e` (pre-seed) → injection ratchet ok, 0 new guard violations. Against the seeded base (`HEAD`): +1 on an `L5-resolved` count → `injection-debt-growth` + `injection-debt-stale … update baseline`; a forged approval `@jini-ai/core#notAnExport` → `injection-debt-invalid`. File restored (`cmp`).

**Skipped / deviations (C1):**
- Step 1: the published `@jini-ai/devops` reader (`RuntimeImportRef`) was **not** extended; bindings come from a scripts-local reader (`base-entry-sites.ts`). No public API change, so no changeset; `api:check` 0. Import-equals type queries / declaration augmentations not covered by it.
- Not implemented: role-tag-bypass fixture (a package newly tagged `host-preset`/`runtime-adapter` waiving its edges); a tsconfig-paths alias redirected to a private implementation (the resolver maps a path alias to the owning package name only); broader shipped-payload variants beyond the existing agent-plugins payload scan; the integration-PR required-check arrangement.
- The seed was taken at `91a2968e` (this branch), not a separate approved combine tree.

## Step 1b — Gate B (Tovu)
Commits: `1046c8a22` (inventory), `70a2d0577` (checker, debt, CI).

- `development/boundaries/extraction-inventory.json` (generator `development/scripts/build-extraction-inventory.mjs`, deterministic; lib `development/scripts/lib/extraction-inventory.mjs`): plan SHA `a65df40a`; 2,874 rows — bound 2,290, host 542, mixed 33, retired 9; 148 boundRoots; 4 theme roots.
  - **GB.1 exact:** 85 `features/theme/**` + 1 `tool-metadata/theme.ts` + 25 `adm-themes` + the 34 other-area rows = 145 host rows, disposition `stays: owner 2026-11-22`. **No theme file is Jini-bound**; a bound row inside a theme root fails validation; future files under the 4 roots classify host.
  - **GB.2:** `admin-http/config.ts`, `urls.ts` host; `request.ts` mixed (moved: `authenticatedAdminRequest`, `buildFetchInit`, `fetchOrThrowUnreachable`, `request`, `requestOnce`, `requestRidingOutRestart` → `createAdminHttp`; host: `ApiError`, `describeApiError`, `onUnauthenticated`, constants, `bodyFitsKeepalive`, options type); `escape.ts` retired → `@jini-ai/core/text`, `slug.ts` retired → `@jini-ai/cms/html/site/slug` (pending cut #7). Other 12 platform rows keep destinations.
  - Overlays: settings-api relocation host-owned, `settings-api.types.ts` retired (P0.T below), SH-3 forwarders retired, K4 approval symbols mixed with the host specialization kept, `i18n-common.ts` host.
  - Judgment calls (review): mixed `hostSymbols` derived as current exports minus P9 moved names; `tool-metadata/index.ts` bound→mixed (keeps `HostToolApprovalPolicy`/`HostToolApprovalRule`); stays rows owned `tovu-host/<area>`.
- Checker `development/scripts/check-extraction-boundaries.mjs` + `lib/extraction-graph.mjs`: dependency-cruiser resolution per importer config (root `#src`, `apps/admin/tsconfig.json`, `apps/desktop/tsconfig.main.json`), TS-AST occurrences; rules `bound-host-edge`, `bound-indirect-host-edge` (cycle-safe, witness path), `bound-tovu-contracts`, `bound-private-jini`, `unresolved-protected-alias`; root-internal edges exempt; `--print-baseline`, `--with-report`, `--write-shrink` (exact, idempotent, refuses growth). Base via `EXTRACTION_BASE_REF` (bootstrap when the base has no debt file).
- **Seed** `development/boundaries/extraction-debt.json` (seedSha `aae19e7f3`): 1,361 entries / 1,384 occurrences — `bound-host-edge` 1,293, `bound-indirect-host-edge` 29, `bound-tovu-contracts` 62, private-jini 0, unresolved 0. **GB.4:** 30 entries on `platform/html/{escape,slug}.ts` remain; cut #7 must run `--write-shrink` in its commit.
- `package.json` `check:boundaries` exactly as planned; `ci.yml` keeps `id: gate-boundaries`, `continue-on-error`, the final blocking check; adds `EXTRACTION_BASE_REF`, runs the fixture files first; the "always exits 0" and report-only comments replaced (B7).
- **GB.3:** `--with-report` stdout is byte-identical (19,983 bytes) to `depcruise --config .dependency-cruiser.mjs apps/website/src` up to the extraction marker; a fixture test asserts it.
- **Tests:** inventory 9/9 (red first); checker 14/14 (13 red first; the 14th locks two seeding bugs — nearest `node_modules` Jini lookup, installed `@tovu/*` packages not treated as unresolved aliases). Node fixtures in CI command: 29/29.
- **Mutations:** `B-wrapper-to-composition` → `FAIL new finding: bound-indirect-host-edge …owner-entry.ts -> lib/ports/kit-port.ts`, witness `owner-entry.ts -> lib/ports/kit-port.ts -> lib/ports/wrapper.ts -> integrations/jini-kits.ts`; reverted → ok. Inventory: dropping the theme-root branch of `classifyPath` → 1 red; restored → 9/9.
- **Real tree** with the committed base (`EXTRACTION_BASE_REF=HEAD`): exit 0, "no new, raised or stale extraction-boundary debt". Forged +1 allowance → `FAIL allowance growth vs base (1 -> 2)` + stale, exit 1; file restored.
- Deviations: other desktop configs not picked up; `retired` files are not checked as sources.

## Step 2 — ADRs
- Tovu `ef96484e6`: `ADS-memory/reports/architecture/ADR-071-tovu-host-composition.md` (plan text) + `ADR-INDEX.md` rows for **070** (GA.1, title/status from its header) and **071**.
- Jini `91a2968e`: `docs/decisions/DR-006-host-injected-package-dependencies.md` + the README line after DR-005. Neutral: 0 hits for Tovu / 690 / 334 / 137.

## Step 3 — Wiring-section check (Tovu)
Commit `aae19e7f3` (+ CI wiring in `70a2d0577`). `development/scripts/check-wiring-sections.mjs`, `npm run check:wiring`: Jini-bound feature folders from the inventory (bound/mixed rows; theme roots and theme-named folders excluded) need `## Wiring` in `INFO.md`/`README.md`; backticked `…Port|Ports|Deps|Props|Hooks|Kit` names must be declared in the folder, `packages/contracts/src` or a linked `@jini-ai/*` package. Ratchet: **error** for folders touched vs `WIRING_BASE_REF`/`EXTRACTION_BASE_REF` (zero SHA → `HEAD^`), **warning** otherwise. Runs in the blocking `gate-boundaries` step. Tests 6/6 (red first). Mutation `wiring-ignore-missing-port` → missing-port test red; restored green. Real tree: 104 folders, 0 errors, 104 warnings (103 missing sections; `features/api-connections/README.md` names `RouteDeps`, not a declared port).
- No Jini-bound feature folder was touched by this run (P0.T touched host `lib/admin-http`), so no `## Wiring` section was added. A Jini-side (DR-006) check was not built.

## Step 4 — P0.T settings residual (Tovu)
Commit `9da202de8`.
- Test first: `ledger-slice.test.ts` `rethrows the original 403 ApiError from the settings transport` (one `FakeApiError("forbidden", 403)`, `.rejects.toBe`). Behaviour already existed, so it passed immediately; red evidence is the mutation: **`swallow-all-api-errors`** → 2 failed / 21 passed (403 + existing non-404 case, "promise resolved Map{} instead of rejecting"); restored (`cmp`) → 23/23.
- `settings-api.ts` imports `type SettingValueResponse` from `@jini-ai/admin/core` (Jini `packages/admin/src/core/ports/settings.ts:38`: same fields, `readonly`; no caller writes the response). `SettingResetResponse` had 0 consumers. `vi.mock("../admin-http/settings-api")` already targets the production module (left as is).
- Verification: admin typecheck 0; the plan's 12 files 12/12, 522/522.

**Files removed from Tovu:** `apps/admin/src/lib/admin-http/settings-api.types.ts`.

## End gates (base = foundation-merged tree: Jini `c73aa50d`, Tovu `6af1e69f4`)
| Gate | Tip | Base | Note |
|---|---|---|---|
| Jini build | 0 | 0 | |
| Jini typecheck | 0 | 0 | |
| Jini guard / guard:drift | 0 / 0 | 0 / 0 | injection ratchet ok |
| Jini api:check | 0 | 0 | |
| Jini check:hooks | 0 | 0 | |
| Jini check:why-comments | 1 | 1 | same 11 lost blocks at base (`sidecar/json-ipc.ts`, `publish-hygiene-self-test.ts:109`…); none from this diff |
| Jini check:complexity / check:size | 1 / 1 | 1 / 1 | same 4 / 4 findings at base, all in `packages/`; new scripts checked separately: ESLint complexity ≤10, ≤80 lines → 0 |
| Jini check:cross-package (legacy XP, non-blocking) | 1 | 1 | non-XP3 findings 838 tip vs 878 base worktree (difference = base worktree has no `dist`) |
| Jini focused C1 vitest | 111/111 | — | |
| Jini scripts vitest (`vitest run scripts/__tests__`) | 8 files / 10 tests red, 1,000 pass | same 8 files red at base | identical file set (env-access, why-comments, connection-card.packed, coupling-isolation, extract-s3, fetch-query-isolation, leaf-import-closures, optional-peer-contract). `guard-drift-cli.unit` + `script-entrypoints` had regressed from my guard:drift imports → fixed in `ec08bb82` (17/17) |
| Jini scripts tsc | 0 | — | |
| Tovu admin typecheck | 0 | 0 | |
| Tovu root typecheck | 2 | 2 | `plugin-tier2/worker.ts` (C043 pairing, see Bases) |
| Tovu admin vitest (12 P0.T files, `--maxWorkers=2`) | 522/522 | — | |
| Tovu node fixtures (3 gate files) | 29/29 | — | |
| Tovu check:boundaries | 0 | — | |
