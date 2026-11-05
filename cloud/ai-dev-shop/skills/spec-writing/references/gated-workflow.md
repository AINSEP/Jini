<!-- Source: Addy Osmani / agent-skills / spec-driven-development -->

# Gated Spec Workflow

```text
SPECIFY ▸ PLAN ▸ TASKS ▸ IMPLEMENT
   |       |       |
   |       |       +-- human review gate
   |       +---------- human review gate
   +------------------ human review gate
```

Each `▸` is a review gate. Do not move to the next stage until the current artifact is clear enough to guide the next one.

## Gate Checks

| Gate | Checks before proceeding |
|---|---|
| SPECIFY to PLAN | The problem, user value, boundaries, constraints, and acceptance criteria are clear |
| PLAN to TASKS | The technical approach, architecture, dependencies, risks, and validation strategy are agreed |
| TASKS to IMPLEMENT | Work is broken into actionable tasks with clear ordering and test expectations |

## Spec Completeness Check

A spec is ready to hand off when it can answer these six questions:

- **Requirements** — what must the system do, stated as observable behavior
- **Acceptance Criteria** — how will we verify each requirement is met
- **Invariants** — what must always remain true regardless of inputs
- **Edge Cases** — which boundary conditions and failure modes are in scope
- **Scope Boundary** — what is explicitly out of scope and why
- **Open Questions** — what is unresolved, who owns it, and by when

A spec does not need to be long, but it must answer the questions an implementer would otherwise guess. (For AI agent session setup completeness — Tech Stack/Commands/Conventions/Agent Boundaries — see `context-engineering/references/session-setup-patterns.md`.)

## Living Document Principle

The spec is a living document. Update it when decisions change, commit it with the work, and reference it in pull requests. If implementation diverges from the spec, either change the implementation or update the spec deliberately.
