# Analyzer Capability Matrix

A side-by-side view of which codebase-analysis backend is strong at which **query
type**. The backends barely overlap — each owns at least one row no other tool
covers — so the intended design is to route each query to the backend that owns it
(with `rg` as the always-fresh fallback), not to install everything.

Use this to pick a *subset* before committing to a heavy index. Full registry
(tiers, install cost, storage, validators) lives in
`integrations/backends.manifest.json`; query mechanics live in
`skills/codebase-graph/SKILL.md`.

## Matrix

| Query type | ripgrep<br>(rg) | code-<br>graph | understand-<br>anything | graphify | codebase-<br>memory-mcp | code-review-<br>graph | serena |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Literal / exact text**<br>(always-fresh,<br>no index) | ✅ | | | | △ | △ | |
| **Direct callers**<br>(1-hop, exact<br>`file:line`) | △ | ✅ | | ✅ | ✅ | ✅ | ✅ |
| **Transitive callers**<br>(multi-hop<br>call chain) | | | | △ | ✅ | △ | |
| **Change-impact /<br>blast-radius**<br>(downstream) | | ✅ | | △ | ✅ | ✅ | |
| **Reachability /<br>shortest path**<br>(A→B) | | | | ✅ | △ | △ | |
| **Community /<br>cluster<br>detection** | | | | ✅ | ✅ | △ | |
| **Architecture health**<br>(hubs, god-components,<br>bridges) | | | | △ | △ | ✅ | |
| **Natural-language<br>semantic search**<br>("find the thing<br>that does X") | | | ✅ | | | △ | |
| **LSP-exact<br>reference /<br>definition** | | | | | | | ✅ |
| **Config / ADR /<br>decision<br>memory** | ✅ | | | | ✅ | | |
| **Runtime trace<br>ingestion** | | | | | ✅ | | |

**Legend** — ✅ primary/strong · △ partial or caveated · blank none

## What each tool uniquely owns

Every column owns at least one row no other tool does — this is why the multi-backend
routing facade exists rather than a single "best" tool:

- **ripgrep** — always-fresh literal/exact text. No index, never stale, but blind to
  the call graph (misses callers reached through re-exports). The default and the
  terminal fallback.
- **codegraph** — cleanest **direct (1-hop) callers + change-impact** from a fast CLI
  index. Smallest graph index (~3× source). Best low-friction structural tool.
- **understand-anything** — **natural-language / semantic** search: finds the file by
  meaning when you don't know the symbol name. The only true semantic winner.
- **graphify** — **reachability / shortest-path** and whole-repo community/cluster
  reports. Reach for it for "is there any path A→B?" and dependency clusters.
- **codebase-memory-mcp** — **multi-hop transitive call chains** in one query, plus
  ADR/decision memory and runtime-trace ingestion. The max-depth structural option.
- **code-review-graph** — **architecture health**: god-component/hub detection, bridge
  nodes (betweenness), surprising connections, blast-radius. Strongest all-in-one.
- **serena** — **LSP-exact** references/definitions: compiler-accurate even with
  overloaded, aliased, or re-exported names where AST graphs only guess.

## Caveats behind the △ marks

- **Semantic search needs a prep pass.** `understand-anything` needs an LLM
  *enrichment* pass; `code-review-graph`'s semantic mode needs a vector *embedding*
  pass (the `[embeddings]` extra — `sentence-transformers`/torch, heavy — or a cloud
  provider + API key). Without that pass both fall back to keyword and miss NL queries.
- **Cypher surface overlap.** `codebase-memory-mcp` and `code-review-graph` both expose
  a Cypher-style query surface; cbm's dialect is the finickier of the two.
- **Transitive vs blast-radius direction.** cbm walks *upstream* caller chains
  (who calls me, transitively); crg's blast-radius is *downstream* impact (what I
  affect). Related but not the same — hence both carry marks on those rows.
- **cbm's `config`/ADR + trace rows are real tools** (`manage_adr`, `ingest_traces`)
  but are structural-memory features outside ordinary callers/impact analysis — treat
  them as cbm's distinctive extras, not a reason to pick it for plain navigation.
- **Footprint matters for the heavier rows.** Graph indexes are far larger than source:
  codegraph ~3×, codebase-memory-mcp ~6×, code-review-graph ~13×. See the manifest
  `index_size_note` before building on a large repo.

## How to read it for tool selection

1. Find the row(s) matching the user's question.
2. Prefer the ✅ tool for that row; fall back to a △ tool only if the ✅ tool isn't
   installed and the △ caveat is acceptable.
3. If multiple rows are in play, that's a signal to fan out across a couple of
   backends rather than force one tool to cover all of it.
4. `rg` is always available and always fresh — use it to validate any graph result
   before acting on an irreversible decision.
