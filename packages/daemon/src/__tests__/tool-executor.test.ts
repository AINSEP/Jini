import {
  createToolRegistry,
  type AuthorizationDecision,
  type Principal,
  type RunRef,
  type ToolRegistration,
  type ToolRegistry,
} from '@jini-ai/core';
import { describe, expect, it, vi } from 'vitest';

import {
  createToolExecutor,
  type ConfirmationDecision,
  type ExecutionDelegate,
  type ToolAuthorizationRequest,
  type ToolConfirmationRequest,
} from '../tool-executor.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

const principal: Principal = { id: 'user-1' };
const run: RunRef = { id: 'run-1' };

function registryWith(...registrations: ToolRegistration[]): ToolRegistry {
  const registry = createToolRegistry();
  for (const registration of registrations) registry.register(registration);
  return registry;
}

function allowAll(): ToolRegistration['policy'] {
  return { authorize: () => 'allow' };
}

describe('@jini-ai/daemon — ToolExecutor — authorization', () => {
  it('throws for an unregistered tool id', async () => {
    const executor = createToolExecutor({ registry: createToolRegistry() });
    await expect(executor.execute(principal, run, 'missing', {})).rejects.toThrow(/unknown tool "missing"/);
  });

  it('runs an allowed tool call end to end and records the audit trail', async () => {
    const registry = registryWith({
      descriptor: { id: 'echo' },
      handler: async (ctx) => `echo:${ctx.input}`,
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(principal, run, 'echo', 'hi');
    expect(result.status).toBe('completed');
    expect(result.output).toBe('echo:hi');
    expect(result.truncated).toBe(false);

    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.toolId).toBe('echo');
    expect(audit?.principalId).toBe('user-1');
    expect(audit?.runId).toBe('run-1');
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'authorized', 'started', 'completed']);
  });

  it('denies a tool call whose policy denies, and stops before started/completed', async () => {
    const registry = registryWith({
      descriptor: { id: 'danger' },
      handler: async () => 'should not run',
      policy: { authorize: () => 'deny' },
    });
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(principal, run, 'danger', {});
    expect(result.status).toBe('denied');
    expect(result.output).toBeUndefined();
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'denied']);
  });

  it('honors an async policy decision', async () => {
    const registry = registryWith({
      descriptor: { id: 'async-policy' },
      handler: async () => 'ok',
      policy: { authorize: async (): Promise<AuthorizationDecision> => 'allow' },
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'async-policy', {});
    expect(result.status).toBe('completed');
  });

  it('lets the delegate veto an otherwise-allowed call', async () => {
    const registry = registryWith({
      descriptor: { id: 'gated' },
      handler: async () => 'should not run',
      policy: allowAll(),
    });
    const delegate: ExecutionDelegate = { onAuthorize: () => 'deny' };
    const executor = createToolExecutor({ registry, delegate });

    const result = await executor.execute(principal, run, 'gated', {});
    expect(result.status).toBe('denied');
  });

  it('never consults the delegate authorizer when the policy already denies', async () => {
    let called = false;
    const registry = registryWith({
      descriptor: { id: 'danger' },
      handler: async () => 'x',
      policy: { authorize: () => 'deny' },
    });
    const delegate: ExecutionDelegate = {
      onAuthorize: () => {
        called = true;
        return 'allow';
      },
    };
    const executor = createToolExecutor({ registry, delegate });
    await executor.execute(principal, run, 'danger', {});
    expect(called).toBe(false);
  });

  it('consults a class-based delegate with its own `this` intact', async () => {
    // Regression: `ExecutionDelegate` is declared with method syntax, so implementing it as a
    // class is expected usage. Handing the detached `delegate.onAuthorize` reference to
    // `@jini-ai/core` rebound `this` to the wrapper object, so a `this`-using veto threw a
    // TypeError out of `execute()` rather than returning a decision.
    class Gate implements ExecutionDelegate {
      private readonly granted = new Set(['granted']);
      onAuthorize(request: ToolAuthorizationRequest): AuthorizationDecision {
        return this.granted.has(request.tool.id) ? 'allow' : 'deny';
      }
    }
    const registry = registryWith(
      { descriptor: { id: 'granted' }, handler: async () => 'ok', policy: allowAll() },
      { descriptor: { id: 'ungranted' }, handler: async () => 'should not run', policy: allowAll() },
    );
    const executor = createToolExecutor({ registry, delegate: new Gate() });

    await expect(executor.execute(principal, run, 'granted', {})).resolves.toMatchObject({
      status: 'completed',
      output: 'ok',
    });
    await expect(executor.execute(principal, run, 'ungranted', {})).resolves.toMatchObject({
      status: 'denied',
    });
  });

  it('hands both the policy and the delegate veto the principal, run, tool and input of the call', async () => {
    // Pins the argument plumbing across the `authorizeToolInvocation` package boundary. It needs
    // a test because `Principal` and `RunRef` are mutually assignable structural `{id}` shapes, so
    // transposing those two positional arguments would typecheck silently.
    const seen: ToolAuthorizationRequest[] = [];
    const registry = registryWith({
      descriptor: { id: 'echo', description: 'echoes' },
      handler: async () => 'ok',
      policy: {
        authorize: (ctx) => {
          seen.push(ctx);
          return 'allow';
        },
      },
    });
    const delegate: ExecutionDelegate = {
      onAuthorize: (request) => {
        seen.push(request);
        return 'allow';
      },
    };
    const executor = createToolExecutor({ registry, delegate });

    const caller: Principal = { id: 'user-7', roles: ['editor'] };
    const target: RunRef = { id: 'run-9' };
    await executor.execute(caller, target, 'echo', { path: 'a.txt' });

    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect(ctx.principal).toEqual({ id: 'user-7', roles: ['editor'] });
      expect(ctx.run).toEqual({ id: 'run-9' });
      expect(ctx.tool).toEqual({ id: 'echo', description: 'echoes' });
      expect(ctx.input).toEqual({ path: 'a.txt' });
    }
  });
});

