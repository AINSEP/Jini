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
