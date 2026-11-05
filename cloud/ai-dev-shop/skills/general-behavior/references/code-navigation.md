# Code navigation (behavior pointer)

The code-navigation behavior is an independent skill. When an agent needs to
find, inspect, trace, or understand code — callers, callees, references, usage,
change impact, architecture, or "find the feature that does X" — load:

`<AI_DEV_SHOP_ROOT>/skills/code-navigation/SKILL.md`

It holds the per-query-class routing table (rg ↔ graph analyzers), the
`rg`-is-terminal-fallback rule, and the "graph output is a hypothesis until
validated" discipline. It delegates deep Graphify / Codebase Memory MCP mechanics
to `codebase-graph` (see `references/codebase-graph.md`).
