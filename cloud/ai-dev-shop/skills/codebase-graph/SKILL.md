---
name: codebase-graph
version: 0.3.0
last_updated: 2026-06-28
description: Use when Coordinator or CodeBase Analyzer needs an optional local codebase graph backend, stale graph detection, or query-first codebase navigation. Owns the deep per-backend mechanics for Graphify and Codebase Memory MCP (blessed, validator-gated) and for codegraph, code-review-graph, serena, and understand-anything (candidate, not blessed) with AI Dev Shop capability checks and human checkpoints.
---

# Skill: Codebase Graph

This skill lets AI Dev Shop use optional local graph backends as reusable repo
maps without letting third-party tools bypass harness policy.

**Entry point:** Agents reach this skill via
`<AI_DEV_SHOP_ROOT>/skills/code-navigation/SKILL.md`, which classifies the query
and routes here when Codebase Memory MCP or Graphify is the selected backend.
That skill owns the cross-backend routing table; this skill owns those two
backends' capability checks, freshness checks, safety policy, and invocation
guidance.

Backends fall into two tiers. **Blessed** backends are vendored under
`integrations/` and gated by a capability validator under
`harness-engineering/validators/`; prefer these. **Candidate** backends are
clone/audit-only (their `integrations/` checkouts are `.gitignored`), have **no
capability validator**, and are documented for evaluation and opportunistic use —
treat them as optional and unverified.

Blessed backends:

- **Codebase Memory MCP**: persistent local knowledge graph exposed through CLI
  and MCP tools. Best first choice for file/symbol lookup, source snippets,
  architecture summaries, and change-impact checks.
- **Graphify**: structural graph extraction with dependency/community mapping,
  graph reports, and query/path/explain commands. Best when community reports or
  Graphify-specific traversal are useful.

Candidate backends (optional, not blessed — see "Candidate Backends" below):

- **codegraph**: CLI graph backend (callers / impact / explore / query).
- **serena**: LSP-exact declarations and references via MCP (stdio).
- **understand-anything**: tree-sitter + LLM-enriched semantic / natural-language
  search.

Direct `rg` and file reads remain the mandatory fallback and the validation path
for important conclusions — doubly so for candidate backends.

## Ownership

- Upstream checkout location: `<AI_DEV_SHOP_ROOT>/integrations/graphify/upstream/`
- Upstream skill reference: `<AI_DEV_SHOP_ROOT>/integrations/graphify/upstream-skill/codex/SKILL.md`
- Capability check: `<AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh`
- Freshness check: `<AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py`
- Per-target Graphify output: `<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/`
- Graphify run path: set `GRAPHIFY_OUT` to the per-target reports directory before invoking the CLI
- ADS freshness metadata: `<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/.ads-graphify-status.json`
- Codebase Memory MCP upstream checkout: `<AI_DEV_SHOP_ROOT>/integrations/codebase-memory-mcp/upstream/`
- Codebase Memory MCP binary: `<AI_DEV_SHOP_ROOT>/integrations/codebase-memory-mcp/bin/codebase-memory-mcp`
- Codebase Memory MCP capability check: `<AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_codebase_memory_capability.sh`
- Codebase Memory MCP local cache home: `<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home/`
- Codebase Memory MCP setup docs: `<AI_DEV_SHOP_ROOT>/integrations/codebase-memory-mcp/README.md`

Candidate-backend ownership (clone/audit-only, `.gitignored`, no validator):

- codegraph CLI: `<AI_DEV_SHOP_ROOT>/integrations/codegraph/upstream/dist/bin/codegraph.js` (run with `node`)
- serena MCP server: `<AI_DEV_SHOP_ROOT>/integrations/serena/upstream/scripts/mcp_server.py`
- understand-anything scripts: `<AI_DEV_SHOP_ROOT>/integrations/understand-anything/{build-graph,search-graph,enrich-graph-batch}.mjs`
- understand-anything upstream skills: `<AI_DEV_SHOP_ROOT>/integrations/understand-anything/upstream/understand-anything-plugin/skills/`
- MCP stdio probe (wraps serena, and any MCP backend, as a shell call): `<AI_DEV_SHOP_ROOT>/harness-engineering/retrieval-evals/benchmark-suite/tools/mcp_probe.py`

