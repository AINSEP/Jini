import { Agent, MockAgent } from 'undici';
import { expect, it, vi } from 'vitest';
import { createNodeReachabilityPorts } from '../node.js';
import { platformBindings } from './platform-bindings.js';

// hwb #24: host dispatcher identity reaches fetch and its lifecycle remains host-owned.
it('uses the injected dispatcher and does not close it when ports are disposed', async () => {
  const dispatcher = new MockAgent();
  const closeDispatcher = vi.spyOn(dispatcher, 'close');
  let actual: unknown;
  const ports = createNodeReachabilityPorts(platformBindings, { dispatcher, fetch: async (_url, init) => { actual = Reflect.get(init!, 'dispatcher'); return new Response(); } });
  try {
    await ports.fetch({ url: 'https://example.test' });
    expect(actual).toBe(dispatcher);
    await ports.close();
    expect(closeDispatcher).not.toHaveBeenCalled();
    expect(() => ports.guard.assertSafeUrl({ raw: 'https://127.0.0.1', label: 'deployment url' })).toThrow('url points at a private address');
  } finally { closeDispatcher.mockRestore(); await dispatcher.close(); }
});

it('keeps default dispatcher pools per host rather than process-wide', async () => {
  const captured: unknown[] = [];
  const fetchPort: typeof fetch = async (_url, init) => { captured.push(Reflect.get(init!, 'dispatcher')); return new Response(); };
  const a = createNodeReachabilityPorts(platformBindings, { fetch: fetchPort }); const b = createNodeReachabilityPorts(platformBindings, { fetch: fetchPort });
  try {
    await a.fetch({ url: 'https://example.test' }); await a.fetch({ url: 'https://example.test' }); await b.fetch({ url: 'https://example.test' });
    expect(captured[0]).toBe(captured[1]);
    expect(captured[0]).not.toBe(captured[2]);
  } finally { await a.close(); await b.close(); }
});


it('closes its default dispatcher after use', async () => {
  let owned: Agent | undefined;
  const ports = createNodeReachabilityPorts(platformBindings, { fetch: async (_url, init) => {
    const dispatcher: unknown = Reflect.get(init!, 'dispatcher');
    if (!(dispatcher instanceof Agent)) throw new Error('expected owned Agent');
    owned = dispatcher;
    return new Response();
  } });
  await ports.fetch({ url: 'https://example.test' });
  const close = vi.spyOn(owned!, 'close');
  try {
    await ports.close();
    expect(close).toHaveBeenCalledOnce();
  } finally { close.mockRestore(); await owned!.close(); }
});
