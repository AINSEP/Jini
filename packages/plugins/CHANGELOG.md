# @jini-ai/plugins

## 0.4.0 — 2026-10-02

### BREAKING

- Private glue package retains behavior and public barrels while process/source-grep artifacts are archived or consolidated.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Integration of extracted APIs

- Complete the universal `./glue` surface: manifest validation, capability gates, dispatch resolution, content lifecycle/event attachment and isolated tool registration. Host vocabulary, wired sites, dispatcher and delegates remain required inputs; no new runtime dependencies.
- **BREAKING:** Empty glue attachment options use `Record<string, never>`, rejecting scalar options. Public functions, constructors and host delegates use required/optional argument objects; existing names are retained. See `API.md` for examples. Verification remains pending.

- Add host-independent glue validation, capability gates, dispatch and attachment delegates at `./glue`, with required vocabulary and host ports. Package remains private; verification not run (owner directive).