Target-named folders under `reports/graphify-out/` are storage namespaces, not
target-local output. For example, `reports/graphify-out/harness-engineering/`
is allowed; a generated `graphify-out` directory inside `harness-engineering`
is not.

Do not put downloaded third-party source under `harness-engineering/`. Harness
owns checks and policy; `integrations/` owns third-party source references.

## Backend Selection

Before broad codebase discovery, check both optional backends:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_codebase_memory_capability.sh
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh
```

Interpret results conservatively:

- `enabled`: backend is usable now.
- `unverified`: some local assets exist, but a required executable/config path
  is missing or not proven.
- `unavailable`: no usable local installation was found.

Default preference:

1. Use Codebase Memory MCP for file/symbol lookup, architecture summary,
   `detect_changes`, `get_code_snippet`, and MCP-native workflows.
2. Use Graphify for community reports, Graphify graph traversal, and as a
   fallback structural map when Codebase Memory MCP is unavailable.
3. Use direct `rg`/file reads when both backends are unavailable, stale, too
   noisy, or insufficiently specific.

If neither backend is available and the target is large or unfamiliar, explain
the options and ask before downloading or installing either one. Do not silently
clone, pull, run remote installers, configure MCP clients, install hooks, or
write agent config.

Suggested explanation:

> AI Dev Shop can optionally use a local codebase graph backend before broad
> source reading. Codebase Memory MCP builds a persistent local knowledge graph
> with CLI/MCP tools for file search, symbol lookup, snippets, architecture, and
> change impact. Graphify builds a structural dependency/community graph and
> report. Both are local optional integrations under `integrations/`. Do you
> want me to set up one, or proceed with direct `rg` and file reads?

## Codebase Memory MCP Capability Check

Before relying on Codebase Memory MCP, run:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_codebase_memory_capability.sh
```

If the status is `enabled`, index or refresh the target. Use the local
integration binary when the capability report says `Local binary: enabled`;
otherwise use `codebase-memory-mcp` from `PATH` when the report says
`PATH binary: enabled`.

```bash
HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli index_repository '{"repo_path":"<TARGET_REPO>"}'
```

Then query through CLI tools:

```bash
HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli get_architecture '{"project":"<PROJECT_NAME>","aspects":["all"]}'

HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli search_graph '{"project":"<PROJECT_NAME>","name_pattern":".*Handler.*","limit":20}'

HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli detect_changes '{"project":"<PROJECT_NAME>"}'
```

Set `<CODEBASE_MEMORY_COMMAND>` to
`<AI_DEV_SHOP_ROOT>/integrations/codebase-memory-mcp/bin/codebase-memory-mcp`
for the local integration binary or `codebase-memory-mcp` for a PATH install.
Use `list_projects` after indexing to resolve the generated project name. The
current binary may not expose every README-advertised tool through CLI mode; if a
tool returns `unknown tool`, report that and fall back to available tools or
direct source reads.

If `search_code` returns zero results for a term known to exist in source files,
fall back to direct `rg`. Graph-indexed text search may not cover all raw file
content, especially non-structural literals and documentation strings.

## Graphify Capability Check

Before relying on Graphify, run:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh
```

Interpret status conservatively:

- `enabled`: `graphify` CLI is installed and usable now.
- `unverified`: managed upstream checkout exists, but the CLI is not installed.
- `unavailable`: neither CLI nor managed checkout is present.

If the user explicitly wants Graphify and the managed checkout is missing, run:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh --download
```

If the user asks to update the managed checkout, run:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh --update
```

If the user asks to refresh the copied upstream skill reference after an
upstream update, run:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_capability.sh --sync-skill
```

Downloading or updating Graphify is a human-approved action. Do not silently
clone or pull third-party code during ordinary analysis.

## Default Safety Policy

Default to code-only structural graphing. Do not run any of these unless the
user explicitly requests or approves it:

- `graphify extract <path>` full semantic extraction
- `--mode deep`
- docs/PDF/image/video/audio semantic extraction
- `graphify global add` or `graphify extract --global`
- `graphify hook install`
- `graphify watch`
- Neo4j push, MCP server, or other long-running integrations

The safe default command after a CLI is available is:

