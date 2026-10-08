import { test, expect } from 'vitest';
import type { SurfaceEmission } from '@jini-ai/core';
import type { ToolExecutionResult, ToolExecutor } from '../tool-executor.js';
import { withToolAttemptAudit, appendToolCatalogAttempt } from '../tool-audit.js';
import { createSurfaceExchangeStore, askOnce } from '../surface-exchanges.js';
import { createLiveRunTracker, agentAcceptsHostMintedSessionId, agentCarriesOwnMemory, waitForStoppingRuns } from '../session-coordination.js';
import type { SchedulerPort } from '../scheduler.js';

function clock() {
  let at = 0; let sequence = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const scheduler: SchedulerPort = { schedule({ delayMs, callback }) { const id = ++sequence; timers.set(id, { due: at + delayMs, callback }); return () => { timers.delete(id); }; } };
  return {
    scheduler, now: () => at, timerCount: () => timers.size,
    advance(ms: number) {
      at += ms;
      for (const [id, timer] of [...timers]) if (timer.due <= at) { timers.delete(id); timer.callback(); }
    },
  };
}
const emission: SurfaceEmission = { channel: 'mcp-ui', payload: {} };
test('opening without a live emitter fails before allocating an ID or timers', () => {
  const time = clock();
  let ids = 0;
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => String(++ids) }, defaultChannel: 'mcp-ui' });
  expect(() => store.open({ binding: { toolId: 't', principalId: 'p' }, emit: undefined as unknown as Parameters<typeof store.open>[0]['emit'] })).toThrow('surface exchange requires an emitter');
  expect(ids).toBe(0); expect(time.timerCount()).toBe(0); expect(store.size()).toBe(0);
});
test('the rendered deadline follows activity but never exceeds the lifetime ceiling', async () => {
  const time = clock();
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => 'deadline' }, defaultChannel: 'mcp-ui' }, { idleTtlMs: 10, maxLifetimeMs: 25 });
  const exchange = store.open({ binding: { toolId: 't', principalId: 'p' }, emit: async () => {} });
  expect(exchange.expiresAtMs()).toBe(10);
  time.advance(5); await exchange.send({ emission }); expect(exchange.expiresAtMs()).toBe(15);
  time.advance(5);
  expect(store.deliver({ exchangeId: exchange.id, principalId: 'p', params: {} }, { toolId: 't' })).toEqual({ ok: true });
  expect(await exchange.receive({})).toEqual({ status: 'received', params: {} });
  expect(exchange.expiresAtMs()).toBe(20);
  time.advance(9); await exchange.send({ emission }); expect(exchange.expiresAtMs()).toBe(25);
  time.advance(6); expect(await exchange.receive({})).toEqual({ status: 'expired' });
  expect(time.timerCount()).toBe(0); expect(store.size()).toBe(0);
});
test('answers buffered before closing precede the terminal result without reopening delivery', async () => {
  const time = clock();
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => 'buffered' }, defaultChannel: 'mcp-ui' });
  const exchange = store.open({ binding: { toolId: 't', principalId: 'p' }, emit: async () => {} });
  store.deliver({ exchangeId: exchange.id, principalId: 'p', params: { turn: 1 } }, { toolId: 't' });
  store.deliver({ exchangeId: exchange.id, principalId: 'p', params: { turn: 2 } }, { toolId: 't' });
  exchange.close({});
  expect(store.deliver({ exchangeId: exchange.id, principalId: 'p', params: { turn: 3 } }, { toolId: 't' })).toEqual({ ok: false, reason: 'unknown-or-closed' });
  expect(await exchange.receive({})).toEqual({ status: 'received', params: { turn: 1 } });
  expect(await exchange.receive({})).toEqual({ status: 'received', params: { turn: 2 } });
  expect(await exchange.receive({})).toEqual({ status: 'abandoned' });
  expect(time.timerCount()).toBe(0); expect(store.size()).toBe(0);
});
test('injected timers settle all waiters and clean up both deadlines', async () => {
  const time = clock();
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => 'id' }, defaultChannel: 'form' }, { idleTtlMs: 10, maxLifetimeMs: 40 });
  const exchange = store.open({ binding: { toolId: 't', principalId: 'p' }, emit: async () => {} });
  const one = exchange.receive({}); const two = exchange.receive({});
  time.advance(10);
  expect(await one).toEqual({ status: 'expired' }); expect(await two).toEqual({ status: 'expired' });
  expect(time.timerCount()).toBe(0); expect(store.size()).toBe(0);
});
test('caller channel policy rejects mismatches and duplicate identifiers never replace a live exchange', async () => {
  const time = clock();
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => 'id' }, defaultChannel: 'custom' });
  const exchange = store.open({ binding: { toolId: 't', principalId: 'p' }, emit: async () => {} });
  expect(store.deliver({ exchangeId: 'id', principalId: 'p', params: {} }, { channel: 'mcp-ui' })).toEqual({ ok: false, reason: 'binding-mismatch' });
  expect(() => store.open({ binding: { toolId: 'other', principalId: 'p' }, emit: async () => {} })).toThrow(/unique/);
  expect(store.deliver({ exchangeId: 'id', principalId: 'p', params: { answer: 7 } })).toEqual({ ok: true });
  expect(await exchange.receive({})).toEqual({ status: 'received', params: { answer: 7 } });
  exchange.close({}); expect(time.timerCount()).toBe(0);
});
test('a failed initial emission releases the held exchange', async () => {
  const time = clock();
  const store = createSurfaceExchangeStore({ scheduler: time.scheduler, clock: { nowMs: time.now }, idGenerator: { newId: () => 'id' }, defaultChannel: 'custom' });
  const exchange = store.open({ binding: { toolId: 't', principalId: 'p' }, emit: async () => { throw new Error('disconnected'); } });
  await expect(askOnce({ exchange, emission })).rejects.toThrow('disconnected');
  expect(store.size()).toBe(0); expect(time.timerCount()).toBe(0);
});
test('agent capabilities are injected and unknown agents fail closed', () => {
  const agents = { lookup: ({ agentId }: { agentId: string }) => agentId === 'custom' ? { resumesSessionViaCli: true } : agentId === 'capture' ? { resumesSessionViaCli: true, capturesSessionIdFromStream: true } : undefined };
  expect(agentAcceptsHostMintedSessionId({ agentId: 'custom', agents })).toBe(true);
  expect(agentAcceptsHostMintedSessionId({ agentId: 'capture', agents })).toBe(false);
  expect(agentCarriesOwnMemory({ agentId: 'capture', agents })).toBe(true);
  expect(agentAcceptsHostMintedSessionId({ agentId: 'missing', agents })).toBe(false);
  expect(agentCarriesOwnMemory({ agentId: 'missing', agents })).toBe(false);
});
test('moving a live registration cannot leave a phantom concurrent run', () => {
  const tracker = createLiveRunTracker({});
  tracker.register({ conversationId: 'old', runId: 'r' }); tracker.register({ conversationId: 'new', runId: 'r' });
  expect(tracker.concurrentLiveRunIds({ conversationId: 'old', runId: 'other' })).toEqual([]);
  expect(tracker.conversationIdForRun({ runId: 'r' })).toBe('new');
});
test('stopping-run lookup failure cancels the injected deadline', async () => {
  const time = clock(); const tracker = createLiveRunTracker({}); tracker.register({ conversationId: 'c', runId: 'old' });
  const lifecycle = { onCancelRequested: ({ listener: callback }: Parameters<import("../session-coordination.js").StoppingRunLifecycle["onCancelRequested"]>[0]) => { callback(); return () => {}; }, waitForTerminal: () => { throw new Error('lookup'); } };
  await expect(waitForStoppingRuns({ tracker, lifecycle, scheduler: time.scheduler, conversationId: 'c', runId: 'new' })).rejects.toThrow('lookup');
  expect(time.timerCount()).toBe(0);
});
test('synchronous sink and reporter failures cannot change an executor result or a catalog call', async () => {
  const result: ToolExecutionResult = { executionId: 'e', status: 'completed', output: 7 };
  const inner: ToolExecutor = { execute: async () => result, resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null };
  const sink = { append: () => { throw new Error('sink'); } };
  const options = { onSinkError: () => { throw new Error('reporter'); } };
  const deps = { sink, now: () => '2026-10-01T00:00:00Z', newAttemptId: () => 'a' };
  const executor = withToolAttemptAudit({ ...deps, inner, workspaceId: 'w', readErrorId: () => undefined }, options);
  expect(await executor.execute({ principal: { id: 'p' }, run: { id: 'r' }, toolId: 't', input: {} })).toBe(result);
  expect(() => appendToolCatalogAttempt({ ...deps, event: { workspaceId: 'w', runId: 'r', principalId: 'p', toolId: 'search', detail: '{}' } }, options)).not.toThrow();
  await Promise.resolve();
});
