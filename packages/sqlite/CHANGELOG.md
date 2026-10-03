## Unreleased

### BREAKING

- Remove 18 server-owned root names (backend configuration/types, legacy acquisition/bootstrap and project CRUD/status helpers). Import their server concern subpaths directly; sqlite no longer depends on server.
- Keep the immutable old surface snapshot as migration evidence; current runtime/declaration assertions explicitly check the remaining surface.


## 0.5.0 — 2026-10-02

### BREAKING

- Deprecated database compatibility facade retains its runtime exports for one release while publishing only release/runtime artifacts.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

- Align packed runtime and declaration fixtures with the injected object arguments of the relocated stores.

# Changelog

## 0.4.0 — final compatibility release
- Re-exported all 65 old public names, including erased types, from concern-owned packages.
- Removed driver autoload. Resource-opening signatures now require a borrowed connection or host opener.
- Replaced the obsolete j04 renamed-package manifest assertion with the final old-name shim contract.
