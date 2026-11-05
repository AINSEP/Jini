<!-- Source: Addy Osmani / agent-skills / context-engineering -->

# Session Setup Patterns

## Pattern 1: Rules File

Use a persistent rules file when the project has stable conventions the agent should load at session start.

Equivalent files across tools:

| Tool | File |
|---|---|
| Claude | `CLAUDE.md` |
| Cursor | `.cursorrules` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Multi-agent / generic CLI | `AGENTS.md` |

Example structure:

```markdown
# Project Rules

## Tech Stack

- Runtime:
- Framework:
- Database:
- Test framework:
- Package manager:

## Commands

- Install:
- Develop:
- Test:
- Lint:
- Build:

## Conventions

- File naming:
- Component patterns:
- Error handling:
- Logging:
- Accessibility:

## Agent Boundaries

- Allowed edits:
- Files to avoid:
- Required checks before any change:
- When to ask before proceeding:

## Patterns

- Preferred API pattern:
- State management:
- Testing style:
- Deployment flow:
```

## Pattern 2: Brain Dump

Use a brain dump when no structured project file exists. Put the most important context at the beginning of the session in freeform language.

Include:

- What you are trying to accomplish.
- What has already been tried.
- Relevant files, commands, and errors.
- Constraints, deadlines, and non-goals.
- Decisions that should not be reopened.

A good brain dump reduces silent guessing. It does not need perfect formatting.

## Pattern 3: Selective Include

Use selective include when the project map is large. Load only the relevant section instead of flooding the session with unrelated context.

Examples:

- Include only the backend API conventions for an endpoint task.
- Include only the design-system component rules for a UI task.
- Include only migration notes for a database change.
- Include only release rules for a deployment task.

Selective include keeps context focused and reduces the chance that stale or irrelevant instructions override the current goal.

## MCP Integration Table

| MCP server | Context provided |
|---|---|
| Context7 | Library documentation and API references |
| Chrome DevTools | Browser state, DOM inspection, console output, network behavior |
| PostgreSQL | Database schema, query behavior, table relationships |
| Filesystem | File access, project structure, local artifacts |
| GitHub | Pull requests, issues, reviews, repository metadata |

## Silent Confusion Anti-Pattern

Silent confusion happens when the agent is unsure but keeps working as if the tradeoff is obvious.

Use this response pattern instead:

1. Name the confusion.
2. Present the tradeoff.
3. Wait for the decision.

Example:

```markdown
I am unsure whether this should optimize for backward compatibility or a cleaner breaking change.

Backward compatibility keeps existing users safe but adds migration code.
The breaking change simplifies the API but requires coordinated updates.

Which direction should I take?
```

Do not bury uncertainty inside implementation. Surface it while the decision is still cheap.
