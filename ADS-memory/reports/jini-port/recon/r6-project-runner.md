# R6 — Jini `project-runner` + Durable Task Ledger + Cloud-Context Export

Reconciled design (workstreams G+H). Synthesizes seat1-codex-clean.md (git-ref
CAS leases, separate engine run-ledger, staleness fail-closed) and seat3-fable.md
(one-file-per-task JSON, committed index, ADS pipeline reference, staleness
auto-enqueue). **[V] = verified against the repos, [D] = design decision, [I] = inferred.**

Repos glanced [V]:
- `/Users/la/Desktop/Programming/Jini/AI-Dev-Shop` — governance framework:
  `framework/workflows/{job-lifecycle,pipeline-state-format,multi-agent-pipeline,git-strategy,recovery-playbook,trace-schema}.md`,
  role agents under `agents/{coordinator,programmer,code-review,qa-e2e,red-team,…}`,
  and a `todo.md` that is a *framework-improvement* backlog — **not** a per-project
  task list. It already owns an intra-task job lifecycle + pipeline-state format.
- `/Users/la/Desktop/Programming/Tovu-Runner` — a research/CMS scaffold ("thin
  launcher"), NOT the cloud runner. Ignore for this design except as a would-be
  second consumer.

**Core reconciliation principle (settles the ADS overlap):**
- **AI-Dev-Shop governs HOW an agent works a single task** — role pipeline
  (analyze → spec → architect → TDD → implement → review → security → docs), its
  intra-task job-lifecycle state machine, and its pipeline-state format. This is
  *ephemeral working state* that lives inside a task attempt.
- **project-runner governs WHICH task, WHO holds it, WHAT happened** — the queue,
  dependency graph, lease, attempt outcomes, validation results, and resumable
  handoff. This is *durable committed state*.
- They must never keep competing task lists. A runner task **references** an ADS
  pipeline by id (`pipeline: "ads:refactor"`); ADS never enumerates Jini tasks,
  and `AI-Dev-Shop/todo.md` is off-limits as a task ledger [V — it isn't one].

---

## 1. `project-runner/` folder layout + bins

```text
project-runner/
├── config.yaml                     # committed: repos, remotes, lease namespace,
│                                   #   ttl defaults, context staleness threshold
├── schemas/                        # committed: JSON Schemas (fail-closed validation)
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── lease.schema.json
│   ├── validation-result.schema.json
│   └── context-manifest.schema.json
├── ledger/
│   ├── tasks/<TASK-ID>.json        # committed: ONE FILE PER TASK (merge-friendly)
│   ├── index.json                  # committed but GENERATED: fast cloud read cache
│   ├── sessions/<TASK-ID>/<attempt-id>/
│   │   ├── attempt.json            # committed: outcome, branch, source/head SHA
│   │   ├── summary.md              # committed: concise resumable handoff
│   │   └── validation.json         # committed: structured validation results
│   ├── decisions.md                # committed: append-only human/agent decisions
│   ├── blockers.md                 # committed: append-only open blockers
│   └── compatibility/*.yaml        # committed: OD ownership/source-map links
├── leases/                         # GITIGNORED: local flock files + lease-token secret
├── src/
│   ├── ledger/     (task parse, transition validation, dep resolver, `next`)
│   ├── leases/     (git-ref CAS + local flock, heartbeat, reap)
│   ├── sessions/   (attempt lifecycle, handoff writer)
│   ├── git/        (worktree/branch/partial-clone, ref CAS primitives)
│   ├── upstream/   (GitHub fetch + triage for incorporate-upstream-refactor)
│   ├── context/    (export/import, manifest, staleness)
│   ├── runners/    (codex / claude execution backends — thin)
│   └── validation/ (run declared commands, capture structured results)
└── tests/
```

### Bins (all `--json`, all deterministic, per the requested set)
| Bin | Job | Writes |
|---|---|---|
| `runner next` | Deterministic task selection (§5) | nothing (read-only) |
| `runner claim <id> --agent codex\|claude` | Acquire git-ref CAS lease + open attempt + branch/worktree from pinned source SHA + materialize task packet | lease ref, `attempt.json`, task `status→claimed` |
| `runner heartbeat <id>` | Renew lease (CAS on old ref SHA); auto-invoked on a timer | lease ref |
| `runner validate <id>` | Run task's declared validation commands | `validation.json` |
| `runner finish <id> --outcome done\|handoff\|failed` | Write handoff summary, push branch/PR, release lease, transition task, refresh affected context, unblock dependents | `summary.md`, task status, index |
| `runner sync-od [--branch <b>] [--pr <n>]` | Pull user's upstream OD refactor branch/PR from GitHub, triage, emit `incorporate-upstream-refactor` tasks (§3) | new task files, triage report |
| `runner refresh-context [--repo od\|jini]` | Regenerate committed cloud-context snapshot for HEAD; refuse dirty tree (§4) | `context/snapshots/<commit>/…` |
| `runner reap` | Detect expired leases, record abandoned attempts, return tasks to `ready` (§2) | attempt records, task status |

Governance boundary in practice: `runner claim` materializes a **task packet**
(instructions + ADR/context refs + scope + validations) and names the ADS
pipeline; the agent then follows `AI-Dev-Shop/AGENTS.md` for *how* to execute.
The ADS pipeline-state file lives in the attempt dir as working state and its
final trace is folded into `summary.md`. The runner enforces ADS approval policy
but does not re-implement it.

---

## 2. Ledger files, task schema, states, lease model

### 2a. Committed vs ephemeral
**Committed** (durable memory, survives every session/machine):
- `ledger/tasks/<id>.json`, generated `index.json`, `attempt.json`, `summary.md`,
  `validation.json`, `decisions.md`, `blockers.md`, `compatibility/*.yaml`,
  schemas, `config.yaml`, and small commit-stamped context snapshots (§4).
**Ephemeral / gitignored / object-storage** (never committed):
- Lease-token secret, credentials/env, raw model transcripts, worktree paths &
  PIDs, full command logs & coverage, graph DBs/embeddings/caches, native runtime
  session handles, `leases/*` flock files. (Both seats agree on this split.)

### 2b. Task schema (one file per task — merge-friendly JSON)
Reconciles seat1's validation/approval richness with seat3's scope allow/forbid
lists and `pipeline` reference:
```jsonc
{
  "schemaVersion": 1,
  "id": "JINI-0007",
  "title": "Extract durable run/event stores",
  "type": "extract",                 // extract | incorporate-upstream-refactor | backport | context | chore | fix
  "phase": "daemon-core",            // maps to migration phase
  "status": "ready",
  "priority": 20,                    // lower = sooner
  "repository": "jini",              // jini | open-design
  "pipeline": "ads:refactor",        // ADS governance pipeline id (NOT a task list)
  "source":  { "branch": "main", "commit": "<exact-sha>" },  // pinned baseline
  "target":  { "branchPrefix": "task/JINI-0007" },
  "scope":   { "include": ["packages/persistence-sqlite/**"],
               "exclude": ["packages/runtime-node/**"] },
  "allowedChanges":   ["add stores", "add migrations"],
  "forbiddenChanges": ["edit @jini/contracts DTO shapes"],   // → human checkpoint if needed
  "goal": "…",
  "dependsOn": ["JINI-0005"],
  "adrRefs": ["docs/adr/0003-durable-stores.md"],
  "contextRequired": true,           // fail closed if context snapshot commit ≠ source.commit
  "compatibilityRefs": ["run-events-v1"],
  "approval": { "required": false }, // true ⇒ needs human gate before finish→done
  "validation": [
    { "id": "stores-test", "cwd": ".", "command": "pnpm --filter @jini/persistence-sqlite test",
      "required": true, "timeoutSeconds": 300 }
  ],
  "attemptLimit": 3,
  "leaseTtlMinutes": 40,             // per-task override (cloud long-runs can raise)
  "lastOutcome": null,
  "upstream": null                   // populated only for incorporate-upstream-refactor (§3)
}
```
`index.json` is a generated projection (id, status, phase, priority, dependsOn,
scope digest, active-lease flag) committed only so cloud agents read the queue in
one file instead of globbing N task files. It is a cache; `tasks/*.json` is truth.

### 2c. Task states + legal transitions (reconciled canonical set)
```text
draft            → ready | cancelled
ready            → claimed | cancelled
claimed          → in_progress | ready(reaped) | blocked
in_progress      → validating | blocked | failed | ready(handoff-requeue)
validating       → awaiting_review | in_progress | failed
awaiting_review  → done | in_progress | blocked        # human/merge gate
blocked          → ready | cancelled
failed           → ready | abandoned                    # abandoned after attemptLimit
done             → ready                                 # human-approved REOPEN only
any nonterminal  → superseded                            # replaced by a new task
```
Terminal: `done`, `cancelled`, `abandoned`, `superseded`. `claimed`/`in_progress`
are backed by an active lease+attempt; if the lease dies they are **reaped** back
to `ready` (never silently dropped). Attempt outcomes: `active | handed_off |
succeeded | failed | abandoned`.

### 2d. Lease model — DECISION: git-ref CAS (primary) + local flock (offline only)
**Chosen: dedicated git-ref compare-and-swap in a `refs/jini-lease/*` namespace.**
Justification (why over the alternatives):
- **Cross-machine is the requirement.** Codex cloud and Claude sessions run on
  *different hosts with no shared filesystem* — a file lock (flock) cannot
  coordinate them. The remote git server is the one shared, atomic, already-
  authenticated coordination point both backends reach. [D]
- **Ref over commit (rejects seat3's "push a claim commit").** A lease is
  transient control state, not history. Pushing lease commits to a branch
  pollutes `git log` and races the branch's real content. A dedicated
  `refs/jini-lease/<task-id>` ref is created/updated/deleted atomically by the
  server, carries a tiny JSON blob, and never touches branch history. `git push`
  with `--force-with-lease`-style expected-old-SHA gives true CAS. [D — adopts
  seat1's ref namespace, drops seat3's commit approach]
- **Flock stays, but only as an offline/single-machine fast path.** Tasks flagged
  `remoteRequired` (default true for cloud) may not be claimed via flock alone.
  [D — reconciles both seats]

Mechanics:
- **Claim** = atomically create `refs/jini-lease/<task-id>` pointing at a blob
  `{owner, agent, attemptId, branch, sourceCommit, scopeDigest, ttlMinutes,
  expiresAt, tokenHash}`. Create-if-absent; loser of the race gets a non-fast-
  forward rejection and picks another task. The secret token lives only in
  gitignored `leases/`; the ref stores its hash.
- **Heartbeat** every `min(10, ttl/4)` min: CAS-update the ref (expected old SHA →
  new SHA with a bumped `expiresAt`). A failed CAS means someone reaped/stole it →
  the agent stops and re-selects.
- **TTL** default 40 min (`leaseTtlMinutes` per-task; long cloud runs raise it).
  Missed heartbeat past `expiresAt` ⇒ eligible for reaping.
- **Reaping** (`runner reap`, also run at the top of `next`/`claim`): for each
  expired lease, record the branch head + an `abandoned` attempt in the session
  dir, delete the lease ref, return the task `→ ready`. Never discard the work
  silently.
- **Scope-overlap conflict prevention:** before granting a claim, compute the
  candidate's `scope.include/exclude` glob digest and reject if it overlaps any
  *active* lease's scope digest. Overlap may be overridden only by an explicit
  coordination record in `decisions.md`. This lets many agents run in parallel on
  disjoint file globs safely. [D — merges seat1 scope-overlap + seat3 disjoint globs]

---

## 3. GitHub upstream-refactor incorporation (`type: incorporate-upstream-refactor`)

The user's explicit want: land their *existing* OD server.ts/daemon refactor
branches & PRs (on GitHub) as ledger tasks — safely, with human checkpoints.

**Key stance (from seat1, verified as the correct posture):** these branches are
**reference evidence, not merge candidates.** e.g. `arch/server-startserver-endgame`
is ~258 commits behind current main and `arch/chat-run-extraction`'s extraction
still moves ~3,400 untyped lines behind `deps: any`. A wholesale `git merge`
would regress. So the task type means **"reimplement the seam against current
source, using the upstream branch as the design/patch reference and porting its
characterization tests,"** not "cherry-pick the diff." [V — seat1 l.177-183]

### Flow: `runner sync-od --branch <b>` (or `--pr <n>`)
1. **Fetch (read-only):** fetch the named upstream branch/PR into a gitignored
   sparse/partial clone (`--filter=blob:none`) under `references/` — no OD tree is
   committed. Record the exact fetched SHA. [V — both seats: no committed checkout]
2. **Triage report:** diff the upstream branch against Jini's current baseline;
   classify each changed region as: `port-test` (characterization test worth
   lifting), `reimplement-seam` (a real extraction to redo against current
   source), `already-superseded` (Jini trunk already did it better — the
   `integrated` daemon is more decomposed than the OD checkout [V seat3 l.5]), or
   `product-content-skip` (design-systems/brands/etc., auto-skipped). Emit the
   report to `sessions/` and surface a summary.
3. **Emit ledger tasks:** for each `reimplement-seam`/`port-test` unit, create one
   `incorporate-upstream-refactor` task with:
   ```jsonc
   "type": "incorporate-upstream-refactor",
   "upstream": {
     "repo": "nexu-io/open-design", "ref": "arch/server-startserver-endgame",
     "refCommit": "<fetched-sha>", "prNumber": 42,
     "sourceMapPaths": ["apps/daemon/src/server.ts#startServer"],
     "disposition": "reimplement-seam",         // or port-test
     "referencePatch": "references/patches/JINI-00xx.patch"  // gitignored evidence
   },
   "source": { "branch": "main", "commit": "<current-jini-sha>" },  // reimplement against CURRENT
   "approval": { "required": true }             // human checkpoint (see below)
   ```
   The task's `source.commit` is *current Jini*, not the upstream SHA — you build
   against today's tree; the upstream ref is only cited evidence.
4. **Human checkpoints (required for this type):**
   - **Triage gate:** a human approves the triage dispositions before any tasks
     go `ready` (prevents auto-porting a stale/wrong seam). Recorded in
     `decisions.md`.
   - **Contract/ADR gate:** if the incorporation touches `@jini/contracts` shapes,
     public API, or a security boundary, `approval.required` forces a human
     `awaiting_review → done` gate. [V — both seats list these as human-only]
   - **Merge gate:** the reimplemented seam lands as a review branch/PR that a
     human merges; merge marks `done` and refreshes affected context.
5. **Compatibility anchor:** every incorporate task's validation MUST include the
   ported characterization test (red on the pre-change baseline, green after) and,
   for daemon seams, the **mock-replay parity** check (same `mocks/` traces
   through OD daemon and Jini, normalized streams diffed) [V — seat3 keystone].
   This is what proves "reimplemented seam == upstream behavior" without a merge.

Backport (`type: backport`, Jini→OD fork) is the mirror: red-spec-first PRs to the
user's OD fork — kept as a distinct type so the two directions never share a task.

---

## 4. Cloud-context export layout (workstream H)

Reconciles seat1's per-commit immutable snapshots + fail-closed staleness with
seat3's concrete file list + auto-enqueue. **No export exists today** [V — seat1
l.18, seat3 l.34]; generating the first is an early task (JIN-006-class).

```text
context/                             # (a.k.a. reports/cloud-context/)
├── index.yaml                       # committed: current pointer per repo
├── current/{open-design,jini}.yaml  # committed: → latest snapshot commit + freshness
└── snapshots/<repo>/<commit>/        # committed, IMMUTABLE per source commit
    ├── MANIFEST.json                 # repo URL, branch, EXACT commit, dirty flag,
    │                                 #   tool+version+config, generatedAt, incl/excl
    │                                 #   globs, export hashes, object-store URIs, prev
    ├── overview.md                   # entry doc for a fresh agent
    ├── architecture-map.md           # layers, package graph, composition roots
    ├── seams.md                      # extraction seams + ownership
    ├── hotspots.md                   # god-files, churn, risk
    ├── daemon-symbols.ndjson.zst     # top-symbol index (compressed)
    ├── web-symbols.ndjson.zst
    ├── graphify/summary.json         # ≤5 MB normalized graph export
    └── understand-anything/graph.json# ≤5 MB knowledge-graph slice (+ meta.json)
```

**Committed (small, commit-stamped):** overview/architecture/seams/hotspots docs,
top-symbol indexes, key inbound/outbound call summaries, normalized graph
*summaries*, MANIFEST + freshness. Hard caps: **no single export > 10 MiB, no
snapshot set > 25 MiB** [V seat1]; graph summaries ≤ 5 MB each [V seat3].

**Local-only / object-storage (never committed):** full CodeGraph/CBM SQLite DBs
(157 MB & 587 MB observed [V seat1 l.18]), embeddings, Understand-Anything
intermediate batches, dashboards, raw absolute paths, caches, logs, secrets. Large
blobs referenced by object-store URI + checksum in MANIFEST.

**Staleness policy (fail-closed + advisory tiers):**
- A task with `contextRequired: true` **fails closed** when the pointed snapshot's
  MANIFEST commit ≠ the task's `source.commit` [V seat1 l.533]. Hard gate.
- Advisory: `next`/`claim` computes MANIFEST→HEAD commit distance; **> N commits
  (config default 50) ⇒ warn + auto-enqueue a `type: context` refresh task** [V
  seat3 l.34]. Below N, proceed.
- `runner refresh-context` **refuses a dirty tree**, regenerates for exact HEAD,
  writes an immutable `<commit>/` snapshot, and bumps `current/*.yaml`. Snapshots
  are never edited in place (immutability = reproducibility). Incremental exports
  may describe a commit *range* but must never masquerade as full-current [V seat1].

---

## 5. Determinism + resumability (Codex cloud + Claude)

- **Ledger is memory, not chat.** All durable state is committed files; an agent
  resumes by re-reading `tasks/<id>.json` + the latest `sessions/<id>/*/summary.md`,
  never by replaying a transcript. Any Codex-cloud or Claude session reconstructs
  full state from the repo alone. [V both seats]
- **Deterministic `next` selection** (identical output for any agent, any host):
  1. topo-sort by `dependsOn`;
  2. filter to claimable = `status==ready` ∧ all deps `done` ∧ approvals satisfied
     ∧ `source.commit` still valid ∧ no active lease ∧ no active scope overlap
     ∧ (`contextRequired` ⇒ fresh snapshot);
  3. order by `(priority, phase-rank, id)` — stable, tie-broken by lexical id.
  No randomness, no wall-clock in the ordering. [V — both seats converge here]
- **Atomic, idempotent transitions:** claim = single ref-CAS (loser no-ops and
  re-selects); finish/validate writes are append-or-replace of a named file, so a
  re-run after a crash re-derives the same committed result. `index.json` is always
  regenerable from `tasks/*.json`, so a stale/conflicted index self-heals.
- **Crash/expiry recovery:** dead lease → `reap` records an `abandoned` attempt +
  branch head and returns the task to `ready`; the next agent re-claims from the
  pinned `source.commit`, reads the abandoned attempt's `summary.md` for partial
  progress, and continues. Attempts accumulate (never overwrite) so history is
  auditable across backends. [V — reconciles seat1 reap + seat3 resume]
- **Backend-agnostic:** `runner claim --agent codex|claude` only records identity
  in the lease/attempt; execution semantics are identical. The ADS pipeline
  reference makes "how to work" identical too, so a task started by Codex can be
  finished by Claude with no context loss.
- **Separate engine run-ledger (keep distinct):** the Jini *daemon's* durable run
  store (`runs`/`run_events`/`runtime_sessions`, states
  queued→starting→running→…→succeeded|failed|orphaned) is a DIFFERENT ledger for
  product runtime execution — do not conflate it with the development task ledger.
  [V — seat1 l.436-460; called out so the two never merge.]

---

## Summary of the reconciliation
- **From seat1:** git-ref CAS lease namespace, scope-overlap gating, fail-closed
  `contextRequired`, per-commit immutable snapshots, "upstream branches are
  evidence not merge candidates," separate engine run-ledger.
- **From seat3:** one-file-per-task JSON + committed generated `index.json`, ADS
  pipeline reference (governance/runner split), concrete context file list + size
  caps + >50-commit auto-enqueue, mock-replay parity as the incorporation anchor.
- **New/decided here:** the `incorporate-upstream-refactor` task type + `sync-od`
  triage flow with a mandatory triage human-gate; ref-over-commit CAS justification;
  the unified state machine; the explicit ADS-vs-runner boundary grounded in
  AI-Dev-Shop's actual `framework/workflows/` files.

## Citations
- Governance framework: `AI-Dev-Shop/framework/workflows/{job-lifecycle,pipeline-state-format,multi-agent-pipeline,git-strategy,recovery-playbook}.md`, `AI-Dev-Shop/agents/*`, `AI-Dev-Shop/todo.md` (framework backlog, not a task ledger).
- Prior proposals: `round1/seat1-codex-clean.md` (§"Project Runner and Durable Ledger", "CBM…Export Strategy", "Cloud Agent Workflow"), `round1/seat3-fable.md` (§8-10).
