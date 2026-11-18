import { describe, expect, it, vi } from 'vitest';
import { normalizeToolInput } from '../tool-input-normalization.js';
import { createToolRegistry, authorizeToolInvocation } from '../tool-registry.js';
import { withBatchInput } from '../batch-tool-inputs.js';
import type { ToolExecutionContext, ToolHandler, ToolRegistration } from '../tool-registry.js';

const LIMIT = { type: 'integer', minimum: 1, maximum: 8000, clamp: true };
const schemaOf = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties });

describe('the paths that already run the normalizer clamp declared bounds', () => {
  const inputSchema = schemaOf({ path: { type: 'string' }, limit: LIMIT });

  it('normalizeToolInput: a number is clamped with the one note; an integer string gets the coercion note then the clamp note', async () => {
    const registration = { descriptor: { id: 'bounded_tool', inputSchema } };
    expect(await normalizeToolInput({ input: { limit: 8300 }, registration })).toEqual({ input: { limit: 8000 }, notes: ['limit was lowered to its maximum, 8000'] });
    expect(await normalizeToolInput({ input: { limit: '8300' }, registration })).toEqual({ input: { limit: 8000 }, notes: ['limit: string→integer', 'limit was lowered to its maximum, 8000'] });
  });

  it('the registry\'s own execution path (what the gateway reaches) hands the handler the clamped input', async () => {
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'bounded_tool', inputSchema }, policy: { authorize: () => 'allow' }, handler: async () => 'ok' });
    const authorized = await authorizeToolInvocation({ registry, toolId: 'bounded_tool', principal: { id: 'p' }, run: { id: 'r' }, input: { path: 'a', limit: 8300 } });
    expect(authorized).toMatchObject({ decision: 'allow', input: { path: 'a', limit: 8000 }, normalizationNotes: ['limit was lowered to its maximum, 8000'] });
  });

  it('a batch item is clamped before its tool runs', async () => {
    const registration: ToolRegistration = { descriptor: { id: 'bounded_tool', inputSchema: { ...inputSchema, required: ['path'] } }, policy: { authorize: () => 'allow' }, handler: async () => 'single' };
    const wrapped = withBatchInput({ registration, tool: { toolId: 'bounded_tool' } });
    const invokeTool = vi.fn<NonNullable<NonNullable<Parameters<ToolHandler>[1]>['invokeTool']>>(async () => 'done');
    const context = { executionId: 'e', principal: { id: 'p' }, run: { id: 'r' }, signal: new AbortController().signal, input: { items: [{ path: 'a', limit: 8300 }] } } as ToolExecutionContext;
    await wrapped.handler(context, { invokeTool });
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(invokeTool.mock.calls[0]?.[0]).toMatchObject({ toolId: 'bounded_tool', input: { path: 'a', limit: 8000 } });
  });
});
