import { describe, expect, it } from 'vitest';
import { createMemoryRedirectsApi } from '../adapters/memory.js';
import { runRedirectsApiConformance } from '../conformance/redirects-api.conformance.js';
describe('redirects memory adapter', () => {
  it('passes the core API conformance including partial-batch rejection', async () => {
    const checks = await runRedirectsApiConformance({ api: createMemoryRedirectsApi({}, {}) }, {});
    expect(checks).toContain('middle failure preserves both successful siblings');
    expect(checks).toContain('removed rule leaves the list');
    expect(checks).toContain('missing hits differs from zero hits');
    const alternateChecks = await runRedirectsApiConformance(
      { api: createMemoryRedirectsApi({}, { validate: () => {} }) },
      { referenceRegexRejection: false },
    );
    expect(alternateChecks).toContain('valid import batch succeeds');
  });
});

describe('redirects memory adapter — removal is the Trash (Bug B)', () => {
  it('removes a toggled-off rule from the list, keeps a second removal a no-op, and filters by source', async () => {
    const api = createMemoryRedirectsApi({}, {});
    const input = { matchType: 'exact', fromPattern: '/memory-a', toTarget: '/memory-b', statusCode: 301 as const };
    const off = await api.createRedirect(input);
    const kept = await api.createRedirect({ ...input, fromPattern: '/memory-kept' });
    await api.updateRedirect({ id: off.id }, { status: 'disabled' });
    const removed = await api.tombstoneRedirect({ id: off.id });
    expect(await api.tombstoneRedirect({ id: off.id })).toBe(removed);
    expect((await api.listRedirects({})).map(row => row.id)).toEqual([kept.id]);
    expect(await api.listRedirects({}, { source: 'import' })).toEqual([]);
    expect((await api.listRedirects({}, { source: 'manual' })).map(row => row.id)).toEqual([kept.id]);
  });
});
