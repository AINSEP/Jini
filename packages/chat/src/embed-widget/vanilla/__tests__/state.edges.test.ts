import { describe, expect, it } from 'vitest';
import type { ChatTransport, RunHandlers } from '../../../core/transport.js';
import type { AgentEvent } from '../../../core/events.js';
import { createVanillaChatController } from '../state.js';

function controllerWith({ startRun, blockedPaths }: { startRun?: ChatTransport['startRun']; blockedPaths: Set<string> }) {
  let handlers: RunHandlers | null = null;
  const writes: string[] = [];
  let serial = 0;
  const controller = createVanillaChatController({ agentId: 'visitor', directiveEventName: 'client_directive',
    ids: () => String(++serial), createAbortController: () => new AbortController(), onChange: () => {},
    session: { load: () => ({ open: true, messages: [] }), save: () => {}, clear: () => {}, enqueue: () => { writes.push('enqueue'); }, drain: () => null },
    pageActions: { allows: ({ action }) => !blockedPaths.has(action.target.path), navigate: () => { writes.push('navigate'); return true; },
      execute: () => true, clearHighlight: () => {} },
    transport: { startRun: startRun ?? (async (_input, callbacks) => { handlers = callbacks; return { runId: 'run' }; }),
      async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {} },
  });
  return { controller, writes, callbacks: () => handlers! };
}
const directive = (type: 'navigate' | 'highlight', path: string): AgentEvent => ({
  kind: 'ext', name: 'client_directive', data: { kind: 'page_action', action: { type, auto: false, target: { slug: 's', title: 'T', path } } },
});

describe('vanilla chat controller edges', () => {
  it('re-checks a bundled treatment at consent time and drops it if the host now refuses it', async () => {
    const blocked = new Set<string>();
    const f = controllerWith({ blockedPaths: blocked });
    await f.controller.send({ text: 'Show pricing' });
    f.callbacks().onDone([directive('navigate', '/pricing'), directive('highlight', '/pricing#plans')]);
    blocked.add('/pricing#plans');
    f.controller.acceptProposal({});
    expect(f.writes).toEqual(['navigate']);
  });

  it('never navigates when the host refuses the target by the time the visitor consents', async () => {
    const blocked = new Set<string>();
    const f = controllerWith({ blockedPaths: blocked });
    await f.controller.send({ text: 'Go' });
    f.callbacks().onDone([directive('navigate', '/admin')]);
    blocked.add('/admin');
    f.controller.acceptProposal({});
    expect(f.writes).toEqual([]);
    expect(f.controller.getState({}).proposal).not.toBeNull();
  });

  it('disposes cleanly when no run is in flight', () => {
    const f = controllerWith({ blockedPaths: new Set() });
    expect(() => f.controller.dispose({})).not.toThrow();
    expect(f.controller.getState({}).busy).toBe(false);
  });

  it('aborts the in-flight run on dispose and ignores its late completion', async () => {
    let signal: AbortSignal | undefined;
    let callbacks!: RunHandlers;
    const f = controllerWith({ blockedPaths: new Set(), startRun: async (input, handlers) => { signal = input.signal; callbacks = handlers; return { runId: 'r' }; } });
    await f.controller.send({ text: 'Go' });
    f.controller.dispose({});
    expect(signal?.aborted).toBe(true);
    callbacks.onDone([directive('navigate', '/x')]);
    expect(f.controller.getState({}).proposal).toBeNull();
  });

  it('keeps a reply failed when output still streams in after an error', async () => {
    const f = controllerWith({ blockedPaths: new Set() });
    await f.controller.send({ text: 'hi' });
    f.callbacks().onError(new Error('upstream'));
    f.callbacks().onEvent({ kind: 'text', text: 'late' });
    expect(f.controller.getState({}).messages.at(-1)).toMatchObject({ runStatus: 'failed', content: 'late' });
  });

  it('ignores an error from a run the visitor already reset away from', async () => {
    const f = controllerWith({ blockedPaths: new Set() });
    await f.controller.send({ text: 'hi' });
    f.controller.reset({});
    f.callbacks().onError(new Error('stale'));
    expect(f.controller.getState({})).toMatchObject({ error: null, messages: [] });
  });

  it('reports a start that rejects with a non-Error value as text', async () => {
    const f = controllerWith({ blockedPaths: new Set(), startRun: async () => { throw 'gateway down'; } });
    await f.controller.send({ text: 'hi' });
    expect(f.controller.getState({})).toMatchObject({ busy: false, error: 'gateway down' });
  });
});
