import { expect, it } from 'vitest';
import { createMemoryFormsApi } from '../adapters/memory.js';
import { runFormsApiConformance } from '../conformance/forms-api.conformance.js';
it('the memory adapter passes the core Forms API conformance contract', async () => {
  const api = createMemoryFormsApi({}, { submissions: [{ id: 's1', formDefinitionId: 'f1', data: { email: 'visitor@example.com', accepted: false }, sourceIp: '127.0.0.1', submittedAt: '2026-10-07T00:00:00Z' }] });
  const result = await runFormsApiConformance({ api }, { submission: { formId: 'f1', submissionId: 's1' } });
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(20);
  // Hiding a record alone could also be hard deletion: inspect retained fixture data explicitly.
  expect(api.submissions).toEqual([{ id: 's1', formDefinitionId: 'f1', data: { email: 'visitor@example.com', accepted: false }, sourceIp: '127.0.0.1', submittedAt: '2026-10-07T00:00:00Z', status: 'trash' }]);
});
