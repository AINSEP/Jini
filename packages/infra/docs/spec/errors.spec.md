Spec ID: SPEC-JINI-INFRA-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b1621eb22f1ae0302f1eedbcb4bed06984cead897b0037061f61d95f795aefd9
spec_mode: reverse_spec

# Error Contract: @jini-ai/infra

## Error ownership

The shim defines no error class, code registry, envelope, or HTTP mapping. It propagates failures from `@jini-ai/db`, consumer callbacks, and Node filesystem operations. No failure is retried automatically.

| Operation | Failure source | Caller action |
|---|---|---|
| `openSqliteConnection` | Recovery hook, opener, or any pragma throws | Repair driver/configuration; the caller owns any already-open connection and cleanup |
| `captureRestorePoint` | Watermark callback or backup rejects | Diagnose storage/backup failure; do not assume an artifact is complete |
| File restore | Artifact access, copy, or rename rejects; filesystem codes such as ENOENT/EACCES propagate | Verify artifact/path/permissions and reconcile temporary/live files before retry |
| Sidecar cleanup after restore | WAL/SHM removals reject inside `Promise.allSettled` | No exception or structured warning is returned; host checks residual sidecars |
| Pure naming helpers | No package validation/error type | Validate supplied fields before turning a generated filename into a filesystem path |

A failed connection setup has no automatic close. A failed copy/rename has no package-level temporary-file cleanup. A `:memory:` restore reports success without reading the requested artifact; consumers must not interpret that result as restored data.

Evidence: shim source and re-exported `@jini-ai/db` implementations; `src/__tests__/shim-surface.test.ts` read only.
