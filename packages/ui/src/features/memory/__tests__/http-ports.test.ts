import { expect, it, vi } from 'vitest';
import { createMemoryHttpPorts } from '../dependencies.js';

// REGRESSION: fails if createMemoryHttpPorts bypasses its injected fetch.
it('binds config, entries and extraction requests to the same timed fetch port', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify({ tree: [], extractions: [] }));
  });
  const ports = createMemoryHttpPorts({}, { fetch });
  await ports.config.patchConfig({ enabled: true });
  await expect(ports.entries.fetchMemoryTree()).resolves.toEqual([]);
  await expect(ports.extractions.fetchExtractions()).resolves.toEqual([]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/memory/config', '/api/memory/tree', '/api/memory/extractions']);
});

// PARITY
it('keeps required-field failures visible on an injected memory read', async () => {
  const fetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({ entries: [] }));
  const ports = createMemoryHttpPorts({}, { fetch });
  await expect(ports.entries.fetchMemoryList()).rejects.toThrow("Memory list request succeeded without a 'rootDir' field");
});
