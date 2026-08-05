# Seat 3 — Claude Fable 5 (`claude-fable-5`) — Blind First-Round Submission

## 1. Executive Recommendation

**Adopt strategy 2 executed with strategy 3's discipline: keep Jini as the existing full copy of Open Design and progressively invert it — but with a hard package-first rule (all new engine code lives in `packages/jini-*` behind machine-enforced import boundaries), an explicit deletion schedule for OD product content, and the in-tree OD apps demoted to "reference consumer" whose only job is to prove every extraction against real behavior.** Consistent with three verified facts: (1) Jini already *is* a copy — the `integrated` branch carrying the most-decomposed daemon in existence (server.ts 2,631 lines vs 8,635 on the OD checkout, 12 capability barrels, per-agent `runtimes/defs/`), work that exists nowhere upstream; (2) the user does not control upstream merge cadence — decomposition PRs are maintainer-gated, so strangler extraction *inside* upstream OD is structurally blocked; (3) a second consumer (Tovu) is already trying to mount the engine — the broken `apps/web/src → Tovu/web/src` symlink is direct evidence. Failure mode ("OD with renamed symbols") neutralized by: an import-boundary guard (same pattern as existing `check-web-slice-boundaries.ts`), an `examples/minimal-host` app that must run chat+artifacts+runtimes with zero `apps/`/`adapters/open-design/` imports, and phased deletion of OD product trees so the copy shrinks monotonically. Would change my mind: proof the user has commit rights on nexu-io/open-design.

## 2. Repository Topology
One repo, one pnpm monorepo, publishable packages, own GitHub repo, **git history preserved** (Apache-2.0 makes this clean; 481MB .git fine; cloud agents `--filter=blob:none`). Rename remotes `origin→od-upstream`, `fork→od-fork`; add new `origin`.
Key trees: `AI-Dev-Shop/` (vendored, top-level), `project-runner/`, `packages/{contracts,platform,sidecar,sidecar-proto,daemon-core,agent-runtimes,artifacts,chat-react,components}`, `adapters/open-design/{daemon,web,compat-tests,source-map.md}`, `apps/{daemon,web}` (reference consumers, shrink-only), `examples/minimal-host` (zero-OD-import proof), `mocks/` (kept — engine test infra), `reports/cloud-context/`, `references/` (gitignored, sparse-clone on demand).
Deleted (scheduled): design-templates/, design-systems/, story/, clipper/, figma-plugin/, charts/, marketing/landing, CHANGELOG/TRANSLATIONS/RELEASE-NOTES, src.orig after restore, Tovu symlink.

## 3. Package Boundaries
`@jini/contracts` (pure TS DTOs/SSE unions) → `@jini/platform` → `@jini/sidecar[-proto]` → `@jini/daemon-core` (HTTP kernel, run lifecycle, ports RunStore/ProjectStore/ArtifactStore/CredentialVault, `createJiniDaemon`) → `@jini/agent-runtimes` (RuntimeAgentDef registry, 25+ defs, stream parsers, capability flags, CLI discovery) → `@jini/artifacts` (headless parser/registry/question-form) → `@jini/chat-react` (headless hooks + presentational components + ChatRuntimeAdapter + slots) → `@jini/components`. `adapters/open-design` may import packages but packages may NEVER import apps/adapters (new `check-engine-boundaries.ts` in `pnpm guard`).

