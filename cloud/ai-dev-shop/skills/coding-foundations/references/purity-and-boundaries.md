# Purity And Boundaries

## Default

Separate decision logic from effect execution.

- Decision logic should usually be deterministic, assertion-friendly, and free of hidden dependencies.
- Effectful code should usually be thin: fetch, persist, emit, log, or transact around a clearer decision step.

## Good Shapes

### Pure Decision + Thin Effect Wrapper

```ts
export const resolveAccountStatus = ({
  isSuspended,
  hasOutstandingBalance,
}: {
  isSuspended: boolean;
  hasOutstandingBalance: boolean;
}): 'suspended' | 'delinquent' | 'active' => {
  if (isSuspended) return 'suspended';
  if (hasOutstandingBalance) return 'delinquent';
  return 'active';
};
```

```ts
export const updateAccountStatus = async (
  { accountId, accountRepo }: { accountId: string; accountRepo: AccountRepo },
): Promise<void> => {
  const account = await accountRepo.getById({ accountId });
  const status = resolveAccountStatus({
    isSuspended: account.isSuspended,
    hasOutstandingBalance: account.balanceCents > 0,
  });
  await accountRepo.saveStatus({ accountId, status });
};
```

## Acceptable Impurity

Impurity is fine when it is the point of the function:

- HTTP handlers
- repositories and adapters
- transaction boundaries
- logging and metrics emission
- cache population and invalidation
- event publication and queue writes

The rule is not "everything pure." The rule is "keep effects obvious and contained."

## Mutation Guidance

- Prefer not mutating inputs.
- Prefer returning a new value when the function is mainly business logic or transformation.
- Accept controlled mutation when it is materially simpler or measurably cheaper on a hot path.
- If you mutate for performance, say so near the code.

## Useful Mental Model

Aim for a functional core and imperative shell where practical, but do not introduce wrapper theater.

Bad:

- a "pure" function that still reads global config or current time
- an effectful function split into three wrappers that hide the real side effects

Good:

- a pure helper for the rule
- a small orchestrator that performs the unavoidable effects

## Registry Lifecycle and Per-Call Checks

For registry ownership and lifecycle, follow Core Rule 1 in `../SKILL.md`.

Bad — a module-owned registry whose activation filter runs only at registration:

```ts
declare const isEnabled: (id: string) => boolean;
const tools = new Map<string, () => void>();
export const register = (id: string, tool: () => void): void => {
  if (isEnabled(id)) tools.set(id, tool);
};
export const invoke = (id: string): void => { tools.get(id)?.(); };
```

Good — an injected instance whose policy is evaluated when the capability is used:

```ts
type ToolRegistry = {
  register: (id: string, tool: () => void) => void;
  unregister: (id: string) => boolean;
  reset: () => void;
  invoke: (id: string) => boolean;
};

export const createToolRegistry = (canInvoke: (id: string) => boolean): ToolRegistry => {
  const tools = new Map<string, () => void>();
  return {
    register: (id: string, tool: () => void): void => { tools.set(id, tool); },
    unregister: (id: string): boolean => tools.delete(id),
    reset: (): void => tools.clear(),
    invoke: (id: string): boolean => {
      const tool = tools.get(id);
      if (!tool || !canInvoke(id)) return false;
      tool();
      return true;
    },
  };
};
```

A filter at registration runs only once and captures boot state. Authorization and activation checks belong on every invocation, before the handler runs; the injected policy must read current state so disabling a capability takes effect immediately.
