# Jini workspace packages

Jini keeps publishable packages physically flat under `packages/*`. A package is an independent
install/version/export boundary; conceptual grouping belongs in metadata rather than nested
directories that package managers and monorepo tooling can misinterpret as a second workspace
layer.

Every package declares a canonical `jini` block in `package.json`:

```json
{
  "jini": {
    "domain": "chat",
    "kind": "react-adapter",
    "runtime": "browser"
  }
}
```

- `domain` is the conceptual folder: `engine`, `agent`, `server`, `platform`, `chat`, `admin`,
  `ui`, `capability`, `integration`, or `tooling`.
- `kind` describes the package's role inside that domain.
- `runtime` is `universal`, `node`, `browser`, or `desktop`.

`pnpm guard` validates this metadata. There is no `admission` tier and no import restriction
between packages based on one — the locked/incubating/admitted gate (and the "23 packages vs. the
locked 14" framing behind it) was removed 2026-07-28 at the user's explicit direction. `UNLOCKED.md`
is a historical record of that removed mechanism, not something `pnpm guard` enforces.

### `entries` — when one `runtime` can't describe every export subpath

`runtime` is a single value, but a package can ship more than one `exports` subpath (`.`,
`./internal`, `./dom`, …), and most of the time they all share the same runtime — nothing to
declare. The one case that doesn't fit is a package with a universal root and a browser-only (or
otherwise differently-targeted) secondary entry point, e.g. `@jini-ai/agentic`'s DOM-free `.` plus its
browser-only `./dom` (see the archived provenance ledger's "The DOM split"). For that case, add
an optional `jini.entries` map alongside `runtime`:

```json
{
  "jini": {
    "runtime": "universal",
    "entries": { ".": "universal", "./dom": "browser" }
  }
}
```

- `entries` is opt-in — omit it entirely and nothing changes; every package that doesn't need it
  keeps its single `runtime` field untouched.
- When present, `pnpm guard` validates it both ways: every key must name a real `exports` subpath,
  and every `exports` subpath must have a matching `entries` key — a stale or typo'd key is an
  error in either direction. `entries["."]`, if set, must agree with the top-level `runtime`.
- `runtime` stays authoritative for anything that only reads the single-value field (tooling that
  hasn't been taught about `entries` yet); `entries` is additive detail, not a replacement.

### Native compiled dependencies — what a consumer should expect

Two packages ship real native (compiled) addons: `better-sqlite3` and `node-pty`. Both need a
matching prebuild for the exact Node ABI they run under — inside an Electron/Tauri desktop shell,
that means an `electron-rebuild` (or equivalent) step whenever the shell's bundled Node/Electron
version changes, not just a plain `npm install`. This table is the map of where each one actually
shows up, and what shape that dependency takes (audited 2026-07-29 as part of a broader
consumer-adoption pass — see each package's own the archived provenance ledger for the day-by-day history):

| Package | Native dep | Shape | What it means for a consumer |
|---|---|---|---|
| `@jini-ai/sqlite` | None | Deprecated concern re-export shim; no driver hard dependency/autoload | Inject host handles/openers; use concern subpaths. |
| `@jini-ai/server` (ex-`node-host`) | Host-injected `better-sqlite3` | Optional peer, no driver value import | Memory needs no SQLite; durable host supplies its opener. |
| `@jini-ai/registry` | `better-sqlite3` | `peerDependencies` (optional) — `database-backend.ts` only needs the *type*, the caller owns/opens the real handle | Only pay the native-compile cost if you actually install `better-sqlite3` yourself to use `DatabaseRegistryBackend`; `StaticRegistryBackend` and friends need nothing. |
| `@jini-ai/capability-providers` | `better-sqlite3` | `peerDependencies` (optional), and the code that needs it is behind the `./adapters/sqlite` subpath | Nothing on the root barrel references it, in code *or* in emitted `.d.ts`. Only pay the native-compile cost if you import `./adapters/sqlite` for `SqliteDbProvider`. |
| `@jini-ai/integrations` (`./media-providers`) | `better-sqlite3` | Dynamically imported (`await import('better-sqlite3')`) inside `createSqliteMediaTaskStore` only | Importing anything else from `./media-providers` (e.g. `renderStub`) never touches the native binary at all; the cost is paid only if you actually call that one factory. |
| `@jini-ai/daemon` | `node-pty` | Optional peer; native adapter at `./terminal` | The default entry uses an injected PTY port. Only hosts opting into `loadRealSpawnPty` from `@jini-ai/daemon/terminal` install the native addon. |

Everything else in the workspace (`shiki` in `@jini-ai/ui`'s `./renderers` subpath, the various
vendor SDKs in `@jini-ai/integrations`'s `./media-providers` dispatch providers) is pure JS — no
native compile step, no Electron ABI concern, regardless of how heavy the package is on disk.

### Optional peer dependencies — the convention

Beyond the native addons above, several packages declare a heavy but *pure-JS* dependency as an
optional peer rather than a hard `dependencies` entry. A runtime optional peer belongs behind an
explicitly classified opt-in subpath that the default `.` entry cannot reach. Importing that subpath
opts into installing its peers; static imports there are allowed without changing synchronous APIs.
Default-entry runtime libraries require regular dependencies.

| Package | Optional peer | Needed only for |
|---|---|---|
| `@jini-ai/capability-providers` | `ws` | `./adapters/ws` (`WebSocketRealtimeProvider`) |
| `@jini-ai/capability-providers` | `better-sqlite3` | `./adapters/sqlite` (`SqliteDbProvider`) |
| `@jini-ai/ui` | `@excalidraw/excalidraw` | `./sketch-editor` |
| `@jini-ai/ui` | `lexical`, `@lexical/react`, `@lexical/utils` | `./lexical-rich-text-editor` |
| `@jini-ai/ui` | `@radix-ui/react-checkbox`, `@radix-ui/react-label`, `@radix-ui/react-radio-group`, `@radix-ui/react-select`, `@radix-ui/react-slot` | `./interactive-ui` (shadcn provider components) |
| `@jini-ai/ui` | `recharts` | `./interactive-ui` (chart provider components) |
| `@jini-ai/ui` | `@mcp-ui/client` | `./mcp-ui` (`McpUiHost`) |
| `@jini-ai/chat` | `@radix-ui/react-checkbox`, `@radix-ui/react-label`, `@radix-ui/react-radio-group`, `@radix-ui/react-select`, `@radix-ui/react-slot`, `recharts`, `@mcp-ui/client` | `./react*` surface cards (reachable through `./react`; `./react/chat-pane` and `./react/embed` do not import these cards) |
| `@jini-ai/registry` | `better-sqlite3` | `DatabaseRegistryBackend` |

Host frameworks are peers, never `dependencies`: a second React copy under a library breaks
hooks. Runtime reachability from each package's exports governs installation. `@jini-ai/ui` keeps
React and ReactDOM required because its default entry loads them; `@jini-ai/server` keeps Express
required for the same reason. Those default closures also load UI kit's React bindings and daemon's
HTTP routes, so UI kit's React/ReactDOM peers and daemon's Express peer stay required. Admin loads
React/ReactDOM exclusively through opt-in React subpaths, so its peers are optional and classified.
Type-only Express references in core and HTTP kit do not load Express; neither declares a runtime
Express peer. Unimplemented Vue bindings in UI kit and unused ReactDOM in vibecoding likewise
have no peer declaration. Other opt-in framework peers retain their manifest classifications.

Default-path production dependencies include `smol-toml` in daemon; `mammoth` and
`unpdf` in CMS; `@jini-ai/integrations` and `@jini-ai/platform` in agent-runtime;
and `@modelcontextprotocol/sdk`, `@jini-ai/platform` plus `@cfworker/json-schema` in MCP. Each
package's manifest lists its complete required set. These are installed automatically.

Every optional peer in a published package must declare its contract in the owning manifest:

```json
{
  "peerDependencies": { "@e2b/code-interpreter": "^2.0.0" },
  "peerDependenciesMeta": { "@e2b/code-interpreter": { "optional": true } },
  "jini": {
    "optionalPeers": {
      "@e2b/code-interpreter": "opt-in: import @jini-ai/sandbox/e2b — E2B sandboxes need @e2b/code-interpreter. Install it before importing this subpath."
    }
  }
}
```

The classification names the public import that opts in and explains its peer requirement.
Static imports inside that subpath may report the native module loader's error when the peer is
absent. Guarded deferred loaders retain their feature-specific messages and original causes.
Type-only peers have no runtime load to guard. A classification or deferred-module annotation
never exempts an optional load reachable from the default entry.

The existing subpath guard rejects unclassified optional peers and default-entry reachability
into their loads, including lazy CommonJS loads. Classification is required even when a package's
composition cannot be inferred. Neutral driver and adapter-layer boundaries remain
in force independently of installation requiredness.

Native addon installation costs are therefore explicit. Hosts must stage required libraries and
validate their actual packaged closure. Jini's `@jini-ai/devops/packaging/electron` owns that audit;
it checks literal imports, dynamic imports, require/createRequire calls and require.resolve using
Node's import/require conditions and rejects targets outside the stage. Its Node resolver needs
`node --experimental-import-meta-resolve` so each importer supplies its own parent URL.

### ESM only

Every published `@jini-ai/*` package is **ESM only**: `"type": "module"`, and the `exports` map
offers `types` / `import` / `default` conditions with **no `require` condition and no CommonJS
build**. A CommonJS consumer cannot `require()` these packages; it must use a dynamic
`await import()` or move to ESM. This is a deliberate, uniform constraint across the engine, not an
oversight in any one package.

### Package metadata quick reference

- `description` — every package carries a real one-line description. Keep it accurate when scope
  changes; it is the first thing an adopter reads on npm.
- `sideEffects` — JavaScript modules declare `false`; packages shipping styles retain CSS-only
  allowlists. `@jini-ai/integrations` registers its built-in vendors on first registry use,
  so importing its JavaScript no longer requires a vendor-registration allowlist.
- `jini.admission` — **removed 2026-07-28.** The locked/incubating/admitted tier is gone and
  nothing validates the field; do not reintroduce it.

| Storage concern | Entry | Connection ownership |
|---|---|---|
| Chat | `@jini-ai/chat/store/*` | Borrowed host kernels/handles |
| Daemon | `@jini-ai/daemon/store/*` | Borrowed session kernels; explicit owned event-log opener |
| Tool catalog | `@jini-ai/registry/tool-catalog/sqlite` | Borrowed host handle |
| Generic SQL | `@jini-ai/db/{core,sqlite,kernel/*}` | Injected host drivers |

## Subpath runtime and installation isolation

`pnpm guard` and `pnpm guard:drift` include `checkSubpathIsolation`. Every Jini
package's `exports` map participates automatically. The check resolves compiled
export targets back to source, expands wildcard exports, checks all runtime
conditions, and follows relative and `@jini-ai/*` imports with the shared import
extractor. Type-only imports do not form runtime edges. Use explicit `import type`
for a wholly type-only clause: with `verbatimModuleSyntax`, inline `type` specifiers
alone can otherwise leave an empty runtime import in emitted JavaScript.

A subpath may reach its domain and the package's shared core. Its runtime closure
must not reach a sibling domain. Installation requiredness follows the feature contract above,
never the fraction of subpaths using a dependency. Compatibility aggregate barrels do not exempt
independent subpaths from runtime domain isolation.

The optional `jini.isolation` map records source ownership when an export's first
segment alone does not express it:

```json
{
  "jini": {
    "isolation": {
      "entries": { "./domain-adapter": "domain", ".": "$aggregate" },
      "domains": { "domain": ["src/domain"] },
      "shared": ["src/shared-core-leaf.ts"],
      "forbidden": { "universal": ["node:", "express", "react"] }
    }
  }
}
```

`entries` overrides domain identity; nested exports otherwise keep their first
segment's domain. `domains` adds source roots without creating another public API.
`src/core` and `src/contracts` are shared by default; `shared` names existing
foundation leaves or compatibility bridges. These maps record actual ownership,
not waivers for unrelated features. `forbidden` can be keyed by a specific export
or its `jini.entries` runtime and constrains the full closure, including imports
inside Jini dependencies. CMS should register its runtime restrictions and any
adapter ownership here rather than add a second CMS import walker. Missing code
export targets and unresolved runtime Jini edges fail closed. CSS-only `sideEffects`
allowlists remain necessary for stylesheet retention; JavaScript initialization
effects are recorded by the audit for review.

`@jini-ai/commerce` is registered at composition layer L6: its opt-in tools compose CMS
authorization and its opt-in React entry composes UI translation. Its canonical metadata is
`domain: capability`, `kind: commerce`, with a universal root and explicit node/browser entries.
Subpath isolation still enforces each entry's source and installation boundaries.
