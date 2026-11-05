Software Architect(Direct): I loaded `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/software-architect/skills.md`.  
Keep the general skill, but shorten its everyday reading.  
Add a desktop-only Electron reference; the measured costs have several different causes.  
Fixing server memory requires general application discipline even when Electron launches the server.  
Install in the AI-Dev-Shop source first, then sync the seven affected files.

**1. Goal.** Give Programmer, Software Architect, and Code Inspection short, evidence-backed resource checks and a consistent `Cost:` output.

**2. Findings — A: draft assessment.**

The draft is the right subject and broadly sound. Its **87 lines contain 1,344 words / 10,258 bytes**: too dense for standing context in three personas. Recommend **seven checks, roughly 500–650 words / 45–55 lines**, with evidence loaded when needed. The owner explicitly requested general lessons and three-persona wiring. [Item 26c](/Users/la/Programming/Tovu/development/todos.md:72)

| Draft rules | Recommendation |
|---|---|
| 1 + 9 | Merge: calculate frequency × bytes × copies/scans × consumers; include scanning CPU and bounded stream carry. |
| 2 + 4 | Merge: request the smallest projection **and verify the underlying query work**, including no-match cases. |
| 3 | Keep: avoid repeated large JSON transformations; preserve correctness and full-work fallbacks. Move SQL-splicing details out of standing context. |
| 5 + 8 | Merge: define cache/store owner, capacity, invalidation, cleanup, overflow, and fallback cost. Preserve “correct cache can still save nothing.” |
| 6 | Keep: one pending operation/timer per owner, teardown fences, final persistence. Preserve backed-off retries for transient failures during quiet periods. |
| 7 | Keep: prove idle across background work before reclaiming; unknown means defer. |
| 10 + 11 | Merge: name the metric and workload, set a budget, and compare the real production path before claiming savings. |

These preserve the draft’s substantive lessons while cutting repeated “Bad/Good/Detect” scaffolding. Detailed concurrency, Unicode, query-plan, and adversarial-stream cases belong beside their evidence. [Draft rules](/Users/la/Programming/Tovu/ADS-memory/.local-artifacts/codex/2026-11-04-night/skill-draft/SKILL.md:19)

Reuse checked:

- **`coding-foundations`:** already owns injected dependencies, lifecycle-aware registries, stable contracts, and readable units. Replace repeated instructions with a link. [Rules](/Users/la/Programming/tovu-integration-clones/prov2-tovu/AI-Dev-Shop/skills/coding-foundations/SKILL.md:33)
- **`implementation-guardrails`:** already owns scaling checks, query fan-out, resource caps, reuse, and nearby why-comments. The new skill should add recurring byte cost, retention, and measurement discipline. [Rules](/Users/la/Programming/tovu-integration-clones/prov2-tovu/AI-Dev-Shop/skills/implementation-guardrails/SKILL.md:35)
- **`performance-engineering`:** already owns load validation for latency/throughput/availability requirements. It lacks this memory/retention checklist; keep its workload-validation ownership and avoid copying its benchmark workflow. [Scope](/Users/la/Programming/tovu-integration-clones/prov2-tovu/AI-Dev-Shop/skills/performance-engineering/SKILL.md:14)

Evidence supports retaining the subtleties: Jini documents growing text-tail/barrier hazards in delta writes and connection-wide invalidation that can erase cache savings. I checked current source and commits `efe7777f1` / `4ec60b882`. [Delta invariants](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/store/runtime/run-ledger.ts:83), [invalidation limitation](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/store/sql/read-version.ts:19)

**B: Electron reference — yes, with a narrower claim.**

Electron has extra process and view lifetimes to manage. The supplied measurement does **not** establish that Electron itself caused most memory use.

| Supplied 0.1.28 bucket | RSS | Attribution |
|---|---:|---|
| Site servers | 1.65 GB | General server/query/JSON/checkpoint work, using Electron’s bundled Node runtime. |
| Claude CLIs | 0.69 GB | External agent-tool cost; Electron causation is unproven. |
| Renderers | 0.58 GB | Chromium/view overhead plus the web application’s retained state. |
| Main + helpers | 0.25 GB | Electron shell/helper overhead plus application work. |
| Shared daemon | 0.11 GB | General daemon workload, using Electron’s bundled Node runtime. |

**Measurement limitation:** these supplied buckets sum to **3.28 GB**, versus the stated **3.23 GB** total. Treat them as approximate; raw samples and the discrepancy are **UNVERIFIED** here.

