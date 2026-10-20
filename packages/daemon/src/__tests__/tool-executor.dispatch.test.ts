/**
 * Pins every dispatch path of `ToolExecutor.execute()` — each terminal state, the order of audit
 * transitions on the way there, and the nested `invokeTool` port — so the function can be split
 * without changing what any caller observes.
 */
import {
  createToolRegistry,
  ToolInputError,
  type Principal,
  type RunRef,
  type SurfaceEmitter,
  type ToolExecutionOptions,
  type ToolRegistration,
  type ToolRegistry,
} from '@jini-ai/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToolExecutor, type ExecutionDelegate, type ToolExecutor } from '../tool-executor.js';

const principal: Principal = { id: 'user-1' };
const run: RunRef = { id: 'run-1' };

function registryWith(...registrations: ToolRegistration[]): ToolRegistry {
  const registry = createToolRegistry({});
  for (const registration of registrations) registry.register(registration);
  return registry;
}

function tool(id: string, handler: ToolRegistration['handler'], descriptor: Partial<ToolRegistration['descriptor']> = {}): ToolRegistration {
  return { descriptor: { id, ...descriptor }, handler, policy: { authorize: () => 'allow' } };
}

function phases(executor: ToolExecutor, executionId: string): string[] {
  return executor.getAuditRecord({ executionId })?.events.map((event) => event.phase) ?? [];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ToolExecutor.execute — gates before the handler', () => {
  it('returns cancelled without consulting the policy when the signal is already aborted', async () => {
    const authorize = vi.fn(() => 'allow' as const);
    const handler = vi.fn(async () => 'ran');
    const executor = createToolExecutor({ registry: registryWith({ descriptor: { id: 't' }, handler, policy: { authorize } }) });
    const signal = AbortSignal.abort();

    const result = await executor.execute({ principal, run, toolId: 't', input: {} }, { signal });

    expect(result).toEqual({ executionId: result.executionId, status: 'cancelled' });
    expect(phases(executor, result.executionId)).toEqual(['requested', 'cancelled']);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a generic failed result when the policy throws, keeping the exception text out of the result', async () => {
    const executor = createToolExecutor({ registry: registryWith({ descriptor: { id: 't' }, handler: async () => 'ran', policy: { authorize: () => { throw new Error('db password rejected'); } } }) });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'failed', error: 'authorization failed' });
    expect(executor.getAuditRecord({ executionId: result.executionId })?.events.at(-1)).toMatchObject({ phase: 'failed', detail: 'authorization failed' });
  });

  it('returns cancelled when the signal fires while the policy is still deciding', async () => {
    const controller = new AbortController();
    const handler = vi.fn(async () => 'ran');
    const executor = createToolExecutor({ registry: registryWith({ descriptor: { id: 't' }, handler, policy: { authorize: async () => { controller.abort(); return 'allow' as const; } } }) });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} }, { signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(phases(executor, result.executionId)).toEqual(['requested', 'cancelled']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns denied when the delegate vetoes an allowed policy', async () => {
    const delegate: ExecutionDelegate = { onAuthorize: () => 'deny' };
    const executor = createToolExecutor({ registry: registryWith(tool('t', async () => 'ran')) }, { delegate });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'denied' });
    expect(phases(executor, result.executionId)).toEqual(['requested', 'denied']);
  });

  it('removes its transport abort listener on every early return', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const executor = createToolExecutor({ registry: registryWith({ descriptor: { id: 't' }, handler: async () => 'ran', policy: { authorize: () => 'deny' } }) });

    await executor.execute({ principal, run, toolId: 't', input: {} }, { signal: controller.signal });

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('ToolExecutor.execute — confirmation gate', () => {
  it('returns a generic failed result when onConfirm throws synchronously', async () => {
    const handler = vi.fn(async () => 'ran');
    const delegate: ExecutionDelegate = { onConfirm: () => { throw new Error('socket closed'); } };
    const executor = createToolExecutor({ registry: registryWith(tool('t', handler, { requiresConfirmation: true })) }, { delegate });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'failed', error: 'confirmation failed' });
    expect(phases(executor, result.executionId)).toEqual(['requested', 'authorized', 'failed']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a generic failed result when onConfirm rejects', async () => {
    const delegate: ExecutionDelegate = { onConfirm: () => Promise.reject(new Error('socket closed')) };
    const executor = createToolExecutor({ registry: registryWith(tool('t', async () => 'ran', { requiresConfirmation: true })) }, { delegate });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'failed', error: 'confirmation failed' });
  });

  it('records confirmation-denied for a human deny and cancelled for a cancel of the pending confirmation', async () => {
    const ids: string[] = [];
    const delegateExecutor = createToolExecutor({ registry: registryWith(tool('t', async () => 'ran', { requiresConfirmation: true })) }, {
      delegate: { onConfirm: (request) => { ids.push(request.executionId); } },
    });

    const denied = delegateExecutor.execute({ principal, run, toolId: 't', input: {} });
    await vi.waitFor(() => expect(ids).toHaveLength(1));
    delegateExecutor.resumeConfirmation({ executionId: ids[0]!, decision: 'deny' });
    const cancelled = delegateExecutor.execute({ principal, run, toolId: 't', input: {} });
    await vi.waitFor(() => expect(ids).toHaveLength(2));
    delegateExecutor.cancel({ executionId: ids[1]! });

    expect((await denied).status).toBe('confirmation-denied');
    expect(phases(delegateExecutor, ids[0]!)).toEqual(['requested', 'authorized', 'confirmation-denied']);
    expect((await cancelled).status).toBe('cancelled');
    expect(phases(delegateExecutor, ids[1]!)).toEqual(['requested', 'authorized', 'cancelled']);
  });

  it('runs the handler after an inline confirm and records confirmed before started', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('t', async () => 'ran', { requiresConfirmation: true })) }, { delegate: { onConfirm: async () => 'confirm' as const } });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result.status).toBe('completed');
    expect(phases(executor, result.executionId)).toEqual(['requested', 'authorized', 'confirmed', 'started', 'completed']);
  });
});

