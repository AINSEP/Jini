<!-- Source: Addy Osmani / agent-skills / api-and-interface-design -->

# Branded Types

Branded types make structurally identical values distinct at compile time.

```ts
type TaskId = string & { readonly __brand: 'TaskId' };
type UserId = string & { readonly __brand: 'UserId' };
```

Both are strings at runtime, but TypeScript will prevent passing a `UserId` where a `TaskId` is expected.

```ts
function loadTask(taskId: TaskId) {
  // ...
}

declare const userId: UserId;

loadTask(userId); // Type error: UserId is not assignable to TaskId
```

## Creating Branded Types

Create a reusable helper:

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type TaskId = Brand<string, 'TaskId'>;
type UserId = Brand<string, 'UserId'>;
```

## Type-Safe Constructors

Use constructors at trust boundaries so branding is not scattered across the codebase.

```ts
function createTaskId(value: string): TaskId {
  if (!value.startsWith('task_')) {
    throw new Error('Invalid TaskId');
  }
  return value as TaskId;
}
```

For data already validated by a schema, keep the assertion close to the validation step.

```ts
const taskId = createTaskId(input.taskId);
loadTask(taskId);
```

## When To Use Branded IDs

Use branded types for any ID that crosses a module or service boundary:

- Database IDs
- API resource IDs
- Event payload IDs
- Route parameters
- IDs shared across packages
- IDs for different entities with the same primitive representation

## Input/Output Type Separation

Input and output types should be explicitly separate, even when they look similar.

```ts
type CreateTaskInput = {
  title: string;
  assigneeId?: UserId;
};

type TaskOutput = {
  id: TaskId;
  title: string;
  assigneeId: UserId | null;
  createdAt: string;
  updatedAt: string;
};
```

Input types describe what callers are allowed to provide. Output types describe what the system guarantees after processing. Keeping them separate prevents accidental coupling between public request shape, persistence shape, and response shape.
