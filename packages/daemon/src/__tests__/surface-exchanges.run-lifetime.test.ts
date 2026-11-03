import { expect, test, vi } from 'vitest';
import type { SurfaceEmitter, SurfaceEmission } from '@jini-ai/core';
import { createSurfaceExchangeStore, askOnce } from '../surface-exchanges.js';
import { withSurfaceExchangeLifetime } from '../tool-recovery/surface-lifetime.js';
import type { ToolExecutor } from '../tool-executor.js';

function fixture() {
  let now = 0;
  let nextId = 0;
  const scheduler = { schedule: vi.fn(() => () => {}) };
  const store = createSurfaceExchangeStore({ scheduler, clock: { nowMs: () => now },
    idGenerator: { newId: () => `card-${++nextId}` }, defaultChannel: 'mcp-ui' });
  const emissions: SurfaceEmission[] = [];
  let opened = '';
  let announce: (() => void) | undefined;
  const calls: unknown[] = [];
  const inner: ToolExecutor = {
    execute: async (input, options) => {
      calls.push(input);
      const exchange = store.open({ binding: { principalId: input.principal.id, toolId: input.toolId }, emit: options!.emitSurface! });
      opened = exchange.id;
      announce?.();
      const answer = await askOnce({ exchange, emission: { channel: 'mcp-ui', payload: { resource: { resource: { uri: 'ui://card', text: '<form></form>' } } } } });
      return { executionId: 'execution', status: 'completed', output: answer };
    },
    cancel: () => {}, getAuditRecord: () => null, resumeConfirmation: () => { throw new Error('unused'); },
  };
  const executor = withSurfaceExchangeLifetime({ inner });
  const emit: SurfaceEmitter = async emission => { emissions.push(emission); };
  const input = { principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'credential', input: { label: 'original' } };
  return { store, executor, input, emit, emissions, calls, scheduler,
    advance: (ms: number) => { now += ms; }, id: () => opened,
    nextOpen: () => new Promise<void>(resolve => { announce = resolve; }),
  };
}

test('the owner can answer a card after an hour while its run is alive', async () => {
  const f = fixture();
  const ready = f.nextOpen();
  const result = f.executor.execute(f.input, { emitSurface: f.emit });
  await ready;
  f.advance(60 * 60 * 1000);
  expect(f.store.deliver({ exchangeId: f.id(), principalId: 'owner', params: { decision: 'confirm' } }, { toolId: 'credential' })).toEqual({ ok: true });
  expect((await result).output).toEqual({ status: 'received', params: { decision: 'confirm' } });
  expect(f.scheduler.schedule).not.toHaveBeenCalled();
  expect(f.store.size()).toBe(0);
});

test('a late answer reissues the original tool and arguments and reaches its replacement card', async () => {
  const f = fixture();
  const controller = new AbortController();
  const ready = f.nextOpen();
  const first = f.executor.execute(f.input, { signal: controller.signal, emitSurface: f.emit });
  await ready;
  const oldId = f.id();
  controller.abort();
  await first;
  f.advance(7 * 24 * 60 * 60 * 1000);
  const restored = f.store.restore!({ exchangeId: oldId, principalId: 'owner', emit: f.emit }, { toolId: 'credential', params: { token: 'human-only' } });
  expect(await restored).toEqual({ ok: true });
  expect(f.calls).toEqual([f.input, f.input]);
  expect(f.id()).not.toBe(oldId);
  expect(f.store.size()).toBe(0);
  expect(JSON.stringify(f.emissions)).not.toContain('human-only');
});

test('returning to an unanswered card reissues it once even when two tabs return together', async () => {
  const f = fixture();
  const controller = new AbortController();
  const ready = f.nextOpen();
  const first = f.executor.execute(f.input, { signal: controller.signal, emitSurface: f.emit });
  await ready;
  const oldId = f.id();
  controller.abort();
  await first;
  const replacement = f.nextOpen();
  const one = f.store.restore!({ exchangeId: oldId, principalId: 'owner', emit: f.emit }, { toolId: 'credential' });
  const two = f.store.restore!({ exchangeId: oldId, principalId: 'owner', emit: f.emit }, { toolId: 'credential' });
  await replacement;
  expect(f.store.size()).toBe(1);
  expect(f.calls).toHaveLength(2);
  expect(f.store.deliver({ exchangeId: f.id(), principalId: 'owner', params: { decision: 'confirm' } }, { toolId: 'credential' })).toEqual({ ok: true });
  expect(await one).toEqual({ ok: true });
  expect(await two).toEqual({ ok: true });
});

test('another principal or tool cannot restore an abandoned credential card', async () => {
  const f = fixture();
  const controller = new AbortController();
  const ready = f.nextOpen();
  const first = f.executor.execute(f.input, { signal: controller.signal, emitSurface: f.emit });
  await ready;
  controller.abort();
  await first;
  for (const binding of [{ principalId: 'intruder', toolId: 'credential' }, { principalId: 'owner', toolId: 'other' }]) {
    expect(await f.store.restore!({ exchangeId: f.id(), principalId: binding.principalId, emit: f.emit }, { toolId: binding.toolId }))
      .toEqual({ ok: false, reason: 'binding-mismatch' });
  }
  expect(f.calls).toHaveLength(1);
});

test('an answered card cannot be restored or execute its mutation a second time', async () => {
  const f = fixture();
  const ready = f.nextOpen();
  const first = f.executor.execute(f.input, { emitSurface: f.emit });
  await ready;
  const id = f.id();
  f.store.deliver({ exchangeId: id, principalId: 'owner', params: { decision: 'confirm' } });
  await first;
  expect(await f.store.restore!({ exchangeId: id, principalId: 'owner', emit: f.emit }))
    .toEqual({ ok: false, reason: 'unknown-or-closed' });
  expect(f.calls).toHaveLength(1);
});

test('a run ending releases its unanswered card instead of keeping the daemon busy forever', async () => {
  const { createDelegatedToolBridge } = await import('../delegated-tool-bridge.js');
  const { createRunLifecycle } = await import('../run-lifecycle.js');
  const { createInMemoryEventLog } = await import('../event-log.js');
  const f = fixture();
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'owner-approval' });
  const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: f.executor });
  const controller = new AbortController();
  const ready = f.nextOpen();
  const request = bridge.execute({ runId: run.id, toolUseId: 'save', toolId: f.input.toolId,
    principal: f.input.principal, input: f.input.input }, { signal: controller.signal }).catch(() => undefined);
  try {
    await ready;
    await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });
    await vi.waitFor(() => expect(f.store.size()).toBe(0));
  } finally { controller.abort(); await request; }
});

test('restoring a card uses the original arguments and trusted execution context after the request leaves', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const context = new AsyncLocalStorage<string>();
  const f = fixture();
  const contexts: (string | undefined)[] = [];
  const emit: SurfaceEmitter = async emission => { contexts.push(context.getStore()); await f.emit(emission); };
  const controller = new AbortController();
  const ready = f.nextOpen();
  const first = context.run('trusted-site', () => f.executor.execute(f.input, { signal: controller.signal, emitSurface: emit }));
  await ready;
  const oldId = f.id();
  controller.abort(); await first;
  f.input.input.label = 'changed-after-call';
  expect(await f.store.restore!({ exchangeId: oldId, principalId: 'owner', emit },
    { toolId: 'credential', params: { decision: 'confirm' } })).toEqual({ ok: true });
  expect(f.calls.at(-1)).toEqual({ ...f.input, input: { label: 'original' } });
  expect(contexts).toEqual(['trusted-site', 'trusted-site']);
});