describe('ToolExecutor.execute — advisory guidance', () => {
  it('forwards the transport emitSurface to prepareGuidance only when one was supplied', async () => {
    const seen: Array<boolean> = [];
    const prepareGuidance = vi.fn(async (required: { emitSurface?: SurfaceEmitter }) => { seen.push('emitSurface' in required); return 'G'; });
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => 'ok', { metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance });
    const emitSurface: SurfaceEmitter = async () => undefined;

    await executor.execute({ principal, run, toolId: 'w', input: {} }, { emitSurface });
    await executor.execute({ principal, run, toolId: 'w', input: {} });

    expect(seen).toEqual([true, false]);
  });

  it('skips prepareGuidance for a tool declaring an empty guidanceCapabilities list', async () => {
    const prepareGuidance = vi.fn(async () => 'G');
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => 'ok', { metadata: { guidanceCapabilities: [] } })) }, { prepareGuidance });

    const result = await executor.execute({ principal, run, toolId: 'w', input: {} });

    expect(result.output).toBe('ok');
    expect(prepareGuidance).not.toHaveBeenCalled();
  });

  it('returns cancelled without starting the handler when cancel() lands while guidance is being prepared', async () => {
    const handler = vi.fn(async () => 'ran');
    let executionId = '';
    // Confirmation is used only to learn the execution id before guidance runs.
    const executor: ToolExecutor = createToolExecutor({ registry: registryWith(tool('w', handler, { requiresConfirmation: true, metadata: { guidanceCapabilities: ['x'] } })) }, {
      prepareGuidance: async () => { executor.cancel({ executionId }); return 'G'; },
      delegate: { onConfirm: (request) => { executionId = request.executionId; return 'confirm'; } },
    });

    const result = await executor.execute({ principal, run, toolId: 'w', input: {} });

    expect(result).toEqual({ executionId, status: 'cancelled' });
    expect(phases(executor, executionId)).toEqual(['requested', 'authorized', 'confirmed', 'cancelled']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('appends guidance to a string output', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => 'saved', { metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance: async () => 'G' });
    expect((await executor.execute({ principal, run, toolId: 'w', input: {} })).output).toBe('saved\n\nG');
  });

  it.each([
    ['an array', [1, 2]],
    ['null', null],
    ['a number', 7],
  ])('wraps %s output with the guidance as a result field', async (_label, output) => {
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => output, { metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance: async () => 'G' });
    expect((await executor.execute({ principal, run, toolId: 'w', input: {} })).output).toEqual({ result: output, agentPluginGuidance: 'G' });
  });

  it('adds guidance as a field beside an object whose content is not an array', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => ({ content: 'x' }), { metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance: async () => 'G' });
    expect((await executor.execute({ principal, run, toolId: 'w', input: {} })).output).toEqual({ content: 'x', agentPluginGuidance: 'G' });
  });

  it('appends guidance to a handler failure message', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('w', async () => { throw new Error('disk full'); }, { metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance: async () => 'G' });
    expect(await executor.execute({ principal, run, toolId: 'w', input: {} })).toMatchObject({ status: 'failed', error: 'disk full\n\nG', errorKind: 'internal' });
  });

  it('leaves a timed-out result untouched by guidance', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('w', (ctx) => new Promise((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    }), { timeoutMs: 5, metadata: { guidanceCapabilities: ['x'] } })) }, { prepareGuidance: async () => 'G' });

    const result = await executor.execute({ principal, run, toolId: 'w', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'timed-out' });
  });
});

