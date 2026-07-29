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

- `domain` is the conceptual folder: `engine`, `agent`, `server`, `platform`, `chat`, `ui`,
  `capability`, `integration`, or `tooling`.
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
browser-only `./dom` (see `packages/agentic/source-map.md`'s "The DOM split"). For that case, add
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
consumer-adoption pass — see each package's own `source-map.md` for the day-by-day history):

| Package | Native dep | Shape | What it means for a consumer |
|---|---|---|---|
| `@jini-ai/sqlite` | `better-sqlite3` | Hard `dependencies`, real value import (`createSqliteEventLog` opens the DB itself) | Always needs a working prebuild — this package's whole job is being the SQLite adapter. |
| `@jini-ai/server` (ex-`node-host`) | `better-sqlite3` | Transitive, via its `@jini-ai/sqlite` dependency | Same requirement as `@jini-ai/sqlite`, inherited. |
| `@jini-ai/registry` | `better-sqlite3` | `peerDependencies` (optional) — `database-backend.ts` only needs the *type*, the caller owns/opens the real handle | Only pay the native-compile cost if you actually install `better-sqlite3` yourself to use `DatabaseRegistryBackend`; `StaticRegistryBackend` and friends need nothing. |
| `@jini-ai/capability-providers` | `better-sqlite3` | `peerDependencies` (optional), and the code that needs it is behind the `./adapters/sqlite` subpath | Nothing on the root barrel references it, in code *or* in emitted `.d.ts`. Only pay the native-compile cost if you import `./adapters/sqlite` for `SqliteDbProvider`. |
| `@jini-ai/media` | `better-sqlite3` | Dynamically imported (`await import('better-sqlite3')`) inside `createSqliteMediaTaskStore` only | Importing anything else from `@jini-ai/media` (e.g. `renderStub`) never touches the native binary at all; the cost is paid only if you actually call that one factory. |
| `@jini-ai/daemon` | `node-pty` | `peerDependencies` (optional) + dynamically imported (`await import('node-pty')`) inside `loadRealSpawnPty` only | The rest of the package (agent execution, tool registry, etc.) boots fine with `node-pty` absent — only an actual terminal-session spawn fails, cleanly. Install `node-pty` yourself if you want terminals. **This also means every transitive consumer (`@jini-ai/http-kit`, `@jini-ai/server`) stops paying a native compile just to mount one JSON route.** |

Everything else in the workspace (`shiki` in `@jini-ai/renderers-react`, the various vendor SDKs in
`@jini-ai/media`'s dispatch providers) is pure JS — no native compile step, no Electron ABI
concern, regardless of how heavy the package is on disk.

### Optional peer dependencies — the convention

Beyond the native addons above, several packages declare a heavy but *pure-JS* dependency as an
optional peer rather than a hard `dependencies` entry. The rule: **if a dependency is only reachable
through a non-root `exports` subpath, it is an optional peer.** Installing the package for its root
barrel then costs nothing extra, and the subpath tells you exactly what to add if you want it.

| Package | Optional peer | Needed only for |
|---|---|---|
| `@jini-ai/capability-providers` | `ws` | `./adapters/ws` (`WebSocketRealtimeProvider`) |
| `@jini-ai/capability-providers` | `better-sqlite3` | `./adapters/sqlite` (`SqliteDbProvider`) |
| `@jini-ai/ui` | `@excalidraw/excalidraw` | `./sketch-editor` |
| `@jini-ai/ui` | `lexical`, `@lexical/react`, `@lexical/utils` | `./lexical-rich-text-editor` |
| `@jini-ai/registry` | `better-sqlite3` | `DatabaseRegistryBackend` |
| `@jini-ai/daemon` | `node-pty` | Terminal sessions (`loadRealSpawnPty`) |

`react` and `react-dom` are peers of every React package (`@jini-ai/ui`, `@jini-ai/chat-react`,
`@jini-ai/renderers-react`) — **not** optional, and never `dependencies`. A React library that
declares React as a normal dependency can get a second copy installed under itself, which breaks
hooks at runtime in ways that are hard to diagnose. The declared range is `^18.3.0 || ^19.0.0`.

### ESM only

Every published `@jini-ai/*` package is **ESM only**: `"type": "module"`, and the `exports` map
offers `types` / `import` / `default` conditions with **no `require` condition and no CommonJS
build**. A CommonJS consumer cannot `require()` these packages; it must use a dynamic
`await import()` or move to ESM. This is a deliberate, uniform constraint across the engine, not an
oversight in any one package.

### Package metadata quick reference

- `description` — every package carries a real one-line description. Keep it accurate when scope
  changes; it is the first thing an adopter reads on npm.
- `sideEffects` — `false` on every package except `@jini-ai/media`, which lists the exact files
  (`./dist/dispatch/engine.js`, `./dist/dispatch/providers/*.js`) whose module-eval vendor
  self-registration a bundler must not tree-shake away.
- `jini.admission` — **removed 2026-07-28.** The locked/incubating/admitted tier is gone and
  nothing validates the field; do not reintroduce it.
