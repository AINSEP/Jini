# OD PR inventory — leonaburime-ucla's work on nexu-io/open-design

Full inventory of PRs authored on `nexu-io/open-design` (via fork
`leonaburime-ucla/open-design`), pulled 2026-07-17 via `gh pr list`. 48 total:
15 merged, 18 open, 15 closed-without-merge. This supersedes
`ADS-memory/reports/jini-port/recon/r1-daemon.md`'s directory classification and
`od-reference-branches.md`'s partial list as the source of truth for what
backend/frontend refactor work already exists upstream — those docs only knew
about a handful of these.

**Not yet done**: per-PR test coverage verification. Checking out each branch
and running its test suite + coverage report is real work that needs a cloud
dispatch, not something checked here yet — see "Next steps" at the bottom.

## Merged (15) — landed upstream, safe to treat as done

| PR | Title | Notes |
|---|---|---|
| #5164 | guard: catch `@ts-nocheck` files with unresolved relative imports | — |
| #5166 | platform-barrel-split (pilot for #5165) | Maps to `@jini/platform` |
| #5167 | download-barrel-split | — |
| #5168 | sidecar-barrel-split | Maps to `@jini/sidecar` |
| #5170 | host-barrel-split | — |
| #5171 | contracts events-barrel-split | — |
| #5174 | contracts renderMetadataBlock decompose | — |
| #5191 | migration-flat-grouping | — |
| #5192 | browser-flat-grouping | — |
| #5193 | cli-help-flat-grouping | — |
| #5194 | design-flat-grouping | — |
| #5195 | plugins fold (plugin-asset-cache/plugin-preview-bakes) | Already the source of `@jini/platform`'s asset-cache addendum |
| #5196 | prompt-templates fold into media/ | — |
| #5200 | agent-protocol/ capability-barrel (acp.ts + pi-rpc.ts) | Exactly the target flagged as a good next Jini candidate — already done upstream |
| #5400 | contracts: agent-ready capability contracts + design RFCs | — |

## Closed without merging (15) — why, categorized

**Real bug found, then fixed, then approved — closed for unrelated (organizational) reasons after the fix landed:**

| PR | Bug found | Resolution |
|---|---|---|
| #5127 (cli.ts capability-barrel) | `mrcfps`: moved plugin subcommand dynamic imports (`scaffold`/`validate`/`pack`/etc., 13 of them) still resolved to stale `./plugins/...` paths post-move — a real runtime blocker | Fixed by author, re-reviewed, `mrcfps` APPROVED. Closed anyway: "this kind of daemon CLI architecture sequencing is part of our internal planning" |
| #5131 (memory-domain capability-barrel) | `nettee`: same class of bug — moved CLI subcommand still dynamically imports a path that no longer resolves post-split | Fixed, `nettee` re-reviewed and APPROVED. Closed for the same "internal planning" reason |

**No bug at all — approved, closed purely because nexu-io wants to sequence/own the work internally:**

| PR | Reviewer verdict | Maintainer close reason (verbatim gist) |
|---|---|---|
| #5130 (automation-domain barrel) | APPROVED ×2 | "part of our internal planning, so we are going to close this PR and handle the ordering from our side" |
| #5135 (mcp-domain barrel) | APPROVED | Same |
| #5138 (project-domain barrel) | APPROVED | "the implementation is careful... but we have decided not to merge t[his]" |
| #5148 (agents-domain barrel) | APPROVED | Same pattern |
| #5150 (codex-domain barrel) | APPROVED | "overlaps with internal planning work we want to drive as a coordinated sequence" |
| #5152 (startServer god-function, slice 4) | APPROVED | "We are already handling this specific business-logic sp[lit]..." — **this is the exact branch `@jini/daemon`'s RunLifecycle/EventLog were already harvested from** |
| #5169 (sidecar-proto split) | APPROVED, 110 public names verified preserved | "internal architecture planning" |
| #5173 (plugin-runtime helpers) | APPROVED | "runtime/package architecture cleanup is part of our internal planning" |
| #5198 (db.ts capability-barrel) | APPROVED | "After internal review, we decided not to move forward... the daemon SQLite persistence l[ayer]..." |

