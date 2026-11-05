# Implementation and self-inspection

Read the affected owner and a nearby example first. Extend its existing contract with the smallest change. Keep unrelated cleanup out of the diff. Do not introduce duplicate rules, a new framework or a generalized helper for a single use.

## Boundaries and contracts

- Keep dependencies explicit and decisions separate from effects. Pass clocks, randomness, configuration and clients through existing seams. Do not require a dependency-injection container.
- Use stable named fields and typed outcomes at public boundaries. Keep public documentation accurate about inputs, outputs, errors and effects. Preserve useful why comments when moving code.
- Validate input before effects; authorize each protected resource. Keep secrets out of client bundles, logs, fixtures and committed files. Parameterize queries and encode content for the destination sink.
- Isolate opaque SDK errors in an adapter; map them to a safe typed contract. Preserve cause internally without exposing private data. A user-facing error needs a specific failure, safe context and next action; offer copyable safe diagnostic details.
- Keep mutation local and justified. Handle discriminated unions exhaustively, using a typed total handler table only when it preserves payload typing and clarity. Do not split dispatch solely to game complexity.

## Resource and change safety

Bound input collections, payload bytes, concurrency, retries and call timeouts. Respect cancellation. Define partial-failure and idempotency behavior before retrying a write. Prefer bounded batch queries over one call per item. Document non-obvious time/space costs and query fan-out; use frequency × payload to account for added reads/writes/polls.

Use the established migration system for persisted changes. Preserve compatibility during rollout and do not overwrite user work. Use the project's lockfile and reproducible install commands. Review new dependencies for necessity, install scripts, license and exposure; never run an installer in a host that forbids it.

## Inspect the resulting diff

Trace the requested outcome through its real consumer, including error and permission paths. Check ownership, dependency direction, supported behavior, resource bounds and stale data/races. Look for accidental API changes, swallowed failures, misleading names and duplicated rules. Confirm comments still explain the implemented constraint. Tests cannot establish all of these properties.

Run the relevant checks described in [verification](verification.md). Fix introduced failures without weakening checks. Separate blocking correctness/security findings from optional improvements; list unrelated legacy debt rather than broadening the task. Report any unresolved risk and its smallest next step.
