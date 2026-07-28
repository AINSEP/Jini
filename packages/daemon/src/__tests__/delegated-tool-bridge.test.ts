import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { RunAgentPayload, RunProtocolEvent } from '@jini-ai/protocol';
import { createDelegatedToolBridge, serializeDelegatedToolOutput } from '../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createToolExecutor, type ToolExecutionResult, type ToolExecutor } from '../tool-executor.js';

async function collectEvents(lifecycle: ReturnType<typeof createRunLifecycle>, runId: string): Promise<RunProtocolEvent[]> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream(runId, (event) => events.push(event));
  return events;
}

describe('DelegatedToolBridge', () => {
  it('routes one allowed and one denied delegated call through ToolExecutor with matching run events and audits', async () => {
    const registry = createToolRegistry();
    const allowedHandler = vi.fn(async (input: { input: unknown }) => ({ echoed: input.input }));
    const deniedHandler = vi.fn(async () => 'must not run');
    registry.register({
      descriptor: { id: 'echo' },
      handler: allowedHandler,
      policy: { authorize: () => 'allow' },
    });
    registry.register({
      descriptor: { id: 'blocked' },
      handler: deniedHandler,
      policy: { authorize: () => 'deny' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const allowed = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-allow',
      toolId: 'echo',
      principal: { id: 'user-1' },
      input: { greeting: 'hello' },
    });
    const denied = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-deny',
      toolId: 'blocked',
      principal: { id: 'user-1' },
      input: { destructive: true },
    });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(allowed.status).toBe('completed');
    expect(denied.status).toBe('denied');
    expect(allowedHandler).toHaveBeenCalledTimes(1);
    expect(deniedHandler).not.toHaveBeenCalled();
    expect(toolExecutor.getAuditRecord(allowed.executionId)?.events.map((event) => event.phase)).toEqual([
      'requested',
      'authorized',
      'started',
      'completed',
    ]);
    expect(toolExecutor.getAuditRecord(denied.executionId)?.events.map((event) => event.phase)).toEqual([
      'requested',
      'denied',
    ]);

    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toEqual([
      { type: 'tool_use', id: 'call-allow', name: 'echo', input: { greeting: 'hello' } },
      { type: 'tool_result', toolUseId: 'call-allow', content: '{"echoed":{"greeting":"hello"}}' },
      { type: 'tool_use', id: 'call-deny', name: 'blocked', input: { destructive: true } },
      {
        type: 'tool_result',
        toolUseId: 'call-deny',
        content: 'Tool execution denied by policy.',
        isError: true,
      },
    ]);
  });

  it('serializes non-string tool output without throwing on circular values', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(serializeDelegatedToolOutput({ ok: true })).toBe('{"ok":true}');
    expect(serializeDelegatedToolOutput(undefined)).toBe('');
    expect(serializeDelegatedToolOutput(circular)).toBe('[object Object]');
  });

  it('passes an already-string tool output through untouched', () => {
    expect(serializeDelegatedToolOutput('already a string')).toBe('already a string');
  });

  it('falls back to String() when JSON.stringify itself produces undefined (e.g. a function value)', () => {
    const fn = () => 'unused';
    expect(serializeDelegatedToolOutput(fn)).toBe(String(fn));
  });

  it('rethrows and records an error tool_result when ToolExecutor.execute throws before producing a result', async () => {
    const toolExecutor = createToolExecutor({ registry: createToolRegistry() });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    await expect(
      bridge.execute({
        runId: run.id,
        toolUseId: 'call-missing',
        toolId: 'missing',
        principal: { id: 'user-1' },
        input: {},
      }),
    ).rejects.toThrow(/unknown tool "missing"/);

    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toEqual([
      { type: 'tool_use', id: 'call-missing', name: 'missing', input: {} },
      {
        type: 'tool_result',
        toolUseId: 'call-missing',
        content: 'ToolExecutor: unknown tool "missing"',
        isError: true,
      },
    ]);
  });

  it('reports the confirmation-denied result content when the delegate declines confirmation', async () => {
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      handler: async () => 'should not run',
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry, delegate: { onConfirm: () => 'deny' } });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'confirm-me',
      principal: { id: 'user-1' },
      input: {},
    });

    expect(result.status).toBe('confirmation-denied');
    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'confirm-me', input: {} },
      {
        type: 'tool_result',
        toolUseId: 'call-1',
        content: 'Tool execution denied during confirmation.',
        isError: true,
      },
    ]);
  });

  it('reports the timed-out result content when the tool outlives its timeout', async () => {
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'slow', timeoutMs: 10 },
      handler: (ctx: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'slow',
      principal: { id: 'user-1' },
      input: {},
    });

    expect(result.status).toBe('timed-out');
    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toContainEqual({
      type: 'tool_result',
      toolUseId: 'call-1',
      content: 'Tool execution timed out.',
      isError: true,
    });
  });

  it('reports the failed result content using the handler error message, without throwing', async () => {
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'flaky' },
      handler: async () => {
        throw new Error('boom');
      },
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'flaky',
      principal: { id: 'user-1' },
      input: {},
    });

    expect(result.status).toBe('failed');
    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toContainEqual({
      type: 'tool_result',
      toolUseId: 'call-1',
      content: 'boom',
      isError: true,
    });
  });

  it('aborts immediately when the invocation-supplied transport signal is already aborted before execute() runs', async () => {
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'cancellable' },
      handler: (ctx: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });
    const controller = new AbortController();
    controller.abort();

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'cancellable',
      principal: { id: 'user-1' },
      input: {},
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
  });

  it('aborts mid-flight when the invocation-supplied transport signal aborts once the handler is running, then unsubscribes its listener', async () => {
    // Aborting from inside the handler (rather than racing a fixed number of
    // `Promise.resolve()` microtask ticks from the test) deterministically
    // guarantees the bridge has already run its
    // `if (invocation.signal.aborted) ... else invocation.signal.addEventListener(...)`
    // check with the signal still un-aborted — i.e. it exercises the `else`
    // (addEventListener) branch, not the immediate-abort branch covered by
    // the "already aborted before execute() runs" case above. `abort()`
    // propagates through chained AbortControllers synchronously, so by the
    // time the outer `transportController.abort()` call returns, the
    // handler's own `ctx.signal` is already aborted.
    const transportController = new AbortController();
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'cancellable' },
      handler: () =>
        new Promise((_resolve, reject) => {
          transportController.abort();
          reject(new Error('aborted'));
        }),
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'cancellable',
      principal: { id: 'user-1' },
      input: {},
      signal: transportController.signal,
    });

    expect(result.status).toBe('cancelled');

    // The listener was removed in `finally`, so aborting again post-settlement is a no-op — this
    // would throw if `abortFromTransport` (or anything else) were still wired to the signal.
    expect(() => transportController.abort()).not.toThrow();
  });

  it('CR-R6: removes its abort listener in finally on normal completion, even though the signal never aborted', async () => {
    // The test above calls `abort()` a second time to check cleanup, but `AbortController.abort()`
    // only ever dispatches once and the listener was registered with `{ once: true }` — that
    // assertion would still pass even if the explicit `removeEventListener` call in
    // delegated-tool-bridge.ts's `finally` block were deleted, since `{once:true}` already
    // auto-removes a listener that actually fired. This test instruments addEventListener/
    // removeEventListener directly and exercises the path where `{once:true}` never fires at
    // all — normal completion — which is the only path where the explicit cleanup matters.
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: 'ok-tool' },
      handler: async () => 'done',
      policy: { authorize: () => 'allow' },
    });
    const toolExecutor = createToolExecutor({ registry });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const transportController = new AbortController();
    const addEventListenerSpy = vi.spyOn(transportController.signal, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(transportController.signal, 'removeEventListener');

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'ok-tool',
      principal: { id: 'user-1' },
      input: {},
      signal: transportController.signal,
    });

    expect(result.status).toBe('completed');
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    const [, registeredListener] = addEventListenerSpy.mock.calls[0]!;
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', registeredListener);
  });

  it('falls back to String(error) when a custom ToolExecutor throws a non-Error value', async () => {
    // `errorMessage`'s `error instanceof Error` ternary has a false branch
    // that `createToolExecutor`'s reference implementation never actually
    // takes (its one rethrow site always throws `new Error(...)`), but
    // `DelegatedToolBridge` is built against the `ToolExecutor` *interface*,
    // so a conforming implementation is free to reject with anything.
    const failingExecutor: ToolExecutor = {
      execute: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw string failure';
      }),
      resumeConfirmation: vi.fn(),
      cancel: vi.fn(),
      getAuditRecord: vi.fn(() => null),
    };
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: failingExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    await expect(
      bridge.execute({
        runId: run.id,
        toolUseId: 'call-1',
        toolId: 'whatever',
        principal: { id: 'user-1' },
        input: {},
      }),
    ).rejects.toBe('raw string failure');

    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toContainEqual({
      type: 'tool_result',
      toolUseId: 'call-1',
      content: 'raw string failure',
      isError: true,
    });
  });

  it('propagates a failure from the catch block\'s own tool_result emit when the run finishes mid-flight (double fault)', async () => {
    // If something else finishes the run concurrently with a delegate's own tool-execution
    // failure, the catch block's own `lifecycle.emit(...tool_result...)` call (line 113) can
    // itself throw — RunLifecycle refuses to emit on an already-terminal run. `finally` must
    // still run its cleanup (unsubscribe, listener removal), and it's this *second* emit
    // failure — not the original tool error — that ultimately propagates to the caller.
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });
    const doubleFaultExecutor: ToolExecutor = {
      execute: vi.fn(async () => {
        await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
        throw new Error('tool exploded');
      }),
      resumeConfirmation: vi.fn(),
      cancel: vi.fn(),
      getAuditRecord: vi.fn(() => null),
    };
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: doubleFaultExecutor });

    await expect(
      bridge.execute({
        runId: run.id,
        toolUseId: 'call-1',
        toolId: 'whatever',
        principal: { id: 'user-1' },
        input: {},
      }),
    ).rejects.toThrow(/cannot emit "agent" on terminal run/);
  });

  it('falls back to the default failed-content message when a custom ToolExecutor omits result.error', async () => {
    // `ToolExecutionResult.error` is optional even when `status` is
    // `'failed'` — `createToolExecutor`'s reference implementation always
    // populates it, but `resultContent`'s `result.error ?? 'Tool execution
    // failed.'` fallback exists for a conforming `ToolExecutor` that doesn't.
    const failedResult: ToolExecutionResult = { executionId: 'exec-1', status: 'failed' };
    const bareFailureExecutor: ToolExecutor = {
      execute: vi.fn(async () => failedResult),
      resumeConfirmation: vi.fn(),
      cancel: vi.fn(),
      getAuditRecord: vi.fn(() => null),
    };
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: bareFailureExecutor });
    const { run } = await lifecycle.start({ contextRef: 'delegated-tools' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-1',
      toolId: 'whatever',
      principal: { id: 'user-1' },
      input: {},
    });

    expect(result).toBe(failedResult);
    const agentEvents = (await collectEvents(lifecycle, run.id))
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload);
    expect(agentEvents).toContainEqual({
      type: 'tool_result',
      toolUseId: 'call-1',
      content: 'Tool execution failed.',
      isError: true,
    });
  });
});