## 4. Daemon Core & Adapters
Ports: AgentRuntime, RunStore, ProjectProvider, ArtifactStore, EventSink, CredentialVault, SkillSource, DataRoot. Composition root `createJiniDaemon(config)`. Expose all four surfaces (they're layers of one thing: library = composition root, HTTP daemon = thin host, CLI = HTTP client per OD dual-track rule, sidecar already separate). Base Jini on the `integrated` trunk (server.ts already decomposed), NOT upstream main. OD-specific stays in adapter: design-systems, brands, deploy, figma, critique, marketplace, media, Langfuse.

## 5. Agent/CLI Discovery
Engine capability in `@jini/agent-runtimes`. SoT: daemon-owned `<RUNTIME_DATA_DIR>/agents/discovery.json` (never web, never committed). Full scan on start + lazy TTL 15min + `POST /api/agents/rescan` + ENOENT invalidation. Schema: `{id,binPath,version,authState,capabilities{promptInputFormat,midTurnInput,resume,streamEvents,models[]},discoveredAt,probeSource}`. Normalize via one event union in contracts + per-runtime capability flags + namespaced `ext:{[runtimeId]:…}` for richness (generic consumers ignore). New agent = new def+parser, zero switchboard edits.

## 6. Frontend
Headless hooks + presentational components + slot interfaces, shipped as packages, proven by reference app. Adapters: ChatRuntimeAdapter, ArtifactAdapter, ProjectContextAdapter (optional/nullable), slots for tool cards/attachments/artifact renderers/question-form/comments. Transport injected → usable outside Next.js. Sequence: restore src.orig→src + delete symlink → reconcile memory slice → harvest ChatPane/ChatComposer decomposition branches → characterization tests → extract @jini/artifacts → chat hooks behind ChatRuntimeAdapter → @jini/chat-react with slots → apps/web consumes → minimal-host zero-OD boot. Effort: 4–6 weeks (8–10 if harvest conflicts).

## 7. OD Integration
Upstream→Jini: `sync-od` fetches od-upstream/main into preserved history, triage report, agent cherry-picks, product-tree commits auto-skipped, weekly. Jini→OD: `backport` task type, red-spec-first PRs to fork. Anti-drift keystone: compat-tests + **mock replay parity** (same `mocks/` traces through OD daemon and Jini daemon-core, normalized streams diffed — covers 25+ runtimes). OD adopts @jini/artifacts first (smallest/purest). Jini AGENTS.md is a stale OD copy — Phase-0 rewrite mandatory.

## 8. Project Runner & Ledger
Repo-local TS, not CI. Division with AI-Dev-Shop: ADS governs *how* an agent works a task (role pipelines), project-runner governs *which* task/who-holds/what-happened; task record references `pipeline:"ads:refactor"`. Files (committed): `ledger/tasks/<id>.json` (one file per task, merge-friendly), `ledger/index.json` (generated, committed for cloud read speed), `sessions/<utc-ts>-<id>.md`, `decisions.md`, `blockers.md`; `leases/` gitignored flock. Schema: `{id,title,phase,status,dependsOn[],scope[],goal,allowedChanges[],forbiddenChanges[],validation[],sourceRepo,sourceRef,targetPaths[],pipeline,modelBudget,attempts[],lease,blockers[],decisionRefs[],handoff}`. States: draft→ready→claimed→in_progress→validating→done; +blocked→ready, +failed→ready|abandoned, +superseded. Terminal: done/abandoned/superseded. Lease model: distributed truth = git compare-and-swap (claim = write lease + push claim commit; rejected push = lost race); local = flock. TTL 4h, heartbeat 15min. Deterministic next-task = topo-sort deps → filter claimable → order by (phase,priority,id).

## 9. Cloud Workflow
next-task → claim (push CAS) → branch `task/<id>` (worktree local / partial clone cloud) → read task+last session+overview.md → execute under ADS pipeline → run task validation → write handoff → finish. Resume = re-read task+session (ledger is memory, not chat). Concurrency = lease CAS + disjoint scope globs. Human checkpoints: @jini/contracts shape changes, deletion executions, upstream-sync triage, license/NOTICE, forbiddenChanges requests. Autonomous: behavior-preserving green moves, backports w/ red spec, graph refresh, ledger hygiene. Compat protection: replay parity in every extraction task's validation. Executors: Claude Code primary, Codex cloud for mechanical; ledger agent-agnostic.

## 10. CBM/Graphify/UA Export
Committed `reports/cloud-context/`: MANIFEST.json (repo/branch/commit/generatedAt/tool/version stamps), overview.md (entry doc), architecture-map.md, seams.md, hotspots.md, daemon-symbols.md, web-symbols.md, graphify/summary.json (<5MB), understand-anything/graph.json (<5MB). Local/object-storage only: full indexes/DBs/dashboards. `refresh-context` regenerates, refuses dirty tree, stamps commit. Staleness: next-task compares MANIFEST distance to HEAD; >50 commits ⇒ warning + auto-enqueued refresh. No export exists today (stated, not fabricated); generating first = JIN-006.

## 11. Migration Phases (exit criteria / rollback)
0. Hygiene (restore src, new repo, rewrite AGENTS.md, NOTICE) → guard+typecheck+suites green → rollback tag `jini-baseline`.
1. Control plane (project-runner + ledger + first export + boundary guard) → next-task deterministic → delete project-runner/, zero product touched.
2. Contracts+artifacts (split @jini/contracts, extract @jini/artifacts) → boundary+characterization green → revert to phase-1 tag.
3. Daemon core (kernel+run lifecycle+agent-runtimes+discovery) → **mock replay parity** OD-vs-Jini → reference daemon re-inlines.
4. Chat UI (hooks+chat-react+adapters/web; minimal-host) → minimal-host zero-OD boot guard-enforced → per-package revert.
5. OD adoption+sync loop (publish, OD fork consumes artifacts, weekly sync) → OD fork green → OD pins previous commit.
6. Second consumer+shrink (Tovu adopts chat-react, deletion completes) → Tovu renders Jini chat → per-commit revertible.
Daemon extraction order: adopt trunk barrels → contracts split → http kernel/bootstrap → run lifecycle → runtime defs/parsers → CLI discovery → persistence ports around db.ts → artifact services → generic project/workspace (data-root to adapter) → skills loader generic (catalogue to adapter).

## 12. Testing/Compat
Contract = @jini/contracts (semver; additive minor, breaking major w/ deprecation ≥1 minor). Three detectors: contract snapshot tests, mock replay parity (25+ runtimes free), characterization suites. Reusability evidence = minimal-host (guard-enforced zero OD imports) + Tovu adoption = falsifiable "not renamed symbols" test.

## 13. Security/Recovery/Observability/Cost
Security: single-data-root discipline as core port, credentials in per-CLI homes/CredentialVault (never in registry/ledger), subprocess in agent-runtimes w/ stamp model. Recovery: crash→lease expiry→reclaim w/ supersession; malformed stream→parser fail-fast + trace captured as new fixture; partial migration→moves are import-relocations first so rollback = git revert at phase tag; upstream API change→replay parity red before users. Observability: sessions record attempts/outcomes/spend; `jini report` aggregates. Cost: strong models only for seam/contract/parser design + phase reviews; Sonnet-class for mechanical/graph/summarization; Haiku too inaccurate (repo history); re-audit only on real prior problem; graph refresh only >50-commit drift scoped to changed dirs.

## 14. Size/Provenance/License
No committed reference checkout — Jini's preserved git history IS the reference (upstream reachable via od-upstream); sync-od materializes gitignored sparse partial clone on demand. Submodule rejected (moving target, poor cloud ergonomics); subtree rejected (history already provides). Provenance: preserved history + adapters/open-design/source-map.md + Apache-2.0 LICENSE + NOTICE crediting nexu-io. 5.5GB is local artifacts; honest = .git 481MB, source tens of MB.

## 15. Not-Yet-Generic
design systems, templates, brands, marketplace, deploy, figma, critique/finalize, media, OD analytics, packaged desktop/updater, landing/story, 18-locale i18n, memory semantics. Rule: nothing adapter→core until TWO real consumers (Tovu = second vote). Two-consumer rule = anti-over-abstraction governor.

## 16. Effort/Critical Path
Phases 0–2: 1–2 wk; Phase 3: 3–5 wk; Phase 4: 4–6 wk (8–10 if branches don't harvest); Phases 5–6: 2–4 wk partly parallel. ~3–4 months elapsed, ~60–90 bounded tasks, human ~2–4h/wk. Critical path: restore → contracts split → daemon-core kernel → **replay parity harness (keystone)** → chat hooks → chat-react → minimal-host.

## 17. Why This Could Be Wrong
1. integrated trunk is a bad baseline (front-runs unmerged PRs; if upstream refactors differently, sync cost permanent). 2. Copy gravity wins (agents keep fixing OD instead of extracting). 3. Single-consumer abstraction (if Tovu stalls, seams speculative). 4. Replay parity over-promises (covers stream shapes, not fs/data-root side effects). 5. 52-behind gap compounds during phases 0–2.

## 18. Blind Spots
- Missing option: **upstreaming the engine itself** into nexu-io OD (slower/gated but eliminates two-implementation drift). 
- Unasked question: **what is Tovu concretely?** Adapter surface should be shaped by the second consumer's real requirements; brief never asks.
- Likely-wrong framing: that Jini must maximize *generic* reusability — evidence suggests the user needs ONE second product (Tovu) running soon; designing for N slows the only consumer that exists.

## 19. Decisions Requiring Approval
1. Create GitHub repo, rename remotes, keep full OD history (vs squash). 2. Restore src from src.orig + delete Tovu symlink. 3. Confirm `integrated` as daemon baseline. 4. Harvest local ChatPane/ChatComposer branches. 5. Approve product-tree deletion list+schedule. 6. `@jini/*` naming + Apache-2.0+NOTICE. 7. AI-Dev-Shop sync mode (vendored vs submodule). 8. Model-budget defaults + lease TTL. 9. Confirm Tovu as second consumer + its requirements. 10. Weekly sync cadence + triage checkpoints.

## First 10 Tasks
1. `JIN-001-restore-web-src` — src.orig→src, remove symlink | web typecheck+test.
2. `JIN-002-agents-md-rewrite` — rewrite AGENTS.md/CLAUDE.md for Jini | review+guard.
3. `JIN-003-repo-identity` — remotes/LICENSE/NOTICE/package name | remote plan + install+guard.
4. `JIN-004-product-tree-deletion-1` — delete templates/story/clipper/figma/charts + move fixtures | guard+typecheck+daemon test.
5. `JIN-005-project-runner-skeleton` — ledger schema+bins+lease CAS+tests | project-runner test + determinism.
6. `JIN-006-cloud-context-v1` — first stamped exports | MANIFEST==HEAD.
7. `JIN-007-engine-boundary-guard` — check-engine-boundaries.ts in guard | red-test fixture + guard green.
8. `JIN-008-contracts-split` — partition generic vs OD DTOs | typecheck + snapshot tests.
9. `JIN-009-artifacts-package` — extract artifacts to package | artifacts test + web typecheck+test.
10. `JIN-010-replay-parity-harness` — trace replay + normalized stream snapshots | green on 3 traces (claude/codex/ACP).

## Assumptions
User controls leonaburime-ucla but not nexu-io merge rights (inferred). ChatPane/ChatComposer branches still exist in OD checkout (from notes; verify). Tovu is the intended second consumer (inferred from symlink). src.orig faithful pre-symlink copy. Apache-2.0+NOTICE acceptable to distribution intent.

## Top 5 Risks
1. Upstream drift compounds → stand up sync-od Phase 1, weekly triage. 2. Two drifting daemons → replay parity in every task. 3. Fork ossification/copy gravity → shrink-only apps/, deletion tranches, boundary guard, minimal-host. 4. Frontend harvest conflicts (biggest uncertainty) → decision gate after JIN-001, worktree attempt, re-derive if over budget. 5. Speculative abstraction w/ one consumer → two-consumer rule, Tovu requirements as approval item.
