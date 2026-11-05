---
name: code-navigation
version: 0.1.0
last_updated: 2026-06-28
description: Route a codebase search or understanding task to the right retrieval backend. Use when you need to read the code, find where X is, who calls Y, what does Z call, trace the call chain, find references to a symbol, check if something is used anywhere, measure the impact of changing something, understand the architecture, explore the codebase, or find the feature that does X. Chooses between rg and the graph analyzers (codegraph, code-review-graph, codebase-memory-mcp, graphify, serena, understand-anything) by query class, with rg as the always-available fallback.
---

# Skill: Code Navigation

Classify the query, then use the best retrieval tool for that class. This skill
holds the cross-backend routing policy; deep per-tool mechanics for the local
graph backends live in `<AI_DEV_SHOP_ROOT>/skills/codebase-graph/SKILL.md`.

Reached either directly (its own triggers) or via
`<AI_DEV_SHOP_ROOT>/skills/general-behavior/SKILL.md`, the universal dispatcher
every agent carries.

## Core rules

1. **Classify, then route** (table below). Query classes have different best
   tools — there is no single "best" search tool.
2. **`rg` is the terminal fallback for every class**, and the correct *primary*
   tool for literal / config / markdown / prose / exact-string targets and for
   anything freshness-sensitive (graphs go stale after edits; `rg` never does).
3. **Graph output is a hypothesis until validated.** Before acting on a
   structural result that matters (callers you will refactor, a "no path" /
   "dead code" claim, a change-impact set), confirm it against direct file
   reads / `rg`.
4. **Degrade gracefully.** Analyzer backends or their indexes may be absent,
   disabled, or stale. Walk the fallback chain; end at `rg`. Never dead-end
   because a graph tool is missing.
5. **Cross-host.** This toolkit runs under Claude Code, Codex CLI, and Gemini
   (agy). Prefer CLI-invocable tools. MCP backends (Codebase Memory MCP, serena)
   may be unreachable on a given host — if so, use the CLI step in the chain.
6. **Never silently install.** Do not clone, install, configure MCP, or run
   remote installers to obtain a backend — that needs human approval (see
   `codebase-graph/SKILL.md`).

## Routing table

| Query class | Preferred backend | Fallback chain |
|---|---|---|
| literal / config / markdown / prose / exact-string / always-fresh | `rg` | direct file reads |
| direct callers / references | `codegraph` or `serena` | `rg` sanity check |
| transitive callers / multi-hop impact / change-impact | `code-review-graph` or `codebase-memory-mcp` | `codegraph` → `rg` |
| reachability / path / "prove no path" / community | `graphify` | `codebase-memory-mcp` → `rg` |
| architecture / hubs / blast-radius / dependency clusters | `code-review-graph` or `codebase-memory-mcp` | `graphify` → `rg` + manual reads |
| LSP-exact declaration/reference (overloaded or aliased names) | `serena` | `codegraph` → `rg` |
| natural-language "find the feature that does X" (no literal keyword) | `understand-anything` | `rg` keyword expansion + reads |

## Operating pattern

1. Restate the query class when it affects tool choice.
2. Check whether the preferred backend is available and fresh enough (capability
   + freshness checks for Graphify / Codebase Memory MCP are in
   `codebase-graph/SKILL.md`).
3. Query the preferred backend, or the next item in its fallback chain if the
   preferred one is unavailable, stale, or too noisy.
4. Validate important graph / semantic / LSP-derived conclusions against source.
5. **Report the evidence path:** which backend was used, whether a fallback was
   taken, and the files or literals that confirmed the answer. Never present a
   graph-inferred relationship as fact without its confidence/source.

## Freshness guidance

Use `rg` first when the answer depends on the exact current working tree:
uncommitted edits, generated config, markdown/prose text, error strings, or
recently changed code. Use graph backends for structure and impact, but treat
their results as potentially stale unless their freshness checks or target
metadata prove otherwise.

## Backend delegation

- **Graphify** and **Codebase Memory MCP**: capability checks, freshness
  metadata, query-first commands, and the default safety policy are in
  `<AI_DEV_SHOP_ROOT>/skills/codebase-graph/SKILL.md`.
- **codegraph / serena / understand-anything**: invocation, presence checks, and
  caveats are in `codebase-graph/SKILL.md` under "Candidate Backends (optional,
  not blessed)". These are clone/audit-only and have no capability validator —
  verify the backend's path exists before use, and if it is unavailable, stale, or
  unsupported, move to the listed fallback without blocking.

## Future: the `ads-router` facade

A deterministic `ads-router` CLI facade (planned, not yet built) will encapsulate
this routing — agents will call one entry point (`ads-router query --class ...`)
instead of choosing a backend, wrapping MCP backends behind a stdio probe so
every host invokes everything as a shell call. Until it ships, follow this table
directly; once it ships, prefer it over manual routing.
