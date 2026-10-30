import { describe, expect, it, vi } from 'vitest';
import { createApprovalHandler, createToolRegistry, type ApprovalAnswer } from '@jini-ai/core';
import { createDelegatedToolBridge } from '../../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createToolExecutor } from '../../tool-executor.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function setup() {
  const registry = createToolRegistry({});
  const answer = deferred<ApprovalAnswer>();
  const shown = deferred<void>();
  const publish = vi.fn(async () => ({ published: true, started: true }));
  const write = vi.fn(async () => ({ saved: true }));
  registry.register({
    descriptor: { id: 'deployment_execute_static_publish', readOnly: false },
    policy: { authorize: () => 'allow' },
    handler: createApprovalHandler({
      prepare: async () => ({}),
      describe: () => ({ ask: true, description: 'Publish zoran-new' }),
      askHuman: async (_required, { emitSurface } = {}) => {
        await emitSurface!({ channel: 'mcp-ui', payload: { resource: {
          type: 'resource', resource: { uri: 'ui://confirm/publish', mimeType: 'text/html', text: '<button>Confirm</button>' },
        } } });
        shown.resolve();
        return answer.promise;
      },
      run: publish,
      notConfirmed: ({ reason }) => ({ published: false, reason }),
    }),
  });
  registry.register({ descriptor: { id: 'credential_save' }, policy: { authorize: () => 'allow' }, handler: write });
  registry.register({ descriptor: { id: 'check_messages', readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => ({ messages: [] }) });
  const toolExecutor = createToolExecutor({ registry });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'approval-regression' });
  // Each HTTP request creates its own bridge; the executor must own the shared wait state.
  const call = (toolId: string, toolUseId: string, runId = run.id, signal?: AbortSignal) =>
    createDelegatedToolBridge({ lifecycle, toolExecutor }).execute({ runId, toolUseId, toolId, principal: { id: 'owner' }, input: {} }, signal ? { signal } : {});
  return { answer, shown, publish, write, call, lifecycle, run, toolExecutor };
}

describe('s1: approval pending across concurrent delegated calls', () => {
  it('refuses another write while the Confirm card is open, permits reads and other runs, then permits writes after confirm', async () => {
    const h = await setup();
    const pending = h.call('deployment_execute_static_publish', 'publish');
    await h.shown.promise;
    try {
      const refused = await h.call('credential_save', 'parallel-write');
      expect(refused.status).toBe('failed');
      expect(refused.errorKind).toBe('validation');
      expect(JSON.parse(refused.error!)).toMatchObject({ status: 'awaiting_approval', started: false, pendingToolId: 'deployment_execute_static_publish' });
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.write).not.toHaveBeenCalled();
      expect((await h.call('check_messages', 'read')).output).toEqual({ messages: [] });
      const other = await h.lifecycle.start({ contextRef: 'another-conversation' });
      expect((await h.call('credential_save', 'other-run', other.run.id)).status).toBe('completed');
    } finally {
      h.answer.resolve({ confirmed: true });
      await pending;
    }
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect((await h.call('credential_save', 'after-confirm')).status).toBe('completed');
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it.each(['deny', 'abort', 'transport-failure'] as const)('releases the write block after %s without publishing', async (ending) => {
    const h = await setup();
    const controller = new AbortController();
    const pending = h.call('deployment_execute_static_publish', 'publish', h.run.id, controller.signal);
    await h.shown.promise;
    try {
      expect((await h.call('credential_save', 'parallel-write')).status).toBe('failed');
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      if (ending === 'abort') controller.abort();
      else if (ending === 'transport-failure') h.answer.reject(new Error('confirmation transport disconnected'));
      else h.answer.resolve({ confirmed: false, reason: 'declined' });
      await pending;
    }
    expect(h.publish).not.toHaveBeenCalled();
    expect((await h.call('credential_save', 'after-close')).status).toBe('completed');
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('also blocks writes for the executor native confirmation gate', async () => {
    const registry = createToolRegistry({});
    const asked = deferred<string>();
    const publish = vi.fn(async () => ({ started: true }));
    const write = vi.fn(async () => 'saved');
    registry.register({ descriptor: { id: 'publish', requiresConfirmation: true }, policy: { authorize: () => 'allow' }, handler: publish });
    registry.register({ descriptor: { id: 'write' }, policy: { authorize: () => 'allow' }, handler: write });
    const executor = createToolExecutor({ registry }, { delegate: { onConfirm: ({ executionId }) => { asked.resolve(executionId); } } });
    const args = { run: { id: 'run' }, principal: { id: 'owner' }, input: {} };
    const pending = executor.execute({ ...args, toolId: 'publish' });
    const executionId = await asked.promise;
    try {
      const refused = await executor.execute({ ...args, toolId: 'write' });
      expect(refused.status).toBe('failed');
      expect(JSON.parse(refused.error!)).toMatchObject({ status: 'awaiting_approval', started: false, pendingToolId: 'publish' });
      expect(publish).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      executor.resumeConfirmation({ executionId, decision: 'confirm' });
      await pending;
    }
    expect(publish).toHaveBeenCalledTimes(1);
    expect((await executor.execute({ ...args, toolId: 'write' })).status).toBe('completed');
  });

  it('rechecks a write admitted before an approval opened while asynchronous guidance was preparing', async () => {
    const registry = createToolRegistry({});
    const guidance = deferred<string>();
    const preparing = deferred<void>();
    const asked = deferred<void>();
    const answer = deferred<ApprovalAnswer>();
    const write = vi.fn(async () => 'saved');
    registry.register({ descriptor: { id: 'write', metadata: { guidanceCapabilities: ['writer'] } }, policy: { authorize: () => 'allow' }, handler: write });
    registry.register({
      descriptor: { id: 'publish' }, policy: { authorize: () => 'allow' },
      handler: createApprovalHandler({
        prepare: async () => ({}), describe: () => ({ ask: true, description: 'Publish' }),
        askHuman: async () => { asked.resolve(); return answer.promise; },
        run: async () => ({ started: true }), notConfirmed: () => ({ started: false }),
      }),
    });
    const executor = createToolExecutor({ registry }, { prepareGuidance: async () => { preparing.resolve(); return guidance.promise; } });
    const args = { run: { id: 'run' }, principal: { id: 'owner' }, input: {} };
    const delayedWrite = executor.execute({ ...args, toolId: 'write' });
    await preparing.promise;
    const pending = executor.execute({ ...args, toolId: 'publish' });
    await asked.promise;
    try {
      guidance.resolve('Writing instructions');
      const refused = await delayedWrite;
      expect(refused.status).toBe('failed');
      expect(JSON.parse(refused.error!)).toMatchObject({ status: 'awaiting_approval', started: false });
      expect(write).not.toHaveBeenCalled();
    } finally {
      answer.resolve({ confirmed: true });
      await pending;
    }
  });
});
