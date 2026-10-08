import { describe, expect, it } from 'vitest';
import { createMemoryRedirectsApi } from '../adapters/memory.js';
import { runRedirectsApiConformance } from '../conformance/redirects-api.conformance.js';
describe('redirects memory adapter', () => {
  it('passes the core API conformance including partial-batch rejection', async () => {
    const checks = await runRedirectsApiConformance({ api: createMemoryRedirectsApi({}, {}) }, {});
    expect(checks).toContain('middle failure preserves both successful siblings');
    expect(checks).toContain('soft deletion retains the rule');
    expect(checks).toContain('missing hits differs from zero hits');
    const alternateChecks = await runRedirectsApiConformance(
      { api: createMemoryRedirectsApi({}, { validate: () => {} }) },
      { referenceRegexRejection: false },
    );
    expect(alternateChecks).toContain('valid import batch succeeds');
  });
});
