import { expect, test, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { createFrontendSessionRegistry, type FrontendInvocation } from '../frontend-session-registry.js';
import { createFrontendCapabilityRegistrations } from '../frontend-capability-tools.js';
import { createToolExecutor } from '../tool-executor.js';
import { createAgUiTranslationState, translateAgentEventToAgUi } from '@jini-ai/chat/core/ag-ui';

const owner = { workspaceId: 'workspace', principalId: 'owner', tabId: 'tab' };

function fixture() {
  const delivered: FrontendInvocation[] = [];
  const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'invocation' });
  const handle = registry.attach({ descriptor: { sessionId: 'session', owner, capabilities: ['page.click'] },
    deliver: invocation => { delivered.push(invocation); } });
  registry.bindRunByToken({ runId: 'run', bindToken: handle.bindToken, owner });
  return { registry, handle, delivered };
}

test('a refused tool never delivers an executable call to a client acting on TOOL_CALL_END', async () => {
  const { registry, handle, delivered } = fixture();
  const tools = createToolRegistry({});
  for (const registration of createFrontendCapabilityRegistrations({ registry, capabilities: [{ id: 'page.click', description: 'Activate control' }] })) tools.register(registration);
  const state = createAgUiTranslationState({ ids: { next: ({ prefix, ordinal }) => `${prefix}-${ordinal}` },
    customEventNames: { usage: 'usage', status: 'status', extensionPrefix: 'ext.' } });
  const events = translateAgentEventToAgUi({ event: { kind: 'tool_use', id: 'model-call', name: 'page.click', input: {} }, state });
  const act = vi.fn();
  for (const event of events) {
    if (event.type === 'TOOL_CALL_END' && handle.begin({ runId: 'run', invocationId: event.toolCallId })) act();
  }
  const result = await createToolExecutor({ registry: tools }).execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'page.click', input: {} });
  expect(result.status).toBe('denied');
  expect(delivered).toEqual([]);
  expect(act).not.toHaveBeenCalled();
  expect(handle.begin({ runId: 'run', invocationId: 'model-call' })).toBe(false);
});

test('a delivered live invocation can begin once before its acknowledgment', async () => {
  const { registry, handle, delivered } = fixture();
  const pending = registry.invoke({ runId: 'run', capabilityId: 'page.click', input: { element: 'save' } });
  expect(delivered).toEqual([{ invocationId: 'invocation', capabilityId: 'page.click', input: { element: 'save' } }]);
  expect(handle.begin({ runId: 'run', invocationId: 'invocation' })).toBe(true);
  expect(handle.begin({ runId: 'run', invocationId: 'invocation' })).toBe(false);
  expect(registry.settle({ sessionId: 'session', invocationId: 'invocation', outcome: { ok: true, output: 'done' } })).toBe(true);
  await expect(pending).resolves.toBe('done');
  expect(handle.begin({ runId: 'run', invocationId: 'invocation' })).toBe(false);
});

test('foreign owner, wrong run and wrong invocation cannot consume a delivered call', async () => {
  const { registry, handle } = fixture();
  const pending = registry.invoke({ runId: 'run', capabilityId: 'page.click', input: {} });
  expect(registry.begin({ runId: 'run', invocationId: 'invocation', owner: { ...owner, principalId: 'foreign' } })).toBe(false);
  expect(registry.begin({ runId: 'other-run', invocationId: 'invocation', owner })).toBe(false);
  expect(handle.begin({ runId: 'run', invocationId: 'page.click' })).toBe(false);
  expect(registry.begin({ runId: 'run', invocationId: 'invocation', owner })).toBe(true);
  expect(registry.begin({ runId: 'run', invocationId: 'invocation', owner })).toBe(false);
  registry.settle({ sessionId: 'session', invocationId: 'invocation', outcome: { ok: true, output: null } });
  await pending;
});

test('cancel before begin denies permission to act', async () => {
  const { registry, handle } = fixture();
  const controller = new AbortController();
  const pending = registry.invoke({ runId: 'run', capabilityId: 'page.click', input: {} }, { signal: controller.signal });
  controller.abort();
  expect(handle.begin({ runId: 'run', invocationId: 'invocation' })).toBe(false);
  await expect(pending).rejects.toThrow('cancelled before the frontend answered');
});

test('executor timeout before begin denies permission to act', async () => {
  vi.useFakeTimers();
  try {
    const { registry, handle, delivered } = fixture();
    const tools = createToolRegistry({});
    for (const registration of createFrontendCapabilityRegistrations({ registry, capabilities: [{ id: 'page.click', description: 'Activate control' }] },
      { policy: { authorize: () => 'allow' }, timeoutMs: 5 })) tools.register(registration);
    const pending = createToolExecutor({ registry: tools }).execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'page.click', input: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(delivered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5);
    expect((await pending).status).toBe('timed-out');
    expect(handle.begin({ runId: 'run', invocationId: 'invocation' })).toBe(false);
  } finally { vi.useRealTimers(); }
});
