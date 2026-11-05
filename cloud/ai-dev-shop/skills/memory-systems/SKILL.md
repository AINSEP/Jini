---
name: memory-systems
version: 1.0.0
last_updated: 2026-02-22
description: Use when designing agent memory persistence, choosing between memory frameworks, managing project-knowledge-template files, or preventing telephone-game context degradation across agent handoffs.
---

# Skill: Memory Systems

Agent memory is how knowledge persists beyond a single context window. Without deliberate memory architecture, every agent session starts cold — no knowledge of past decisions, conventions, or failures. With it, agents accumulate expertise and avoid repeating mistakes.

## The Five Memory Layers

Not all memory serves the same purpose. Match the layer to the need.

| Layer | What It Holds | Scope | Volatility |
|---|---|---|---|
| **Working memory** | Current task state, active reasoning | Single session | Discarded on session end |
| **Short-term memory** | Recent interactions, current cycle findings | Active pipeline run | Discarded after run closes |
| **Long-term memory** | Conventions, decisions, past failures | Entire project | Permanent |
| **Entity memory** | Facts about specific entities (users, orders, specs) | Named entity | Updated as entity changes |
| **Temporal knowledge** | How facts change over time with validity windows | Project lifetime | "Invalidate, don't delete" |

In our pipeline:
- **Working memory** = agent's in-context reasoning during a task
- **Short-term memory** = cycle summary passed between pipeline stages
- **Long-term memory** = the `<ADS_MEMORY_ROOT>/knowledge/` files — `project_memory.md`, `learnings.md`, `project_notes.md`, `memory-store.md`, and the `mistakes/` directory
- **Entity memory** = individual spec files, ADRs, agent output artifacts
- **Temporal knowledge** = learnings.md entries with dated context

## The Three Project Knowledge Files as Long-Term Memory

`<ADS_MEMORY_ROOT>/knowledge/project_memory.md` — Stable facts about this project that do not change unless a convention is revised. Read by the Coordinator when injecting context per agent. No size limit but entries should be self-contained facts, not essays.

`<ADS_MEMORY_ROOT>/knowledge/learnings.md` — Failure log. Past mistakes and what to do instead. Append-only. Entries grow the system's "negative space" — what not to do. The most valuable entries are the ones that correct a mistake that happened more than once.

`<ADS_MEMORY_ROOT>/knowledge/project_notes.md` — Live working memory for the project: open questions, deferred decisions, in-progress thinking. Items graduate to `project_memory.md` when they become conventions, or are marked `[RESOLVED]` when answered.

## Invalidate, Don't Discard

When a fact becomes outdated, do not delete it. Mark it with the date it became invalid and why.

```
project_memory.md:
- 2026-01-10: [SUPERSEDED 2026-02-15] API responses used camelCase for all fields.
- 2026-02-15: API responses now use snake_case for all fields. (Changed with billing-v2 migration.)
```

This matters because:
- Debugging past behavior requires knowing what was true at a given time
- Agents working against old artifacts need context for why things look different
- Deletion creates invisible knowledge gaps

## Retrieval Strategy

At dispatch time, the Coordinator selects which memory to inject per agent. Strategies:

**Keyword-based**: Find entries in project_memory.md that mention entities in the current spec (invoice, payment, authentication). Fast and sufficient for most cases.

**Recency-based**: Always include the last N entries from learnings.md (default: 5). Recent failures are most likely to be relevant.

**Domain-scoped**: Only include entries tagged to the domain being worked on. Tag entries with module names when they are domain-specific.

**Full load**: For short knowledge files (< 50 entries), load entirely. The overhead of selective retrieval exceeds the cost of full load.

## Consolidation

Over time, knowledge files grow. Consolidate when entries conflict, are superseded, or become redundant.

Consolidation rules:
1. Never delete — mark as `[SUPERSEDED date]` with a pointer to the replacement
2. Merge duplicates — if two entries say the same thing, combine and note both origin dates
3. Elevate learnings to conventions — if a learning has prevented repeat mistakes for 30+ days, graduate it to project_memory.md as a permanent convention
4. Keep learnings.md as a pure append-only log — only consolidate project_memory.md

## Memory for Multi-Agent Coordination

**The telephone game problem**: When agents pass outputs to other agents, each hop degrades information. A Software Architect decision passed through Programmer → Code Inspection → Security loses nuance at each step.

Prevention: Do not pass full session histories between agents. The Coordinator always reconstructs context from canonical sources (spec hash, ADR file, project_memory entries) rather than forwarding previous agents' outputs verbatim.

**Agent-specific memory**: Some agents benefit from per-run memory of their own decisions. The Observer agent is the designated keeper of cross-cycle patterns — it reads all other agents' outputs and writes pattern reports that serve as memory of systemic issues.

## Production Framework Reference

If this project evolves to need programmatic memory management beyond flat files:

| Framework | Strength | Benchmark | Best For |
|---|---|---|---|
| **Zep / Graphiti** | Temporal knowledge graph | 94.8% DMR, 2.58s latency | Systems where "what was true when" matters |
| **Letta** | Filesystem-backed, agent-native | 74% LoCoMo | Agent-native memory with built-in management |
| **Mem0** | Semantic + keyword hybrid | 68.5% LoCoMo | Fast recall with minimal setup |
| **LangMem** | LangChain ecosystem | N/A | Teams already in LangChain |
| **Flat files** | Maximum simplicity, zero infra | N/A | This project's current approach — sufficient until scale demands more |

The flat-file approach (our three workspace memory files) outperforms specialized frameworks in simplicity, debuggability, and operational cost for small-to-medium projects. Migrate when: retrieval latency becomes a bottleneck, or the knowledge base exceeds 500+ entries and keyword search becomes unreliable.

## Common Failure Modes

**Every agent reads all memory**: Loading the entire project_memory.md into every agent dispatch balloons token cost and degrades attention. Coordinator must filter to relevant entries only.

**Memory as a junk drawer**: project_notes.md filling with resolved questions never marked resolved, stale conventions, implementation details. Governance: weekly review to mark resolved items and graduate stable conventions.

**No memory at session start**: Agent makes the same mistake that learnings.md documented six weeks ago because the Coordinator forgot to include the relevant learnings. Include the last 5 learnings.md entries by default in every dispatch.

**Encoding decisions as memory instead of ADRs**: "We chose PostgreSQL" belongs in an ADR with rationale, not in project_memory.md as a bare fact. Memory captures conventions; ADRs capture decisions with context.