```bash
GRAPHIFY_OUT="$(python3 <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py <TARGET_REPO> --prepare-output --print-output-path)" \
  graphify update <TARGET_REPO> --force
```

Always pass `--force` — without it, incremental runs duplicate existing edges.
Graphify's `update` is pure AST extraction (zero tokens), so a full re-extract
is cheap and correct.

`--prepare-output --print-output-path` creates
`<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/` and prints
that path for `GRAPHIFY_OUT`. Do not let Graphify create a real
`<TARGET_REPO>/graphify-out/` directory. If an older non-empty
`<TARGET_REPO>/graphify-out/` directory already exists, rerun the prepare step
with `--migrate-existing-output` to move that generated output into the reports
location before running Graphify again.

Use `--no-cluster` when the user wants the cheapest structural pass and does not
need community/report output:

```bash
GRAPHIFY_OUT="$(python3 <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py <TARGET_REPO> --prepare-output --print-output-path)" \
  graphify update <TARGET_REPO> --force --no-cluster
```

## Freshness Metadata

After creating or updating a graph, write freshness metadata:

```bash
python3 <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py <TARGET_REPO> --write --mode code_update
```

For an approved semantic pass, add:

```bash
python3 <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py <TARGET_REPO> --write --mode semantic_extract --semantic-enabled --human-approved-semantic
```

The metadata file is
`<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/.ads-graphify-status.json`
and includes:

```json
{
  "generated_at": "YYYY-MM-DDTHH:MM:SSZ",
  "target_root": "<absolute path>",
  "graph_output_dir": "<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>",
  "target_git_head": "<git sha or null>",
  "target_dirty": true,
  "latest_source_mtime": "YYYY-MM-DDTHH:MM:SSZ",
  "graph_json_mtime": "YYYY-MM-DDTHH:MM:SSZ",
  "graphify_version": "<graphify --version output>",
  "mode": "code_update",
  "semantic_enabled": false,
  "human_approved_semantic": false
}
```

A graph is stale when any of these are true:

- `<ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/graph.json` is missing
- status metadata is missing
- `target_git_head` differs from the current target repo `HEAD`
- the target repo is dirty and the graph was generated before the changed files
- the current task requires semantic/docs/media coverage but the status says
  `semantic_enabled: false`

Check freshness mechanically:

```bash
python3 <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_graphify_freshness.py <TARGET_REPO>
```

When stale, prefer the `GRAPHIFY_OUT=... graphify update <TARGET_REPO> --force`
command above for code questions. Ask for human approval before escalating to
semantic extraction.

## Query-First Use

When a fresh graph exists and the user asks a codebase or architecture question,
query the graph before broad raw-file discovery:

```bash
graphify query "<question>" --graph <ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/graph.json
graphify path "<A>" "<B>" --graph <ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/graph.json
graphify explain "<concept>" --graph <ADS_MEMORY_ROOT>/reports/graphify-out/<target-name>/graph.json
```

If the query result is insufficient, say so and fall back to targeted source
inspection. Do not present graph-inferred relationships as fact without the
confidence and source evidence returned by Graphify.

For Codebase Memory MCP, prefer exact structural searches first, then retrieve
source snippets:

```bash
HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli search_graph '{"project":"<PROJECT_NAME>","name_pattern":".*Graphify.*","limit":20}'

HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli get_code_snippet '{"project":"<PROJECT_NAME>","qualified_name":"<QUALIFIED_NAME>"}'

HOME="<ADS_MEMORY_ROOT>/.local-artifacts/codebase-memory-mcp-home" \
  <CODEBASE_MEMORY_COMMAND> \
  cli search_code '{"project":"<PROJECT_NAME>","pattern":"literal text","limit":20}'
```

For direct fallback, use `rg`, `rg --files`, `sed`, and focused file reads.
Record that the result came from direct source inspection rather than graph
evidence.

## Candidate Backends (optional, not blessed)

These three are routed to by name in
`<AI_DEV_SHOP_ROOT>/skills/code-navigation/SKILL.md` but are **not blessed**: their
heavy source is `.gitignored` (clone/audit-only, not vendored), so a fresh clone
does not contain them.

