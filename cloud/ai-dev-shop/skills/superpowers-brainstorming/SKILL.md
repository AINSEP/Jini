---
name: superpowers-brainstorming
description: Use when shaping a new feature, component, or behavior change before implementation. Guides short, structured design exploration and approval before code.
---

# Superpowers Brainstorming

Turn vague ideas into an approved design before implementation starts.

## Execution

- Read relevant files, docs, and recent changes first.
- If the request is too broad for one deliverable, decompose it before refining details.
- Ask one clarifying question at a time until goals, constraints, and success criteria are clear.
- Offer 2-3 approaches with trade-offs and a recommendation.
- Present the design in small sections and get confirmation.
- Write the approved design to a user-approved location.
- Hand off to planning/spec work unless the user explicitly wants prototype-only execution.

## Guardrails

- Do not write code before the design is shown and approved.
- If approval is missing, stop at design and do not advance to implementation.
- Prefer multiple-choice questions when they reduce ambiguity.
- Keep to one question per message.
- Stay inside the current scope; avoid unrelated refactors.
- Design around clear boundaries, simple units, and testable flows.
- Use the visual companion only when the decision is easier to understand visually.

## Output

- a short design summary in chat
- an approved design document in a user-approved location
- a clear handoff to planning/spec work or explicit confirmation that the user wants prototype-only execution

## Reference

- Preconditions:
  - the user is still shaping scope or behavior
  - implementation has not started yet
- Decision rule:
  - decompose first if the request spans multiple independent subsystems
  - stay in one design flow if the work can ship as one bounded deliverable
- Design checklist:
  - scope and goals
  - main components or files affected
  - data flow or interaction flow
  - edge cases and failure handling
  - testing approach
- Visual companion guide: [references/visual-companion.md](references/visual-companion.md)
- Review prompt: [references/spec-document-reviewer-prompt.md](references/spec-document-reviewer-prompt.md)
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
