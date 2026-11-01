import { describe, expect, it, vi } from 'vitest';
import { withBatchInput } from '../batch-tool-inputs.js';
import { ToolInputError } from '../tool-input-errors.js';
import { authorizeToolInvocation, createToolRegistry, type ToolExecutionContext } from '../tool-registry.js';

const inputSchema = { type: 'object', additionalProperties: false, required: ['themeId', 'path', 'version'], properties: {
  themeId: { type: 'string' }, path: { type: 'string' }, version: { type: 'integer' }, optional: { type: 'boolean' },
} };

function setup(mode: 'items' | 'plan') {
  const registry = createToolRegistry({});
  const handler = vi.fn(async ({ input }: ToolExecutionContext) => {
    // Reproduce handlers that report only the first missing input after MCP accepts {}.
    if (!(input as Record<string, unknown>).themeId) throw new ToolInputError({ message: "'themeId' (non-empty string) is required" });
    return input;
  });
  const authorize = vi.fn(() => 'allow' as const);
  const registration = withBatchInput({ registration: { descriptor: { id: 'read_file', inputSchema }, handler, policy: { authorize } }, tool: { toolId: 'read_file' } }, { mode });
  registry.register(registration);
  const invoke = async (input: unknown) => {
    const principal = { id: 'owner' };
    const run = { id: 'run' };
    const admitted = await authorizeToolInvocation({ registry, toolId: 'read_file', principal, run, input });
    if (!admitted || admitted.decision !== 'allow') throw new Error('authorization refused');
    return admitted.handler({ executionId: 'execution', principal, run, input: admitted.input, signal: new AbortController().signal });
  };
  return { invoke, handler, authorize, registration };
}

describe.each(['items', 'plan'] as const)('batched %s dispatch required inputs', mode => {
  it.each([{}, { theme_id: 'theme' }])('reports every required name and type in one error for %j before policy or handler', async input => {
    const { invoke, handler, authorize, registration } = setup(mode);
    expect(registration.descriptor.inputSchema).not.toHaveProperty('required');
    await expect(invoke(input)).rejects.toThrow(/Required inputs: themeId \(string\), path \(string\), version \(integer\)/);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('labels a type list and an undeclared type in the same one error', async () => {
    const schema = { type: 'object', required: ['limit', 'anything'], properties: { limit: { type: ['integer', 'null'] }, anything: {} } };
    const registry = createToolRegistry({});
    const handler = vi.fn(async () => 'ran');
    registry.register(withBatchInput({ registration: { descriptor: { id: 'list_rows', inputSchema: schema }, handler, policy: { authorize: () => 'allow' } }, tool: { toolId: 'list_rows' } }, { mode }));
    await expect(authorizeToolInvocation({ registry, toolId: 'list_rows', principal: { id: 'owner' }, run: { id: 'run' }, input: {} }))
      .rejects.toThrow('list_rows: missing required inputs: limit, anything. Required inputs: limit (integer | null), anything (unknown).');
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts complete inputs after spelling and scalar normalization', async () => {
    const { invoke, authorize } = setup(mode);
    const output = await invoke({ theme_id: 'theme', path: 'index.html', version: '2' });
    expect(output).toEqual({ themeId: 'theme', path: 'index.html', version: 2 });
    expect(authorize).toHaveBeenCalledOnce();
  });
});