describe('@jini-ai/daemon — ToolExecutor — confirmation', () => {
  it('proceeds when the delegate confirms synchronously', async () => {
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'done',
      policy: allowAll(),
    });
    const delegate: ExecutionDelegate = { onConfirm: () => 'confirm' };
    const executor = createToolExecutor({ registry, delegate });

    const result = await executor.execute(principal, run, 'confirm-me', {});
    expect(result.status).toBe('completed');
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual([
      'requested',
      'authorized',
      'confirmed',
      'started',
      'completed',
    ]);
  });

  it('stops when the delegate denies confirmation synchronously', async () => {
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'should not run',
      policy: allowAll(),
    });
    const delegate: ExecutionDelegate = { onConfirm: () => 'deny' };
    const executor = createToolExecutor({ registry, delegate });

    const result = await executor.execute(principal, run, 'confirm-me', {});
    expect(result.status).toBe('confirmation-denied');
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'authorized', 'confirmation-denied']);
  });

  it('proceeds when the delegate confirms via a resolved Promise', async () => {
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'done',
      policy: allowAll(),
    });
    const delegate: ExecutionDelegate = { onConfirm: async (): Promise<ConfirmationDecision> => 'confirm' };
    const executor = createToolExecutor({ registry, delegate });

    const result = await executor.execute(principal, run, 'confirm-me', {});
    expect(result.status).toBe('completed');
  });

  it('is resumable: execute() parks until a separate resumeConfirmation() call supplies the decision', async () => {
    let capturedRequest: ToolConfirmationRequest | undefined;
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'done',
      policy: allowAll(),
    });
    const delegate: ExecutionDelegate = {
      onConfirm: (request) => {
        capturedRequest = request;
        return undefined;
      },
    };
    const executor = createToolExecutor({ registry, delegate });

    let settled = false;
    const resultPromise = executor.execute(principal, run, 'confirm-me', {}).then((r) => {
      settled = true;
      return r;
    });

    // Give the microtask queue a chance to reach the parked confirmation.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(capturedRequest?.tool.id).toBe('confirm-me');

    executor.resumeConfirmation(capturedRequest!.executionId, 'confirm');
    const result = await resultPromise;
    expect(result.status).toBe('completed');
  });

  it('resumable confirmation can also resolve to a denial', async () => {
    let capturedExecutionId = '';
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'should not run',
      policy: allowAll(),
    });
    const executor = createToolExecutor({
      registry,
      delegate: {
        onConfirm: (request) => {
          capturedExecutionId = request.executionId;
        },
      },
    });

    const resultPromise = executor.execute(principal, run, 'confirm-me', {});
    // Two ticks: authorizeToolInvocation (resolve + policy.authorize) is now its own async
    // function boundary in @jini-ai/core, one more hop than a direct `await policy.authorize()`.
    await Promise.resolve();
    await Promise.resolve();
    executor.resumeConfirmation(capturedExecutionId, 'deny');
    const result = await resultPromise;
    expect(result.status).toBe('confirmation-denied');
  });

  it('resumeConfirmation throws for an id with no pending confirmation', () => {
    const executor = createToolExecutor({ registry: createToolRegistry() });
    expect(() => executor.resumeConfirmation('nope', 'confirm')).toThrow(/no pending confirmation/);
  });

  it('a tool with no onConfirm delegate at all (delegate omitted entirely) is resumable via resumeConfirmation', async () => {
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'done',
      policy: allowAll(),
    });
    // No `delegate` option at all — exercises requestConfirmation's
    // `if (delegate.onConfirm)` false branch via the default `{}`, not just
    // an explicit onConfirm that happens to return undefined.
    const executor = createToolExecutor({ registry });

    const { randomUUID } = await import('node:crypto');
    vi.mocked(randomUUID).mockReturnValueOnce(
      'fixed-execution-id' as `${string}-${string}-${string}-${string}-${string}`,
    );

    const resultPromise = executor.execute(principal, run, 'confirm-me', {});
    await Promise.resolve();
    await Promise.resolve();
    executor.resumeConfirmation('fixed-execution-id', 'confirm');
    const result = await resultPromise;
    expect(result.status).toBe('completed');
  });
});

