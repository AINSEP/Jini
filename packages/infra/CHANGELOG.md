# Changelog

## 0.5.3 — 2026-10-14

- The `@jini-ai/db` optional peer is published as `^0.3.4` instead of a `workspace:` range (3fcc85e2).
- `./db/core` now resolves to `dist/db/driver`, which binds the `@jini-ai/db/core` helpers by identity and re-exports the same names and types; the neutral `src/db/core` declares only `RestorePointNamingPort` (64eafe35). No change for importers.

## 0.5.2 — 2026-10-13

- `@jini-ai/db` is now an optional peer: only `./db/core` and `./db/sqlite` re-export it; `./events/outbox` needs `@jini-ai/core` only. Hosts using the db entries list `@jini-ai/db` themselves.

## 0.5.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.5.0).

## 0.5.0 — 2026-10-02

### BREAKING

- Legacy compatibility ports converge into core; the deprecated facade stays publishable for one release.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Adopt shared kernel contracts and preserve the module rationale in neutral documentation.
- BREAKING: replace package-local clock contracts with core Clock.nowMs().


- Add an events barrel for generic leased outbox delivery, bounded draining and enqueue-only
  views, with host-owned storage. The `./events/outbox` manifest merge is pending.
- Add integration contracts for the deprecated database shim and event subpath, and retain
  the outbox's reliability rationale separately from storage implementation details.
