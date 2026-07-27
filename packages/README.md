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
    "runtime": "browser",
    "admission": "locked"
  }
}
```

- `domain` is the conceptual folder: `engine`, `agent`, `server`, `platform`, `chat`, `ui`,
  `capability`, `integration`, or `tooling`.
- `kind` describes the package's role inside that domain.
- `runtime` is `universal`, `node`, `browser`, or `desktop`.
- `admission` is architectural governance, not an API-stability claim:
  - `locked` — part of the architecture's locked package set.
  - `incubating` — tracked in `UNLOCKED.md` and cannot be imported by locked/admitted packages.
  - `admitted` — promoted from `UNLOCKED.md` after its recorded promotion requirements are met.

`pnpm guard` validates the metadata, reconciles it with `UNLOCKED.md`, and rejects downward
dependencies into incubating packages. Product/example composition roots may consume incubating
packages while their boundaries are being proven.

### `entries` — when one `runtime` can't describe every export subpath

`runtime` is a single value, but a package can ship more than one `exports` subpath (`.`,
`./internal`, `./dom`, …), and most of the time they all share the same runtime — nothing to
declare. The one case that doesn't fit is a package with a universal root and a browser-only (or
otherwise differently-targeted) secondary entry point, e.g. `@jini/agentic`'s DOM-free `.` plus its
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
