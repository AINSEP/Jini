import { describe, it, expect } from 'vitest';
import { createMemoryWidgetsApi } from '../adapters/memory.js';
import { runWidgetsApiConformance } from '../conformance/widgets-api.conformance.js';
describe('widgets memory adapter', () => {
  it('passes the framework-free API conformance checklist', async () => {
    const checks = await runWidgetsApiConformance({ api: createMemoryWidgetsApi({}) }, {});
    expect(checks).toHaveLength(23);
  });
});
