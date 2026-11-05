---
name: hexagonal-architecture
version: 1.0.0
last_updated: 2026-03-05
description: Use when structuring backend, service, worker, CLI, or mixed-stack code around ports and adapters so business logic stays isolated from frameworks and infrastructure and remains easy to test.
---

# Skill: Hexagonal Architecture

Use this skill when the system should be organized around a stable application core with explicit ports and replaceable adapters.

This is the generic, stack-agnostic ports-and-adapters skill.

- Use it for Python, Go, Java, backend TypeScript, CLIs, workers, batch jobs, and service code.
- Use it when the main goal is testable business logic with infrastructure isolated at the edges.
- Do not use this for frontend application architecture. This skill is for backend and service code.

## Best Fit

Choose hexagonal architecture when one or more of these are true:

- business logic must stay independent from web frameworks, ORMs, queues, or SDKs,
- the same core behavior may be driven by multiple entry points such as HTTP, CLI, jobs, or events,
- infrastructure providers may change over time,
- fast core tests with in-memory or fake adapters are important,
- testability and modularity matter more than minimizing file count.

## Placement Heuristic

Hexagonal architecture is often best used as an internal boundary discipline, not as a demand that every part of the product use the same folder taxonomy.

For many long-lived products, the best overall shape is:

- modular monolith at the macro level,
- vertical slices or strongly owned modules for delivery,
- hexagonal boundaries inside the slices that need framework-independent core logic.

Use the pattern where it pays for itself. Do not force ports-and-adapters into trivial CRUD or short-lived glue code.

## Avoid It When

Do not force hexagonal architecture onto work that is simpler than the pattern:

- thin CRUD with minimal domain logic,
- short-lived prototypes,
- single-file utilities,
- UI-only React component work,
- teams that do not need explicit boundary control yet.

## Core Model

Hexagonal architecture separates the system into:

- **Application core**: business rules and orchestration
- **Inbound ports**: what the application offers
- **Inbound adapters**: HTTP handlers, CLI commands, queue consumers, test drivers
- **Outbound ports**: what the application needs from the outside world
- **Outbound adapters**: database repositories, external API clients, email senders, file storage implementations

Dependency rule:

1. The core defines the ports.
2. Adapters implement or call those ports.
3. The core must not import framework or vendor implementations.
4. Wiring happens at the composition root, not inside business logic.

## Required Design Rules

1. Keep business rules inside the core, not in controllers, ORM models, SDK wrappers, or framework hooks.
2. Define outbound ports in application language, not vendor language.
3. Keep adapters thin: translate data, call infrastructure, map errors.
4. Inject dependencies explicitly through constructors or function parameters.
5. Use one composition root per process entry point to construct infrastructure and assemble concrete adapters.
6. Treat hidden globals, singleton lookups, and direct framework access in the core as boundary violations.
7. Keep all vendor-specific plugin code, skills, and MCP configuration inside the plugin package. If the host lacks a feature, add a generic capability any plugin can use, never vendor-shaped core code; move existing vendor code out of core in the same change. In a plugin host, plugins count as recorded consumers of the extension surface, so these capabilities serve existing couplings rather than imagined variation.

## Port Design Rules

Good port:
- expresses what the application needs,
- has stable inputs and outputs,
- is easy to fake in tests,
- does not expose vendor-specific shapes unless the vendor contract is itself the business contract.

Bad port:
- mirrors a specific SDK or ORM,
- leaks HTTP request/response objects into the core,
- returns framework models directly,
- forces tests to boot real infrastructure just to exercise business rules.

## Default Structure

For module `index.ts` public APIs, follow `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/modular-monolith.md` (TypeScript Implementation).

Use names that match the language and framework, but preserve this separation:

```text
src/
  domain/                 # entities, value objects, pure rules
  application/
    ports/
      inbound/
      outbound/
    services/             # use-cases / application services
  adapters/
    inbound/              # http, cli, queue, jobs
    outbound/             # db, cache, api, storage, email
  bootstrap/              # composition root / wiring
```

If the team prefers Clean Architecture naming, that is fine. Preserve the same dependency rule even if folders differ.

## Dependency Injection

Prefer explicit constructor or parameter injection.

- inject interfaces, functions, or small capability objects,
- wire concrete adapters in bootstrap code,
- keep dependency creation out of the core,
- prefer simple objects/functions before class-heavy DI containers unless the codebase already uses one.

## Testing Strategy

Hexagonal architecture is strong when the tests follow the boundaries:

- **Core tests**: drive the application through inbound ports with in-memory or fake outbound adapters
- **Adapter tests**: verify each adapter against the real framework, database, or vendor sandbox
- **Contract tests**: define one reusable suite per port and run it against every adapter, including the in-memory double
- **End-to-end tests**: keep limited to critical journeys

If most tests still require a real database, framework runtime, or network calls just to exercise business rules, the architecture is only hexagonal on paper.

## Anti-Patterns

Refactor immediately if any of these appear:

- business logic in controllers, serializers, repository implementations, or framework lifecycle methods,
- outbound ports named after vendor SDK calls,
- adapters returning raw vendor types into the core,
- the core importing ORM models, HTTP request objects, or framework decorators,
- dependency injection done via hidden globals or service locators,
- tests asserting internal adapter calls instead of observable behavior.

## Output Expectations

When this skill drives an architecture or implementation decision, the output should state:

- the inbound adapters,
- the outbound adapters,
- the inbound ports,
- the outbound ports,
- where the composition root lives,
- how core tests will run without real infrastructure.
