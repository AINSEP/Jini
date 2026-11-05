# Vertical Slice Architecture

## What It Is

Organize code by feature (vertical slice) rather than by technical layer (horizontal layer). Each slice is self-contained: its own command/query model, validator, handler, and data access — all in one folder. Adding a feature = adding a folder. Deleting a feature = deleting a folder. No layer-crossing required.

The key inversion: in layered architecture, you ask "which layer does this belong in?" In vertical slice, you ask "which feature does this belong to?"

## When to Use

- Multiple product teams each owning distinct features with independent delivery cadence
- Feature isolation is more important than global architectural uniformity (CRUD varies per feature)
- System is CQRS-oriented — commands and queries map 1:1 to slices naturally
- Codebase where "add a feature" vs "find where a feature lives" is consistently painful with layered structure
- Scaling development velocity by allowing teams to work in parallel without merge conflicts across shared service/repository layers

## When NOT to Use

- Solo developer or team of 2-3 — the slice overhead (repeated handler boilerplate) isn't worth it; use layered or clean architecture
- Simple CRUD app where every feature is the same shape — a generic CRUD handler is more efficient than per-feature slices
- Domain with complex shared business rules that span features — cross-slice duplication of these rules becomes a maintenance problem; put shared rules in a domain layer, not in every slice
- Team needs strict, uniform architectural patterns — vertical slice trades uniformity for isolation; if consistency matters more, layered/clean architecture enforces it better

## Decision Signals

| Signal | Vertical Slice | Layered |
|--------|---------------|---------|
| Team size | Multiple feature teams | Single team |
| Feature independence | High — features don't share much | Low — features share domain logic |
| Cross-cutting concerns | Minimal shared rules | Many shared business rules |
| CQRS orientation | Yes — command/query maps naturally | Not required |
| Preferred structure | "Where is CreateTask?" → one folder | "Where is validation?" → one layer |

## TypeScript Implementation

```typescript
// features/tasks/create-task/
// ├── create-task.handler.ts   — entry point
// ├── create-task.types.ts     — request/response types
// └── create-task.test.ts      — slice-level test

// create-task.types.ts
export interface CreateTaskRequest {
  title: string
  assigneeId: string
  priority: 'low' | 'medium' | 'high'
}
export interface CreateTaskResult {
  taskId: string
  createdAt: string
}

// create-task.handler.ts — the entire feature in one place
import { db } from '../../../infrastructure/db'
import type { CreateTaskRequest, CreateTaskResult } from './create-task.types'

export async function createTask(
  { title, assigneeId, priority }: CreateTaskRequest,
  { userId }: { userId: string }
): Promise<CreateTaskResult> {
  // Validation inline — no shared validator to coordinate with
  if (!title || title.trim().length === 0) throw new ValidationError('title is required')
  if (title.length > 255) throw new ValidationError('title must be ≤ 255 characters')
  if (!assigneeId) throw new ValidationError('assigneeId is required')

  const taskId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await db.query(
    `INSERT INTO tasks (id, title, assignee_id, priority, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
    [taskId, title.trim(), assigneeId, priority, userId, createdAt]
  )

  return { taskId, createdAt }
}

// Shared business rules that appear in 3+ slices → extract to a domain module
// features/tasks/domain/task-rules.ts
export function validateTaskTitle(title: string): void {
  if (!title || title.trim().length === 0) throw new ValidationError('title is required')
  if (title.length > 255) throw new ValidationError('title must be ≤ 255 characters')
}
// Rule of three: extract only when the third slice needs it. Not before.

// HTTP wiring — stays outside the slice
// routes/tasks.ts
router.post('/tasks', authenticate, async (req, res) => {
  const result = await createTask(req.body, { userId: req.user.id })
  res.status(201).json(result)
})
```

## Testing Strategy

- **Slice-level tests**: test the handler end-to-end — request in, result out. Use a real or in-memory DB. This is the primary test for each slice.
- **Targeted integration tests for shared infrastructure**: test DB setup, auth middleware, and error handling once globally — not in every slice test.
- **Do not test slices through global integration tests alone**: if a slice test requires a full app spin-up, the slice has too many dependencies.

## Common Failure Modes

**Business rule duplication becoming inconsistent**: `validateTitle` exists in `create-task`, `update-task`, and `duplicate-task` with slight variations. Fix: apply the rule of three — extract shared rules to a `domain/` module when the third slice needs them, not before. Shared lifecycles, security-sensitive sequences, and behaviors with a named owner follow Before You Write in `<AI_DEV_SHOP_ROOT>/skills/implementation-guardrails/SKILL.md` instead.

**Accidental coupling between slices**: Slice A imports a type or function from Slice B's folder. This couples their deployment and makes deletion unsafe. Fix: slices share only from a `shared/` or `domain/` folder, never from each other's feature folders.

**Fat slices**: A slice grows to 500+ lines because every concern is inlined. Fix: the slice is the entry point and orchestrator — extract heavy logic (complex validation, calculation, domain rules) into testable domain functions that the handler calls.

**Missing cross-cutting observability**: Each slice re-implements logging and error handling slightly differently. Fix: inject logging/tracing as infrastructure through the handler signature or middleware, not as slice-internal concerns.

## Pairs Well With

- **CQRS** — slices map naturally: one slice per command, one per query; the handler IS the command/query handler
- **Modular Monolith** — organize slices inside modules; module = bounded context, slice = feature within that context
- **Hexagonal Architecture** — apply ports/adapters within each slice for testability; the slice boundary IS the application boundary
- **Reliability Patterns** — add an Outbox per-slice for reliable event publishing when slice operations have async side effects