**Yes, desktop-owned site servers run under the Electron executable.** Both source and compiled launch modes use `process.execPath`; their environment sets `ELECTRON_RUN_AS_NODE=1`. The shared daemon does likewise. [Server launch](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/tovu-server.ts:254), [environment](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/tovu-server.ts:327), [daemon launch](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent-service.ts:130)

**Stdio MCP bridges also use that executable.** Tovu checks `process.versions.electron` or the run-as-Node environment and explicitly supplies the variable on the bridge entry because agent environment filtering otherwise removes it. The comment records the failure: a GUI launch, bridge timeout, and missing tools. An HTTP path already exists; avoid assuming every run creates a stdio bridge. [Bridge selection](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/mcp-injection.ts:38)

Electron’s official documentation confirms that `ELECTRON_RUN_AS_NODE` starts a normal Node process, subject to its fuse setting. Being the Electron binary therefore does not make a server a Chromium renderer. [Environment documentation](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)

Whole-history polling, JSON churn, unbounded caches, expensive regexes, and checkpoint retries are **general application problems**. View processes, preload/IPC lifetimes, runtime launch settings, and Electron-specific memory APIs justify the separate reference.

**C: proposed `references/electron.md` content — approximately one page.**

Opening instruction: **“Load only for Electron desktop work, including its launched servers, daemons, and bridges. Apply the general checklist first.”**