The registry of every backend — tier, upstream URL, requirements, install cost,
and validator path — is
`<AI_DEV_SHOP_ROOT>/integrations/backends.manifest.json`. Read it to render a
guided-install choice for the user; never install from it automatically.

**codegraph** now has a capability validator and guided installer (use the flow in
its section below). **code-review-graph**, **serena**, and **understand-anything**
do not yet — for those, verify presence directly (the tool's binary / server /
script path), and on any failure fall back down the chain to `rg` without blocking.

**Where indexes go** (manifest `storage` block): point a tool's index at
`<ADS_MEMORY_ROOT>/.local-artifacts/analyzers/<tool>/<target>/` whenever
it supports an external data dir — graphify (`GRAPHIFY_OUT`), Codebase Memory MCP
(`HOME`), code-review-graph (`--data-dir`). codegraph / understand-anything /
serena write into the target repo instead; offer to gitignore those in the target.

Shared rules for all three:

1. **Verify presence first.** The backend is usable only if its script/server
   path under `integrations/` exists. If the path is missing, treat the backend as
   `unavailable` and move to the next item in the routing table's fallback chain.
2. **Never auto-install.** Do not clone, pull, `npm install`, or fetch upstream to
   obtain a candidate backend — that is a human-approved action, same policy as the
   blessed backends.
3. **Output is a hypothesis.** Graph / LSP / semantic results must be validated
   against direct source reads before you act on anything that matters.
4. **Index pollution.** codegraph and understand-anything write their index
   *inside the target repo* (`<TARGET_REPO>/.codegraph/`,
   `<TARGET_REPO>/.understand-anything/`). Add these to the target's ignore set or
   clean them up; do not commit them into the target.

### codegraph (CLI graph backend)

Graph backend for callers / change-impact / explore / structural query. Index dir
`<TARGET_REPO>/.codegraph/`. **codegraph has a capability validator and a guided
installer** (unlike serena / understand-anything below), so for codegraph use this
flow instead of a bare path check.

**Step 1 — capability check (read-only, always safe):**

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_codegraph_capability.sh
```

Read `Overall:` from the report (or `overall_status` with `--json <path>`):

- `enabled` — built and runnable; go to Step 3.
- `unverified` — checkout exists but not built; finish with `--build` (Step 2).
- `unavailable` — not installed; offer guided install (Step 2) or fall back to the
  routing table's chain (`codegraph` → `rg`) without blocking.

**Step 2 — guided install (human-approved only):** present the cost from
`<AI_DEV_SHOP_ROOT>/integrations/backends.manifest.json` (codegraph: `node` >=20
<25, npm build, **no API key**, index under `<TARGET_REPO>/.codegraph/`) and ask
before installing. On approval:

```bash
bash <AI_DEV_SHOP_ROOT>/harness-engineering/validators/check_codegraph_capability.sh --download --build
```

Never run `--download`/`--build` without explicit approval — same policy as the
blessed backends.

**Step 3 — query.** Let `CG=<AI_DEV_SHOP_ROOT>/integrations/codegraph/upstream/dist/bin/codegraph.js`.

```bash
# one-time index (skip if .codegraph/ already exists and is fresh)
node "$CG" init <TARGET_REPO>

# direct callers / references of a symbol
node "$CG" callers <SYMBOL> -p <TARGET_REPO> --json

# change-impact set for a symbol
node "$CG" impact <SYMBOL> -p <TARGET_REPO> --json

# natural-language / dependency-path exploration
node "$CG" explore "<QUERY>" -p <TARGET_REPO> --json