describe('@jini-ai/daemon — ToolExecutor — timeout, cancellation, output truncation', () => {
  function abortAwareHandler() {
    return (ctx: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (ctx.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
  }

  it('clears a still-pending timeout when the handler completes first', async () => {
    const registry = registryWith({
      descriptor: { id: 'fast', timeoutMs: 10_000 },
      handler: async () => 'done',
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(principal, run, 'fast', {});
    expect(result.status).toBe('completed');
  });

  it('reports timed-out when the handler outlives descriptor.timeoutMs', async () => {
    const registry = registryWith({
      descriptor: { id: 'slow', timeoutMs: 10 },
      handler: abortAwareHandler(),
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(principal, run, 'slow', {});
    expect(result.status).toBe('timed-out');
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'authorized', 'started', 'timed-out']);
  });

  it('cancels an in-flight call via cancel(executionId)', async () => {
    let executionId = '';
    const registry = registryWith({
      descriptor: { id: 'cancellable' },
      handler: (ctx) => {
        executionId = ctx.executionId;
        return abortAwareHandler()(ctx);
      },
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });

    const resultPromise = executor.execute(principal, run, 'cancellable', {});
    await Promise.resolve();
    await Promise.resolve();
    executor.cancel(executionId);

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'authorized', 'started', 'cancelled']);
  });

  it('honors an already-aborted external signal passed into execute()', async () => {
    const registry = registryWith({
      descriptor: { id: 'cancellable' },
      handler: abortAwareHandler(),
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const controller = new AbortController();
    controller.abort();

    const result = await executor.execute(principal, run, 'cancellable', {}, controller.signal);
    expect(result.status).toBe('cancelled');
  });

  it('propagates a still-live external signal aborting mid-flight', async () => {
    const registry = registryWith({
      descriptor: { id: 'cancellable' },
      handler: abortAwareHandler(),
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const controller = new AbortController();

    const resultPromise = executor.execute(principal, run, 'cancellable', {}, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
  });

  it('cancel() cancelling a still-pending confirmation resolves it as denied', async () => {
    let capturedExecutionId = '';
    const registry = registryWith({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'should not run',
      policy: allowAll(),
    });
    const executor = createToolExecutor({
      registry,
      delegate: { onConfirm: (request) => { capturedExecutionId = request.executionId; } },
    });

    const resultPromise = executor.execute(principal, run, 'confirm-me', {});
    // Two ticks: authorizeToolInvocation (resolve + policy.authorize) is now its own async
    // function boundary in @jini-ai/core, one more hop than a direct `await policy.authorize()`.
    await Promise.resolve();
    await Promise.resolve();
    executor.cancel(capturedExecutionId);

    const result = await resultPromise;
    expect(result.status).toBe('confirmation-denied');
  });

  it('cancel() is a no-op for an unknown or already-terminal execution id', async () => {
    const registry = registryWith({ descriptor: { id: 'echo' }, handler: async () => 'ok', policy: allowAll() });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'echo', {});
    expect(() => executor.cancel(result.executionId)).not.toThrow();
    expect(() => executor.cancel('never-existed')).not.toThrow();
  });

  it('reports a plain failure when the handler throws for a reason other than timeout/cancellation', async () => {
    const registry = registryWith({
      descriptor: { id: 'flaky' },
      handler: async () => {
        throw new Error('boom');
      },
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'flaky', {});
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.at(-1)).toMatchObject({ phase: 'failed', detail: 'boom' });
  });

  it('stringifies a non-Error throw', async () => {
    const registry = registryWith({
      descriptor: { id: 'flaky-string' },
      handler: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw string failure';
      },
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'flaky-string', {});
    expect(result.status).toBe('failed');
    expect(result.error).toBe('raw string failure');
  });

  it('truncates string output exceeding maxOutputBytes', async () => {
    const registry = registryWith({
      descriptor: { id: 'chatty', maxOutputBytes: 5 },
      handler: async () => 'this is a long output string',
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'chatty', {});
    expect(result.status).toBe('completed');
    expect(result.truncated).toBe(true);
    expect(result.output).toBe('this ');
  });

  it('does not truncate string output within the limit', async () => {
    const registry = registryWith({
      descriptor: { id: 'quiet', maxOutputBytes: 100 },
      handler: async () => 'short',
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'quiet', {});
    expect(result.truncated).toBe(false);
    expect(result.output).toBe('short');
  });

  it('passes non-string output through untouched even when maxOutputBytes is set', async () => {
    const registry = registryWith({
      descriptor: { id: 'structured', maxOutputBytes: 5 },
      handler: async () => ({ ok: true, big: 'x'.repeat(50) }),
      policy: allowAll(),
    });
    const executor = createToolExecutor({ registry });
    const result = await executor.execute(principal, run, 'structured', {});
    expect(result.truncated).toBe(false);
    expect(result.output).toEqual({ ok: true, big: 'x'.repeat(50) });
  });

  it('getAuditRecord returns null for an unknown execution id', () => {
    const executor = createToolExecutor({ registry: createToolRegistry() });
    expect(executor.getAuditRecord('never-existed')).toBeNull();
  });

  it('honors an injected clock for audit timestamps', async () => {
    let clock = 1000;
    const registry = registryWith({ descriptor: { id: 'echo' }, handler: async () => 'ok', policy: allowAll() });
    const executor = createToolExecutor({ registry, now: () => clock++ });
    const result = await executor.execute(principal, run, 'echo', {});
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.at)).toEqual([1000, 1001, 1002, 1003]);
  });
});
