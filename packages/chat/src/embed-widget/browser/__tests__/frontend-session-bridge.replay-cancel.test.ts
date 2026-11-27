/** T0-6 (AG-UI design S0): the two safety properties the frontend-tool runner inherits when the
 * invocation half of this bridge moves (design S4).
 * - bridge-replay: an executed invocation id is never executed twice.
 * - bridge-cancel: a `cancelled` frame that arrives while the action is still queued prevents the effect. */
import { expect, it, vi } from 'vitest';
import type { PageDriver } from '@jini-ai/agentic';
import { createDriverPagePort } from '@jini-ai/agentic/dom';
import { createFrontendSessionBridge } from '../frontend-session-bridge.js';

function pageBridge({ click }: { click: (...args: unknown[]) => Promise<void> }, extra: Omit<NonNullable<Parameters<typeof createFrontendSessionBridge>[1]>, 'page'> = {}) {
  const sources: EventTarget[] = [];
  const bodies: unknown[] = [];
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{"settled":true}');
  });
  const bridge = createFrontendSessionBridge({ baseUrl: '', fetch: send as unknown as typeof fetch,
    openStream: () => {
      const source = new EventTarget(); sources.push(source);
      return { addEventListener: source.addEventListener.bind(source) as EventSource['addEventListener'], close() {} };
    },
  }, { ...extra, page: createDriverPagePort({ driver: { click, findElements: async () => [] } as unknown as PageDriver }) });
  const frame = (data: unknown) => sources[0]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  return { bridge, frame, bodies, send };
}

it('bridge-replay: a redelivered invocation id is answered with an error and its effect runs once', async () => {
  const click = vi.fn(async () => {});
  const { bridge, frame, bodies, send } = pageBridge({ click });
  frame({ type: 'attached', sessionId: 's', bindToken: 't' });
  await bridge.ready;
  const invocation = { type: 'invocation', invocationId: 'inv-1', capabilityId: 'page.click', input: { handle: 'save' } };
  frame(invocation);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  frame(invocation);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(click).toHaveBeenCalledTimes(1);
  expect(bodies[0]).toMatchObject({ ok: true });
  expect(bodies[1]).toMatchObject({ ok: false, message: 'already executed on this surface' });
  bridge.close();
});

it('bridge-cancel: a cancelled frame for a queued action prevents its effect', async () => {
  let releaseFirst!: () => void;
  const clicked: unknown[] = [];
  const click = vi.fn(async (...args: unknown[]) => {
    clicked.push(args[0]);
    if (clicked.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
  });
  const { bridge, frame, send } = pageBridge({ click });
  frame({ type: 'attached', sessionId: 's', bindToken: 't' });
  await bridge.ready;
  frame({ type: 'invocation', invocationId: 'first', capabilityId: 'page.click', input: { handle: 'one' } });
  await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  frame({ type: 'invocation', invocationId: 'second', capabilityId: 'page.click', input: { handle: 'two' } });
  frame({ type: 'cancelled', invocationId: 'second' });
  releaseFirst();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(click).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  bridge.close();
});

it('bridge-claims: an invocation for a capability this surface did not claim is refused without running or announcing it', async () => {
  const click = vi.fn(async () => {});
  const onInvocation = vi.fn();
  const { bridge, frame, bodies, send } = pageBridge({ click }, { capabilityIds: ['page.scrollTo'], onInvocation });
  frame({ type: 'attached', sessionId: 's', bindToken: 't' });
  await bridge.ready;
  frame({ type: 'invocation', invocationId: 'inv-unclaimed', capabilityId: 'page.click', input: { handle: 'save' } });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(bodies[0]).toMatchObject({ ok: false, message: 'Capability unavailable' });
  expect(click).not.toHaveBeenCalled();
  expect(onInvocation).not.toHaveBeenCalled();
});
