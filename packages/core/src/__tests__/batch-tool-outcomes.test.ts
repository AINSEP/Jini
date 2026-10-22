import { expect, test, vi } from 'vitest';
import { batchOutcomeFor, withBatchInput, ToolInputError, type ToolExecutionContext, type ToolRegistration } from '../index.js';

const registration: ToolRegistration = {
  descriptor: { id: 'edit', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  policy: { authorize: () => 'allow' }, handler: async () => undefined,
};
const ctx: ToolExecutionContext = { executionId: 'e', principal: { id: 'p' }, run: { id: 'r' }, signal: new AbortController().signal, input: {} };

test.each([
  { paths: ['good', 'bad', 'good'], outcome: 'partial_failure', succeeded: 2 },
  { paths: ['bad', 'bad'], outcome: 'error', succeeded: 0 },
  { paths: ['good'], outcome: 'completed', succeeded: 1 },
])('batch reports $outcome and keeps every item', async ({ paths, outcome, succeeded }) => {
  const invokeTool = vi.fn(async ({ input }: { input: unknown }) => {
    if ((input as { path: string }).path === 'bad') throw new ToolInputError({ message: 'missing path' });
    return { edited: true };
  });
  const wrapped = withBatchInput({ registration, tool: { toolId: 'edit' } });
  const result = await wrapped.handler({ ...ctx, input: { items: paths.map(path => ({ path })) } }, { invokeTool });
  expect(result).toMatchObject({ outcome, total: paths.length, succeeded, failed: paths.length - succeeded });
  expect((result as { results: unknown[] }).results).toHaveLength(paths.length);
  expect(invokeTool).toHaveBeenCalledTimes(paths.length);
  expect(batchOutcomeFor({ output: result })).toBe(outcome);
  if (outcome === 'error') expect(result).toHaveProperty('isError', true);
});

test('a returned MCP error counts as failed and retains the error payload', async () => {
  const failure = { isError: true, content: [{ type: 'text', text: 'refused' }] };
  const wrapped = withBatchInput({ registration, tool: { toolId: 'edit' } });
  const result = await wrapped.handler({ ...ctx, input: { items: [{ path: 'a' }] } }, { invokeTool: async () => failure });
  expect(result).toMatchObject({ outcome: 'error', failed: 1, results: [{ index: 0, ok: false, result: failure }] });
});

test('legacy shared fields expand before the gated invocation, with item overrides', async () => {
  const wrapped = withBatchInput({ registration, tool: { toolId: 'edit' } });
  const invokeTool = vi.fn(async (_required: { toolId: string; input: unknown }) => 'edited');
  await wrapped.handler({ ...ctx, input: { path: 'shared', items: [{}, { path: 'own' }] } }, { invokeTool });
  expect(invokeTool.mock.calls.map(call => call[0])).toEqual([
    { toolId: 'edit', input: { path: 'shared' } }, { toolId: 'edit', input: { path: 'own' } },
  ]);
  expect(wrapped.descriptor.description).toContain('Canonical shape');
  expect(wrapped.descriptor.description).toContain('Legacy shared top-level fields');
});