1. **Map the process tree before optimizing.** Identify main, renderers/guests, helpers, servers, daemon, CLIs, and bridges by PID and owner. Record executable and mode separately. Electron creates renderer processes for windows and embeds. Tovu’s desktop server/bridge launch paths demonstrate why executable names alone mislead. [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [launch evidence](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/tovu-server.ts:223)
2. **Hidden views still need lifecycle management.** Reuse the existing soft live-view limit; release only after explicit permission from dirty-editor/chat/upload guards. Timeout or unknown retains the guest; restore route and scroll. Incident/fix: `e377c1dd3`, subsequently defaulted to one loaded site. [Current policy](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/use-live-views.hooks.ts:2)
3. **Do not create renderers for thumbnails.** Capture an eligible existing public guest; recheck identity after awaiting capture. Send preview version tokens through recurring IPC and fetch image bytes when changed. History: `b8c5c07de` replaced the earlier capture approach. [Capture](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/boot/site-preview.ts:1), [IPC cost rationale](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/site-preview-store.ts:17)
4. **Share monitoring and cancel renderer work.** Reuse main’s cached sampler and in-flight promise; invalidate site/PID attribution on replacement. Hidden documents own no polling timer; disposal removes listeners. Incident/fix: `6331ff2ea` repaired stale resource attribution. [Sampler](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-resources.ts:138), [renderer cleanup](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/use-resources.hooks.ts:76)
5. **Keep process ownership correct through sleep/restart/quit.** Share the daemon while isolating site scopes; withdraw dead-boot bindings without removing replacements. Cancel restart work on explicit stop. HTTP completion alone does not prove background work finished. Incident/fix: `27ba3c762`. [Binding checks](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent-service.ts:177), [retry cancellation](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/project-ipc.ts:205)
6. **Label memory sources and units.** Preserve unavailable readings; distinguish RSS, heap, private/committed memory, and footprint. Current Tovu adds a bounded macOS footprint probe with labelled RSS fallback; do not compare it directly with the older RSS total. Electron documents platform-specific memory fields and macOS limitations. [Adapter](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-memory-sampler.ts:76), [Electron memory API](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)
7. **Validate the shipped runtime and responsiveness.** Keep run-as-Node settings on child launch contracts. Treat V8 flags as measured tradeoffs: Tovu currently passes `--optimize-for-size`, but source presence proves no saving. Avoid blocking main-process I/O and synchronous IPC; compare natural peaks, idle recovery, and completion on packaged workloads. [Current flag](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/tovu-server.ts:254), [official performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)

Keep Tovu incidents as labelled examples, not universal numeric defaults. Official documentation above was reachable; packaged-runtime behavior and savings were **not executed or remeasured**.

**3. Ordered installation plan — D.**

Paths below are relative to the **AI-Dev-Shop toolkit root inside source repository `ai-dev-shop-e5`**.

| Step | Files and changes | Rough line delta | Verification to add |
|---|---|---:|---|
| 1 | Create `skills/memory-performance-discipline/SKILL.md`: seven checks, ownership links, desktop-only reference trigger, canonical Cost contract. | +45–55 | No automated test; inspect scope and length. |
| 2 | Create `skills/memory-performance-discipline/references/evidence.md`; adapt existing ledger with commit/path anchors, historical-vs-current labels, and explicit measurement limits. | +35–45 | Check every evidence link and claim. |
| 3 | Create `skills/memory-performance-discipline/references/electron.md` from C. | +45–60 | Check desktop-only trigger and official links. |
| 4 | Update `agents/programmer/skills.md`, `agents/software-architect/skills.md`, `agents/code-inspection/skills.md`: Base Skills pointer plus one Cost output pointer; update version/date metadata. | +6 total; ~6 replaced | Static inspection of all three entrypoints. |
| 5 | Add one three-consumer row to `framework/routing/skills-registry.md`. | +1 | Reuse existing registry validator during installation. |
| 6 | Commit reviewed source changes, then sync precisely these seven files to destination `AI-Dev-Shop/`; compare destination content with the source commit. | No extra content | Review destination diff; preserve host edits. |

The registry explicitly requires skill creation, mapping, and persona wiring; it already supports conditional loading. No new loader is needed. [Registry procedure](/Users/la/Programming/tovu-integration-clones/prov2-tovu/AI-Dev-Shop/framework/routing/skills-registry.md:22)

Use this canonical contract in the skill; personas reference it rather than copy three long variants:

`Cost: <path/owner>; <frequency × payload × copies/scans × consumers>; retained <bound/lifetime/overflow>; fallback <full work>; tradeoff <durability/latency>; <ESTIMATED|MEASURED|UNVERIFIED + evidence/budget>; next <check>.`

Use `Cost: N/A — documentation-only; no runtime I/O added` where appropriate. Architect supplies proposed bounds; Programmer reports implementation; Inspection verifies the actual path.

**Sync limitation — UNVERIFIED:** I could not locate a verified `ai-dev-shop-e5` checkout or its normal sync command. The installed README documents copying the toolkit. [Installation mechanism](/Users/la/Programming/tovu-integration-clones/prov2-tovu/AI-Dev-Shop/README.md:7)

For a controlled file-only sync, after resolving source and destination roots and checking destination edits, preview this from the source toolkit root with `-ainR`, then apply with `-aiR`:

```bash
rsync -aiR ./skills/memory-performance-discipline/ ./agents/{programmer,software-architect,code-inspection}/skills.md ./framework/routing/skills-registry.md "$ADS_TARGET/"
```

This is a proposed transfer command, **not a verified existing sync script**. Do not copy the draft’s `persona-snippets.md` into the installed skill. No tests need adding for this documentation-only change.

**4. Cost.**

All following amounts are **ESTIMATED** authoring budgets, not measurements.

| Added read/write/poll | Frequency × payload |
|---|---|
| General skill read | Once per consuming role activation × ~4–5 KB; ~12–15 KB across all three roles. |
| Electron reference read | Once per relevant desktop task/role × ~4–5 KB; zero for other work. |
| Evidence read | On provenance checks × ~6–9 KB; no standing load. |
| Cost output | One line per materially affected path × ~0.2–0.5 KB. |
| Source/sync writes | Once per installation × seven complete files; byte total depends on existing persona sizes. |
| Application reads, writes, polls | **0 added**; no new runtime storage or retention. |

**5. Exclusions and CUT-CANDIDATES.**

This plan changes agent instructions only: no application fixes, schema changes, Jini APIs, runtime flags, deletion policy, or new monitoring. Both clones were confirmed on `merge-1029`; other jobs’ edits were left untouched. No tests, builds, servers, installs, Electron, or localhost requests ran.

**CUT-CANDIDATES:** repeated Bad/Good examples; three verbose persona-specific Cost templates; another diagnostic reference file; extending `performance-engineering` now; new benchmark infrastructure; automated skill-loading gates; migrating webviews because current Electron docs discourage them. Park these unless a separate requirement justifies them.

**6. Effort and dependencies.**

**3–5 hours of Codex work:** condense and reconcile evidence, 1–1.5 h; Electron page, 1–1.5 h; persona/registry wiring and static review, 0.5–1 h; source commit and verified sync, 0.5–1 h. Wiring follows the canonical contract; sync follows source review and locating the actual source checkout. Runtime memory validation is outside this estimate.

**7. Owner questions.**

None needed for the content decision. Recommend seven general checks, one desktop-only reference, and documentation-only installation. The implementer should resolve the source checkout/sync location before transferring files; this is an operational discovery gap, not a product decision.