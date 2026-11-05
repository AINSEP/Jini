---
name: software-engineering
description: Plan, implement, debug and inspect software changes with explicit boundaries, reusable code, test-ready design and honest verification. Use for coding tasks, bug fixes, refactors, architecture choices and code inspection.
---

# Software engineering

## Start with the task

Use the current host's guidance reader to load this skill and only the references needed for the task. Discover available tools and follow the host's permissions. Shell commands and dependency setup apply only in an authorized coding checkout. Missing tools are limitations to report, never permission to invent capabilities or bypass restrictions. Follow supplied requirements and repository conventions; no framework or approval ceremony is required.

Identify the intended outcome, affected workspace and acceptance criteria. Inspect its manifests, lockfile, configuration and existing implementation before choosing stack guidance; a monorepo root's dependencies alone do not identify the affected stack. Search for an existing owner and extend it before adding code. Preserve user work and keep the diff limited to the requested outcome. List unrelated findings without fixing them.

## Route the work

- Feature or refactor: load [implementation](references/implementation.md).
- Architecture, unclear behavior or a meaningful boundary change: load [planning](references/planning.md), then implementation for the selected slice.
- Bug or unexpected behavior: load [debugging](references/debugging.md), then implementation for the fix.
- Tests, code inspection or completion: load [verification](references/verification.md). Also use it before claiming any task complete.

Load individual references as needed, not the whole catalog. UI work also needs the host's discovered design/accessibility guidance. Keep behavior, state and contracts here; let the discovered design capability own visual direction and browser checks. Do not import or copy another plugin's files. If the host provides a memory-discipline skill, discover and load that guidance through the host reader; its policy remains authoritative rather than being duplicated here. Its absence does not block portable engineering work.

## Keep changes understandable

Keep one owner for each rule. Inject clocks, randomness, configuration, storage and network clients at effect boundaries. Separate decisions from I/O; keep orchestration thin. Prefer stable named inputs and explicit return/error contracts, small cohesive units, and no mutation of inputs unless the contract justifies it. Public functions use required and optional argument objects where the repository follows that convention. Avoid a new abstraction until a concrete requirement needs it.

Make code test-ready even when feature tests are optional: decisions must have observable outcomes and replaceable effect dependencies. Preserve useful validation, recovery and supported behavior. Validate untrusted input at the boundary and enforce authorization at the resource being accessed. Do not hide failures behind broad catches or success-shaped fallbacks.

Errors must say what failed, give safe context and a useful next action, with a stable code or correlation id when available. Keep details copyable and redact credentials, private data and raw vendor responses. Never leave only a generic user-facing error.

Bound caller-controlled collections, payloads, retries and external calls; define cancellation, timeout and partial-failure behavior. Prefer bulk operations to per-item I/O. Estimate frequency × payload for each added read, write or poll; add no background work without a requirement. Document non-obvious cost and the reason for a constraint close to its owner.

Follow existing relevant checks. Features do not require new tests; bug fixes start with a failing regression test. Added tests require scoped mutation testing. Missing checkers mean UNVERIFIED, never PASS. See verification for thresholds and the narrow exhaustive-switch exception. Report the actual changed behavior, commands/results, assumptions and remaining limitations.