describe('ToolExecutor.execute — handler outcomes', () => {
  it('stringifies a non-Error rejection and classifies it internal', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('t', () => Promise.reject('plain string'))) });
    expect(await executor.execute({ principal, run, toolId: 't', input: {} })).toMatchObject({ status: 'failed', error: 'plain string', errorKind: 'internal' });
  });

  it('reports cancelled when a handler ignores the signal and resolves after cancel()', async () => {
    let executor: ToolExecutor | undefined;
    executor = createToolExecutor({ registry: registryWith(tool('t', async (ctx) => { executor!.cancel({ executionId: ctx.executionId }); return 'late'; })) });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'cancelled' });
    expect(phases(executor, result.executionId)).toEqual(['requested', 'authorized', 'started', 'cancelled']);
  });

  it('reports timed-out when a handler ignores the signal and resolves after its timeout', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('t', () => new Promise((resolve) => setTimeout(() => resolve('late'), 30)), { timeoutMs: 1 })) });

    const result = await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(result).toEqual({ executionId: result.executionId, status: 'timed-out' });
  });

  it('truncates string output to maxOutputBytes and reports it', async () => {
    const executor = createToolExecutor({ registry: registryWith(tool('t', async () => 'abcdef', { maxOutputBytes: 3 })) });
    expect(await executor.execute({ principal, run, toolId: 't', input: {} })).toMatchObject({ status: 'completed', output: 'abc', truncated: true });
  });

  it('forwards emitSurface to the handler only when the transport supplied one', async () => {
    const seen: boolean[] = [];
    const executor = createToolExecutor({ registry: registryWith(tool('t', async (_ctx, options) => { seen.push(options !== undefined && 'emitSurface' in options); return 'ok'; })) });

    await executor.execute({ principal, run, toolId: 't', input: {} }, { emitSurface: async () => undefined });
    await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(seen).toEqual([true, false]);
  });

  it('clears an armed timeout once the handler completes', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const executor = createToolExecutor({ registry: registryWith(tool('t', async () => 'ok', { timeoutMs: 60_000 })) });

    await executor.execute({ principal, run, toolId: 't', input: {} });

    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});

