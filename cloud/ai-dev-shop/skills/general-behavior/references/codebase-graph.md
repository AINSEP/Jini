# Codebase graph backends (behavior pointer)

Deep mechanics for the local graph backends live in the independent skill:

`<AI_DEV_SHOP_ROOT>/skills/codebase-graph/SKILL.md`

It owns capability checks, freshness metadata, query-first commands, and the
default safety policy (no silent clone / install / MCP config / hooks / watch
modes without human approval) for both the **blessed** backends (Graphify,
Codebase Memory MCP — validator-gated) and the **candidate** backends (codegraph,
serena, understand-anything — clone/audit-only, no validator). Normally reached
via `code-navigation` routing rather than directly — `code-navigation` decides
*whether* a graph backend is the right tool; this skill is *how* to drive each
one.
