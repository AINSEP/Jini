import { expect, test, vi } from 'vitest';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { confirmationInterrupt, readConfirmationResume, createAgUiPauseStore } from '../event-projection.js';
import { createAgUiRunClient, type AgUiClient } from '../../assistant-client/ag-ui-transport.js';

const handoff = { owner: 'owner', threadId: 'thread', runId: 'original', interruptId: 'approval', state: { cursor: 7 }, scopeKey: 'guest', abandonAtMs: 100 };
const resume: RunAgentInput = { threadId: 'thread', runId: 'fresh', parentRunId: 'original', state: null, messages: [], tools: [], context: [], forwardedProps: {},
  resume: [{ interruptId: 'approval', status: 'resolved', payload: 'allow' }] };

test.each(['allow', 'deny', 'dismissed'])('reads one matching %s confirmation and treats dismissal as denial', decision => {
  expect(readConfirmationResume({ input: { ...resume, resume: [{ interruptId: 'approval', status: 'resolved', payload: decision }] }, ...handoff }))
    .toEqual({ decision: decision === 'allow' ? 'allow' : 'deny' });
});

test('rejects wrong thread, parent, interrupt, repeated settlement and forwardedProps answers', () => {
  for (const input of [
    { ...resume, threadId: 'foreign' }, { ...resume, parentRunId: 'foreign' },
    { ...resume, resume: [{ interruptId: 'other', status: 'resolved', payload: 'allow' }] },
    { ...resume, resume: [...resume.resume!, ...resume.resume!] },
    { ...resume, resume: [], forwardedProps: { decision: 'allow', interruptId: 'approval' } },
  ]) expect(readConfirmationResume({ input, ...handoff })).toBeUndefined();
  expect(readConfirmationResume({ input: { ...resume, resume: [{ interruptId: 'approval', status: 'cancelled' }] }, ...handoff })).toEqual({ decision: 'deny' });
});

test('rejects a matching resume with an unrecognized resolved payload', () => {
  for (const payload of ['approve', 'ALLOW', { decision: 'allow' }, true, undefined]) {
    expect(readConfirmationResume({ input: { ...resume, resume: [{ interruptId: 'approval', status: 'resolved', payload }] }, ...handoff })).toBeUndefined();
  }
  expect(readConfirmationResume({ input: resume, ...handoff })).toEqual({ decision: 'allow' });
});

test('claims the retained handoff once for its owner and thread', () => {
  const store = createAgUiPauseStore({ caps: { global: 3, perScope: 2 }, nowMs: () => 0 });
  expect(store.park(handoff)).toBe(true);
  expect(store.claim({ ...handoff, owner: 'foreign' })).toBeUndefined();
  expect(store.claim({ ...handoff, threadId: 'foreign' })).toBeUndefined();
  expect(store.claim({ ...handoff, runId: 'foreign' })).toBeUndefined();
  expect(store.claim({ ...handoff, interruptId: 'foreign' })).toBeUndefined();
  expect(store.claim(handoff)).toEqual(handoff);
  expect(store.claim(handoff)).toBeUndefined();
  expect(store.remove({ interruptId: 'approval' })).toBe(false);
});

test('applies global and host scope caps atomically and releases removed or abandoned handoffs', () => {
  let now = 0;
  const store = createAgUiPauseStore({ caps: { global: 2, perScope: 1 }, nowMs: () => now });
  expect(store.park(handoff)).toBe(true);
  expect(store.park({ ...handoff, interruptId: 'same-scope' })).toBe(false);
  expect(store.park({ ...handoff, interruptId: 'other-scope', scopeKey: 'other' })).toBe(true);
  expect(store.park({ ...handoff, interruptId: 'third', scopeKey: 'third' })).toBe(false);
  expect(store.remove({ interruptId: 'other-scope' })).toBe(true);
  expect(store.park({ ...handoff, interruptId: 'third', scopeKey: 'third' })).toBe(true);
  now = 100;
  expect(store.claim(handoff)).toBeUndefined();
  expect(store.park({ ...handoff, interruptId: 'replacement', abandonAtMs: 200 })).toBe(true);
});

test('hands an interrupt to the live consumer before finish and resumes on the same thread with a fresh run', async () => {
  const observers: Parameters<ReturnType<AgUiClient['run']>['subscribe']>[0][] = [];
  const inputs: RunAgentInput[] = [];
  const abortRuns: ReturnType<typeof vi.fn>[] = [];
  let id = 0;
  const order: string[] = [];
  const client = createAgUiRunClient({ ports: { endpoint: '/agent', runIdPrefix: 'ag-', customEventNames: { usage: 'usage', status: 'status', extensionPrefix: 'ext.' },
    mintId: () => String(++id), onLiveEvent: ({ event }) => { expect(EventSchemas.parse(event)).toMatchObject({ outcome: { type: 'interrupt' } }); order.push('interrupt'); return true; },
    createAgent: () => {
      const abortRun = vi.fn();
      abortRuns.push(abortRun);
      return {
        abortController: new AbortController(), abortRun,
        run: input => { inputs.push(input); return { subscribe: observer => { observers.push(observer); } }; },
      };
    } } });
  const handlers = { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn(() => { order.push('done'); }) };
  const event = confirmationInterrupt({ threadId: 'thread', runId: 'ag-1', interrupt: { id: 'approval', reason: 'confirmation', toolCallId: 'tool', message: 'Allow action?' } });
  const started = client.startAgUiRun({ input: { history: [], conversationId: 'thread', signal: new AbortController().signal }, handlers });
  observers[0]!.next(event);
  observers[0]!.complete();
  await started;
  expect(event.type).toBe(EventType.RUN_FINISHED);
  expect(order).toEqual(['interrupt', 'done']);
  expect(handlers.onEvent).not.toHaveBeenCalled();
  expect(handlers.onDone).toHaveBeenCalledOnce();
  expect(handlers.onDone).toHaveBeenCalledWith([]);
  const continued = client.resumeAgUiRun({ input: { history: [], signal: new AbortController().signal }, handlers,
    threadId: 'thread', parentRunId: 'ag-1', resume: [{ interruptId: 'approval', status: 'resolved', payload: 'allow' }] });
  expect(inputs[1]).toMatchObject({ threadId: 'thread', runId: 'ag-2', parentRunId: 'ag-1', resume: resume.resume });
  observers[1]!.complete();
  await expect(continued).rejects.toThrow(/^The assistant stopped before replying\. Send your message again\.$/);
  await client.stopAgUiRun({ runId: 'ag-2' });
  expect(abortRuns[1]).not.toHaveBeenCalled();
});
