---
name: software-engineering
description: Plan, implement, debug, test and review web app changes with explicit boundaries, secure input handling and honest verification. Use for coding, bug fixes, refactors, architecture and exploratory prototypes.
---

# Software engineering

## Start with the task

Use the host's guidance reader to load only the references needed. Discover available tools and follow host permissions. Shell commands and dependency setup apply only in an authorized coding checkout. Missing capabilities are limitations to report, never permission to bypass restrictions. Follow requirements and repository conventions; no external framework or approval ceremony is required.

Identify the intended outcome, workspace and acceptance criteria. Inspect its manifests, lockfile, configuration, owner and callers before choosing stack guidance; root dependencies alone do not identify a monorepo's affected stack. Search for an existing owner and extend it. Preserve user work, keep the diff limited to the task and list unrelated findings without fixing them.

## Route the work

- Quick exploratory web app or prototype: [prototyping](references/prototyping.md).
- Feature or refactor: [implementation](references/implementation.md).
- Architecture, unclear behavior or a meaningful boundary change: [planning](references/planning.md), then implementation for the selected slice.
- Bug or unexpected behavior: [debugging](references/debugging.md), then implementation for the fix.
- Authentication, authorization, untrusted input, secrets or external integrations: [security](references/security.md).
- Tests, code review or completion: [verification](references/verification.md). Use it before claiming completion.

Load individual references as needed, not the catalog. For UI work, discover available design and accessibility guidance; let it own visual direction and browser checks. Do not import or copy another plugin's files. Discover host memory/resource guidance when needed; keep its policy there.

## Keep changes understandable

Keep one owner per rule. Inject clocks, randomness, configuration, storage and clients at effect boundaries. Separate decisions from I/O and keep orchestration thin. Use explicit named inputs and return/error contracts. Avoid mutating inputs and adding abstractions without a concrete requirement.

Make decisions observable and effects replaceable even when feature tests are optional. Preserve useful validation, recovery and supported behavior. Validate untrusted input before effects and authorize each protected resource. Do not hide failures behind broad catches or success-shaped fallbacks.

Errors name the failure, safe context and next action. Redact credentials, private data and raw vendor responses; keep safe details copyable. Bound collections, payloads, concurrency, retries and external call durations. Define cancellation and partial-failure behavior. Prefer bulk I/O and account for frequency × payload of added reads, writes and polls.

Follow existing checks. Bugs start with a failing regression; added executable tests require scoped mutation testing. Missing checkers mean UNVERIFIED, never PASS. See verification for measurements and the narrow exhaustive-switch exception. Report changed behavior, exact commands/results and limitations.
