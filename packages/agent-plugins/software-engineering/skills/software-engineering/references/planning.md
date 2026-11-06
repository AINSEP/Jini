# Planning and architecture

Identify the requested outcome, acceptance criteria, existing owner, callers and constraints. Choose the smallest reversible slice and record its files, observable contracts, failure modes and verification plan. Preserve the current architecture unless the requirement needs a boundary change.

## Default Architecture Heuristic

Use this as the default starting position before evaluating exceptions:

1. For most long-lived products, start with a **modular monolith** at the macro level.
2. Organize delivery around **vertical slices** or strongly owned modules rather than broad shared technical layers.
3. Apply **hexagonal boundaries** inside the slices or modules that have meaningful external I/O, provider-swappability needs, or business-critical logic that must stay framework-independent.
4. For Python services, workers, APIs, and other domain-heavy backend code, hexagonal architecture is a strong default boundary discipline.
5. For frontend applications, discover available frontend architecture and design guidance for the affected stack.
6. For trivial CRUD, scripts, and short-lived work, do not add ports-and-adapters unless the complexity justifies it.

This is a default, not a mandate. Override it only when the system drivers clearly justify a different macro shape.

## Principles That Always Apply

1. **Modular and reversible first.** Keep every part fixable, replaceable, and updatable as requirements change. This outranks elegance and performance; hard requirements remain binding. Treat reversal cost as a first-class criterion. Put one narrow seam at each coupling that already exists: "if this changes, how many places do I edit?" The answer must be one. Prefer additive changes beside published surfaces, then retire the old path; prefer movable configuration data over hardcoded policy where it keeps change local. Reuse proven migration mechanisms and settle shared surface shapes before concurrent work begins. Do not invent speculative extension points: replaceable does not require pluggable.
2. **Dependencies point inward.** Core business logic must not depend on databases, frameworks, or external services.
3. **Depend on interfaces, not implementations.** Every external dependency should be behind an interface so it can be swapped, mocked in tests, or replaced without touching core code.
4. **Start simple, extract when needed.** Modular monolith before microservices. CRUD before CQRS. Add complexity only when the problem actually demands it.
5. **Match pattern to problem.** Event sourcing for audit trails. CQRS for asymmetric read/write. Vertical slices for large feature teams. One pattern is not universally better.
6. **Enforce boundaries.** Module A must not import internals from Module B. Enforce this with linting, import rules, or package structure — not by trusting developers to remember.

Keep URL, client and server state ownership distinct. Define cleanup, stale response handling and cache invalidation where affected. Use established migrations; plan bounded backfills, lock impact and compatibility. Record frequency × payload and fan-out for added I/O. Resolve ambiguity that changes correctness or irreversible effects; continue independent authorized work.
