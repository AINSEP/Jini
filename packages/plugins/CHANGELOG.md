# @jini-ai/plugins

## 0.4.0 — 2026-10-02

### BREAKING

- Private glue package retains behavior and public barrels while process/source-grep artifacts are archived or consolidated.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Publish the plugin host runtime at universal `./host` and Node `./host/node`, `./host/worker`,
  `./host/sql`; keep `./glue` unchanged. Require host SDK/catalog, declaration, tier, executable
  import/digest, archive and storage-table ports; preserve package layout, diagnostics and states.
- Remove private-package status and configure public npm publishing without a version bump.
  Host dependencies are optional peers under the 2026-10-07 install-isolation decision.
  Copied behavior tests and entry-purity coverage await coordinator verification.


### Integration of extracted APIs

- Complete the universal `./glue` surface: manifest validation, capability gates, dispatch resolution, content lifecycle/event attachment and isolated tool registration. Host vocabulary, wired sites, dispatcher and delegates remain required inputs; no new runtime dependencies.
- **BREAKING:** Empty glue attachment options use `Record<string, never>`, rejecting scalar options. Public functions, constructors and host delegates use required/optional argument objects; existing names are retained. See `API.md` for examples. Verification remains pending.

- Add host-independent glue validation, capability gates, dispatch and attachment delegates at `./glue`, with required vocabulary and host ports. The host runtime is now publishable; verification remains pending (owner directive).
