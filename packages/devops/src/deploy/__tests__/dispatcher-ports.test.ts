import { MockAgent } from 'undici';
import { expect, it, vi } from 'vitest';
import { createNodeReachabilityPorts } from '../node.js';

// hwb #24: host dispatcher identity reaches fetch and its lifecycle remains host-owned.
it('uses the injected dispatcher and does not close it when ports are disposed', async () => {
  const dispatcher = new MockAgent();
  const closeDispatcher = vi.spyOn(dispatcher, 'close');
  let actual: unknown;
  const ports = createNodeReachabilityPorts({}, { dispatcher, fetch: async (_url, init) => { actual = Reflect.get(init!, 'dispatcher'); return new Response(); } });
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
  const a = createNodeReachabilityPorts({}, { fetch: fetchPort }); const b = createNodeReachabilityPorts({}, { fetch: fetchPort });
  try {
    await a.fetch({ url: 'https://example.test' }); await a.fetch({ url: 'https://example.test' }); await b.fetch({ url: 'https://example.test' });
    expect(captured[0]).toBe(captured[1]);
    expect(captured[0]).not.toBe(captured[2]);
  } finally { await a.close(); await b.close(); }
});
