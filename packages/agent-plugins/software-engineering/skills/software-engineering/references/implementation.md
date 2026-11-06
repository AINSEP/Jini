# Implementation

Read the existing owner and callers first. Reuse the owner, standard library, native platform or installed dependency before adding code. Copying a sibling lifecycle is not reuse. Preserve useful why comments and user work. Keep unrelated fixes out of the diff.

## Core Rules

1. Keep dependencies explicit. Do not hide clocks, random sources, repositories, config, or clients behind globals or inline construction in logic-bearing code. Avoid module-level singletons and append-only registries; inject registry instances with unregister and reset lifecycles.
2. Separate decision logic from effect execution where practical. Pure or mostly-pure decision steps should be obvious; effectful wrappers should be thin and explicit.
3. Prefer not mutating inputs or shared state by default. If mutation is required, the contract or performance reason must be obvious near the code.
4. Keep exported contracts explicit and stable. Favor named fields and predictable shapes at module boundaries.
5. Fail fast on invalid input or impossible state unless the spec explicitly requires graceful degradation or recovery. Expose failures as a typed outcome or typed error; never silently swallow them. If a check guarding an irreversible action errors or cannot decide, deny the action.
6. Keep units small and readable enough that the next agent can reason about them without reading surrounding subsystems or git history.

## Scaling and maintainability

1. Do an author-time scaling sanity check for any changed path that iterates caller-controlled input, nests loops, batches work, or risks per-item I/O.
2. Add a short inline complexity note only when the cost, query shape, or tradeoff is non-obvious and materially relevant to future maintainers.
3. For data-heavy code, make query or network fan-out explicit. Prefer bounded bulk reads/writes over hidden per-item I/O.
3b. For any function that calls an external service for a user-variable collection (roles, items, permissions, records), enforce resource bounds: maximum collection size (configurable cap), timeout on service calls, and defined behavior at the cap (error, truncate, or paginate). Do not assume typical usage equals worst-case usage.
4. Keep one source of truth for business rules, mapping tables, config lookups, and shared lifecycles or security-sensitive sequences (for example permission check → secret exchange → sealed store → outcome report); do not duplicate them across modules.
5. Avoid boolean flag parameters when an enum, options object, or named variant would make the call site clearer.
6. Prefer descriptive names and flow over clever compactness on non-trivial paths.
7. If performance or framework constraints force a non-obvious tradeoff, leave the reason near the code.

Use required and optional argument objects at public boundaries where the repository follows that convention. Return typed outcomes and document public inputs, outputs, errors and effects. Isolate opaque SDK errors in adapters. A user-facing error names the failure, safe context and next action; redact secrets and keep diagnostic details copyable.

Use registered migrations for persisted changes. Preserve compatibility and define cancellation, idempotency and partial-failure behavior before retrying writes. Account for frequency × payload on added reads, writes and polls. Use [security](security.md) when crossing a trust boundary and [verification](verification.md) before completion.
