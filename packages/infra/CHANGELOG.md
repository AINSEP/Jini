# Changelog

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