**Self-closed by the author — reorganization, not rejection:**

| PR | Reason |
|---|---|
| #5482 (ProjectView.tsx, 18/22 clusters) | "opened by mistake, meant to draft FileWorkspace instead" |
| #5483 (FileWorkspace.tsx, complete) | Base predated the vertical-slice foundation (ADR 0002 + guard + MemorySection/McpClientSection canaries, none merged to main at the time) — carried 100 files/34 commits instead of just FileWorkspace. Superseded by the still-open, isolated #5485 |
| #5484 (FileViewer checkpoint clusters) | Explicit "checkpoint, not for merge" — WIP marker, superseded by the still-open #5486 |

**Genuinely unresolved at close time — the one real exception:**

| PR | State at close |
|---|---|
| #5228 (MemorySection → `features/memory/`, **the canonical reference every Jini vertical-slice extraction is modeled on**) | 32 review rounds. `nettee` (reviewer) found repeated real integration bugs — the most recent: the new stricter `/api/memory/config` port now rejects malformed 2xx responses, but `MemoryModelInline` (a caller) still calls it as if it were the old non-throwing helper, so malformed-success responses could still slip through. Author's own comment: "The refactor did not introduce these bugs. It exposed pre-existing ones" — verified directly against the original 2,636-line monolith via `git show`. Credible, but the PR closed with this specific blocker still open, not fully resolved. |

**Implication for Jini**: the #5228 finding is the same *category* of bug already found once in Jini's own work (browser-chrome's `homeLabel` bug — a caller not updated after a port's behavior changed). Worth specifically checking every Jini extraction's callers for "did a stricter/changed port contract leave an old non-throwing-shaped call site behind" — not just the slice's own internals.

## Open, unmerged (18) — real work sitting on live branches

**Backend, not yet triaged for Jini relevance:**
`design-systems-capability-barrels` (#5088 — the reference pilot itself, now an actual PR, not just the RFC issue), `arch/chat-run-extraction` (#5128), `arch/server-preamble-1` (#5132, slice 2), `library-capability-barrel` (#5133), `run-capability-barrel` (#5139 — check overlap with the 62-file `runtimes/` target), `arch/server-preamble-2` (#5147, slice 3), `telemetry-capability-barrel` (#5149), `export-capability-barrel` (#5151), `config-flat-grouping` (#5189), `auth-flat-grouping` (#5190), `tools-connectors-cli` split (#5197), `langfuse-trace-barrel` (#5199).

**Frontend, already known relevant to Jini's `@jini/chat-react`:**
`refactor/web-chat-pane-slice` (#5461), `refactor/web-chat-composer-slice-pr` (#5465).

**Frontend, OD-product (per the packages/ui scoping decision) — not engine material:**
`refactor/web-handoff-slice` (#5474), `refactor/web-automations-slice` (#5475).

**Frontend, new — supersede the self-closed checkpoints above:**
`agent/file-workspace-clean` (#5485 — clean FileWorkspace.tsx decomposition), `agent/file-viewer-clean` (#5486 — FileViewer.tsx version-history/export-toast/deck-slide-nav clusters). Worth checking against the "FileViewer is mostly viewer-shell + 2 product-specific pieces" read that fed the already-dispatched viewer-shell PR — same pattern of misses found 3 times already this session (daemon.ts, hooks/, edit-mode/) means this deserves a real read, not a name-based assumption.

## Next steps (not done here — needs cloud dispatch, not local subagents)

1. For every CLOSED-with-real-bug or OPEN PR above that's Jini-relevant: check out the branch, run its existing test suite, get real coverage numbers (lines/branches/functions/statements) the same way the six god-component extractions did.
2. Scope `run-capability-barrel` (#5139) against the `runtimes/` 62-file target specifically — unclear yet if it's the same thing or a narrower "run" resource.
3. Read #5485/#5486 in full against what viewer-shell (Jini PR #5) already extracted from `FileViewer.tsx`, and check #5482's 18/22-cluster `ProjectView.tsx` work against the "only one generic exception" read that produced `useResizableSplitPane`.
