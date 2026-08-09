# core

This is all of `@jini-ai/agentic`'s framework-free half: capability vocabulary, page-driver
contracts, AG-UI/gen-ui/MCP-UI-apps projections, and A2UI (`./a2ui`). No React, no DOM globals in
the default build — `dom/` is the one exception, and it's compiled under a separate
`tsconfig.dom.json` specifically because it's allowed to touch `document`/`window` and the rest of
this folder is not.

## The rule

**`core/` must never import from `@jini-ai/ui`** (or any package that renders it — `@jini-ai/ui`'s
`interactive-ui`, `a2ui`, and `mcp-ui` feature folders included). The dependency runs one way:
those packages import `core`'s types (`Catalog`, `ComponentSpec`, capability defs) to know what's
allowed; `core` has no opinion on how — or whether — any of it gets rendered. `a2ui/catalog.ts`
says this explicitly: a component type not in the catalog "must be refused, not silently rendered
or executed," and *implemented* there means the protocol/validation layer only — "whether any
given host renderer draws it is a separate concern this package has no opinion on."

If `core` ever imports React, or imports from `@jini-ai/ui`, that claim stops being true, and
everything that depends on `agentic` staying usable in a Node-only host (an MCP server, an
agent-runtime with no browser) breaks silently.