describe('ToolExecutor.execute — nested invokeTool port', () => {
  function parentInvoking(invoke: (port: NonNullable<ToolExecutionOptions['invokeTool']>) => Promise<unknown>): ToolRegistration {
    return tool('parent', async (_ctx, options) => invoke(options!.invokeTool!));
  }

  it('returns the nested tool output on completion and audits the nested call separately', async () => {
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'child', input: 'x' })), tool('child', async (ctx) => `child:${String(ctx.input)}`));
    const executor = createToolExecutor({ registry });

    expect(await executor.execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'completed', output: 'child:x' });
  });

  it('rethrows a nested validation failure as a ToolInputError carrying the nested message', async () => {
    let caught: unknown;
    const registry = registryWith(
      parentInvoking(async (invoke) => { try { return await invoke({ toolId: 'child', input: {} }); } catch (error) { caught = error; throw error; } }),
      tool('child', async () => { throw new ToolInputError({ message: 'name is required' }); }),
    );

    const result = await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} });

    expect(caught).toBeInstanceOf(ToolInputError);
    expect(caught).toMatchObject({ message: 'name is required' });
    expect(result).toMatchObject({ status: 'failed', errorKind: 'validation', error: 'name is required' });
  });

  it('rethrows a nested internal failure as an Error carrying the nested message', async () => {
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'child', input: {} })), tool('child', async () => { throw new Error('child broke'); }));
    expect(await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'failed', errorKind: 'internal', error: 'child broke' });
  });

  it('rethrows a nested denial as an Error naming the nested tool and status', async () => {
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'child', input: {} })), { descriptor: { id: 'child' }, handler: async () => 'no', policy: { authorize: () => 'deny' } });
    expect(await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'failed', errorKind: 'internal', error: 'child: denied' });
  });

  it('resolves a nested id absent from the invoking registry against the supplied registry', async () => {
    const side = registryWith(tool('side-only', async () => 'from side'));
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'side-only', input: {} }, { registry: side })));
    expect(await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'completed', output: 'from side' });
  });

  it('prefers the invoking registry over a supplied one when it already holds the nested id', async () => {
    const side = registryWith(tool('child', async () => 'from side'));
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'child', input: {} }, { registry: side })), tool('child', async () => 'from main'));
    expect(await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'completed', output: 'from main' });
  });

  it('keeps the invoking registry for a self-invocation, whatever registry is supplied', async () => {
    let depth = 0;
    const side = registryWith(tool('parent', async () => 'from side'));
    const registry = registryWith(tool('parent', async (_ctx, options) => {
      depth += 1;
      if (depth > 1) return 'from main';
      return options!.invokeTool!({ toolId: 'parent', input: {} }, { registry: side });
    }));
    expect(await createToolExecutor({ registry }).execute({ principal, run, toolId: 'parent', input: {} })).toMatchObject({ status: 'completed', output: 'from main' });
  });

  it('passes the transport emitSurface down to the nested handler', async () => {
    const seen: boolean[] = [];
    const registry = registryWith(parentInvoking((invoke) => invoke({ toolId: 'child', input: {} })),
      tool('child', async (_ctx, options) => { seen.push(options?.emitSurface !== undefined); return 'ok'; }));
    const executor = createToolExecutor({ registry });

    await executor.execute({ principal, run, toolId: 'parent', input: {} }, { emitSurface: async () => undefined });
    await executor.execute({ principal, run, toolId: 'parent', input: {} });

    expect(seen).toEqual([true, false]);
  });

  it('cancels the nested call when the parent is cancelled, because the parent signal is passed down', async () => {
    let executor: ToolExecutor | undefined;
    let parentId = '';
    const registry = registryWith(
      tool('parent', async (ctx, options) => { parentId = ctx.executionId; return options!.invokeTool!({ toolId: 'child', input: {} }); }),
      tool('child', (ctx) => new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('child stopped')), { once: true });
        executor!.cancel({ executionId: parentId });
      })),
    );
    executor = createToolExecutor({ registry });

    expect((await executor.execute({ principal, run, toolId: 'parent', input: {} })).status).toBe('cancelled');
  });
});