# structural pattern query (architecture / config class)
node "$CG" query "<PATTERN>" -p <TARGET_REPO> --json
```

Use for the `callers` and `change_impact` classes when Codebase Memory MCP is
unavailable; `--json` everywhere for parseable output. Re-run `init` after edits —
the index is not auto-refreshed.

### code-review-graph (all-in-one structural + architecture)

Strongest all-in-one: callers/impact plus architecture-health analytics (hub/
god-component detection, blast-radius, bridge nodes). Installs cleanly user-level
via `uv tool install` (no validator yet — verify `code-review-graph --version`
runs; else treat as unavailable and fall back). It is an MCP server, queried like
serena through the stdio probe. **Store its DB outside the target** with
`--data-dir`:

```bash
CRG_DATA="<ADS_MEMORY_ROOT>/.local-artifacts/analyzers/code-review-graph/<target-name>"
code-review-graph build  --repo <TARGET_REPO> --data-dir "$CRG_DATA"
code-review-graph status --repo <TARGET_REPO> --data-dir "$CRG_DATA"
# query tools (query_graph, get_impact_radius, semantic_search_nodes, hub nodes)
# via the stdio probe against: code-review-graph serve --repo <TARGET_REPO>
```

Semantic search needs the heavy `[embeddings]` extra (sentence-transformers/torch)
or a cloud embedding key — gated, not bundled; use understand-anything for NL
instead. Treat structural/architecture output as a hypothesis; validate against
source.

### serena (LSP-exact, via MCP stdio)

LSP server, not a graph — best for exact declarations/references of overloaded or
aliased symbols. Reachable on any host by wrapping the stdio MCP server in the
probe (no MCP client config needed). Let
`SERENA=<AI_DEV_SHOP_ROOT>/integrations/serena/upstream/scripts/mcp_server.py` and
`PROBE=<AI_DEV_SHOP_ROOT>/harness-engineering/retrieval-evals/benchmark-suite/tools/mcp_probe.py`.

```bash
# server command (reused below)
SERVER=(python3 "$SERENA" start-mcp-server --project <TARGET_REPO> --transport stdio)

# confirm the LSP is up and which tools exist (look for find_symbol)
python3 "$PROBE" --list -- "${SERVER[@]}"

# resolve a definition
python3 "$PROBE" --call find_symbol \
  --args '{"name_path_pattern":"<SYMBOL>","relative_path":"<REL_PATH>","include_body":false,"depth":1}' \
  -- "${SERVER[@]}"

# find references / callers (LSP-exact)
python3 "$PROBE" --call find_referencing_symbols \
  --args '{"name_path":"<NAME_PATH>","relative_path":"<REL_PATH>","max_answer_chars":20000}' \
  -- "${SERVER[@]}"
```

Use for the LSP-exact class (and as a `callers` fallback) when name overloading
makes `rg`/codegraph ambiguous. The probe runs the server per call; expect cold
LSP start latency on the first query.

### understand-anything (semantic / natural-language)

tree-sitter structural graph plus optional LLM enrichment — best for "find the
feature that does X" with no literal keyword. Graph at
`<TARGET_REPO>/.understand-anything/knowledge-graph.json`. Let
`UA=<AI_DEV_SHOP_ROOT>/integrations/understand-anything`.

```bash
# build the structural graph (writes .understand-anything/knowledge-graph.json)
node "$UA/build-graph.mjs" <TARGET_REPO>

# semantic search; output lines: [score] type: name — path
node "$UA/search-graph.mjs" <TARGET_REPO> "<NL_QUERY>"
```

The raw `build-graph` output is structural only. For good natural-language recall
run the LLM enrichment pass before searching:

```bash
# batched enrichment — needs another LLM to write the summaries
# (provider-agnostic: any capable model, local or hosted). Batched = ~15x faster.
node "$UA/enrich-graph-batch.mjs"
```

Enrichment makes LLM calls (to whichever provider you configure — no specific
vendor required) and rewrites the graph — run it only when the task needs semantic
recall, and prefer it over the unenriched graph for NL queries. Richer per-task workflows live in the upstream skills under
`integrations/understand-anything/upstream/understand-anything-plugin/skills/`
(`understand-explain`, `understand-onboard`, `understand-knowledge`, etc.). For a
plain keyword that exists in source, prefer `rg` — UA's value is conceptual, not
literal, lookup.

## Agent Usage

Coordinator uses this skill for:

- deciding whether Codebase Memory MCP or Graphify is available
- enforcing human checkpoints before downloading, installing, configuring MCP,
  installing hooks, or running persistent background modes
- routing CodeBase Analyzer with graph evidence when available

CodeBase Analyzer uses this skill for:

- initial repo map discovery
- dependency hotspot hints
- file/symbol lookup before token-heavy sampling
- query-first architecture exploration before broad source reads

Graph backend evidence supplements CodeBase Analyzer sampling. It does not
remove the Sampling Notice requirement in `skills/codebase-analysis/SKILL.md`.
