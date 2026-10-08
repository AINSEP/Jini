# @jini-ai/sandbox

## 0.4.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.0).

## 0.4.0 — 2026-10-02

### BREAKING

- Published sandbox helpers use required/optional argument objects and injected host policies; process migration documents are archived.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Fix E2B command adapter overload compatibility by declaring the implementation's port result union; runtime behavior and overload contracts are unchanged.
- **BREAKING:** Error constructors, E2B helpers, sandbox sessions/providers and worker event ports now take required and optional argument objects. E2B output callbacks receive `{ data }`; Node and SDK arguments are translated inside adapters. See `API.md` for migration.
- Declare the universal core and Node adapter runtimes, preserving core isolation from optional SDKs.

- Add a generic node-worker harness with caller-owned entries, payload/result codecs, schedulers and resource budgets.
