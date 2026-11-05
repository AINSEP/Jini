# TypeScript / JavaScript / TSX / JSX

Use this reference for `.ts`, `.tsx`, `.js`, and `.jsx` edits, especially when React component trees, import graphs, or TypeScript symbol propagation are involved.

## Prerequisites

Install at least one supported TS or JS structured-edit tool if you want full syntax-aware automation for this language.

Recommended first install:

- `ts-morph`

Optional alternatives:

- `jscodeshift`
- `recast`
- a concrete Tree-sitter-based wrapper or script that the repo or local environment already exposes by name

Example installs for downstream repos:

```bash
npm install -D ts-morph
```

```bash
npm install -D jscodeshift recast
```

What happens if none of these are installed:

- the agent may still load this reference
- the agent must state that parser-backed TS or JS editing is unavailable
- the agent must fall back to narrow manual edits instead of pretending semantic rename or codemod support exists
- the agent must not invent generic Tree-sitter commands or assume a parser wrapper exists

## Preferred Tool Order

1. **Type-aware rename or move tools**: TypeScript language service, `tsserver`, IDE rename, or `ts-morph`
2. **AST codemod tools**: `jscodeshift`, `recast`, Babel parser and transform stack
3. **Tree-sitter or equivalent structural parser wrapper**: use only when an exact local command or script is known, and only for node targeting, structural search, and safe location of edits when type-aware tooling is unavailable

If none of these are available, downgrade to narrow manual edits. Do not simulate a repo-wide rename with plain search and replace.

## Repo Signals

Load this reference when one or more of the following are true:

- The touched files end in `.ts`, `.tsx`, `.js`, or `.jsx`
- The repo contains `package.json`
- The repo contains `tsconfig.json` or `jsconfig.json`
- The change touches React components, module exports, or TypeScript declarations

## Safe Operations

- Rename exported functions, classes, interfaces, types, enums, and update imports and usages
- Add, remove, merge, or reorder imports and exports
- Change a function or component signature and propagate direct call sites
- Rename or add JSX and TSX props and update call sites
- Move declarations between modules and repair the import or export graph
- Update object shape or type names when consumers are statically visible

## Higher-Risk Zones Requiring Manual Review

- Dynamic imports or `require()` with computed paths
- Bracket notation or string-based property access
- Reflection, serialization keys, and event names stored as strings
- Barrel files with wildcard re-exports
- Generated clients, generated types, snapshots, or vendored code
- Cross-language boundaries such as GraphQL schema files, SQL strings, CSS class name contracts, and environment-variable names

## Minimum Structural Checks

- Touched files still parse
- Imports and exports remain structurally valid
- If TypeScript is in use, run targeted `tsc --noEmit` or the nearest equivalent
- If lint exists and it reports parse, type, or runtime-significant errors, treat those as blocking
- Treat style-only lint findings as advisory
- Rerun targeted tests for renamed public surfaces, moved modules, or changed component signatures

## Tree-Sitter Notes

Tree-sitter is useful because it parses code into a syntax tree quickly and incrementally. That makes it good for locating import clauses, function nodes, JSX attributes, and export lists without relying on brittle text matching.

Tree-sitter is not a substitute for type-aware rename when symbol identity matters. If two symbols share the same name in different scopes, prefer a type-aware tool. Use Tree-sitter mainly for structural targeting and batch edits when semantic ambiguity is low.

Do not assume the generic `tree-sitter` CLI by itself is a safe editing tool. If the repo does not document a concrete Tree-sitter-backed wrapper, script, or integration for edits, treat Tree-sitter as unavailable and fall back accordingly.

## Practical Rule

For TS or JS code, use the strongest available tool in this order:

1. Type-aware semantic rename or move
2. AST transform
3. Tree-sitter-guided structural edit
4. Narrow manual patch with explicit review of risk zones
