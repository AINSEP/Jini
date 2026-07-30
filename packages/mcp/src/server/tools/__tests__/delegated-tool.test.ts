import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ postDaemonJson: vi.fn() }));
const { postDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import { createExecuteDelegatedToolTool } from '../delegated-tool.js';
import type { McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

beforeEach(() => {
  postDaemonJson.mockReset();
});

describe('createExecuteDelegatedToolTool', () => {
  it('declares the execute_delegated_tool name, schema, and write annotations', () => {
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' });
    expect(tool.name).toBe('execute_delegated_tool');
    expect(tool.inputSchema).toMatchObject({ type: 'object', required: ['toolId'] });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, title: 'Execute a Jini-registered tool' });
  });

  it('types the input property as an object, so a client does not deliver the model\'s object as a JSON string', () => {
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' });
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.input).toMatchObject({ type: 'object', additionalProperties: true });
  });

  it('requires toolId', async () => {
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' });
    await expect(tool.handler({}, ctx)).rejects.toThrow('toolId is required (string).');
    expect(postDaemonJson).not.toHaveBeenCalled();
  });

  it('posts {runId, toolUseId, toolId, input} to /api/delegated-tool-calls, closing over the constructor-supplied runId', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed', output: 'ok' } });
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1', generateToolUseId: () => 'tu-1' });
    const result = await tool.handler({ toolId: 'weather.get', input: { city: 'nyc' } }, ctx);
    expect(postDaemonJson).toHaveBeenCalledWith(
      'http://d.example',
      '/api/delegated-tool-calls',
      { runId: 'run-1', toolUseId: 'tu-1', toolId: 'weather.get', input: { city: 'nyc' } },
      { fetchImpl: ctx.fetchImpl },
    );
    expect(result).toEqual({ executionId: 'e1', status: 'completed', output: 'ok' });
  });

  it('generates a fresh toolUseId per call via the default randomUUID generator when none is injected', async () => {
    postDaemonJson.mockResolvedValue({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' });
    await tool.handler({ toolId: 't1' }, ctx);
    await tool.handler({ toolId: 't1' }, ctx);
    const bodyA = (postDaemonJson.mock.calls[0] as unknown[])[2] as { toolUseId: string };
    const bodyB = (postDaemonJson.mock.calls[1] as unknown[])[2] as { toolUseId: string };
    expect(bodyA.toolUseId).toEqual(expect.any(String));
    expect(bodyA.toolUseId.length).toBeGreaterThan(0);
    expect(bodyA.toolUseId).not.toBe(bodyB.toolUseId);
  });

  it('passes input: undefined through when the caller omits it', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1', generateToolUseId: () => 'tu-2' });
    await tool.handler({ toolId: 't1' }, ctx);
    expect(postDaemonJson).toHaveBeenCalledWith(
      'http://d.example',
      '/api/delegated-tool-calls',
      { runId: 'run-1', toolUseId: 'tu-2', toolId: 't1', input: undefined },
      { fetchImpl: ctx.fetchImpl },
    );
  });

  it('two tool instances scoped to different runIds send different runId bodies', async () => {
    postDaemonJson.mockResolvedValue({ result: { executionId: 'e1', status: 'completed' } });
    const toolA = createExecuteDelegatedToolTool({ runId: 'run-a', generateToolUseId: () => 'tu' });
    const toolB = createExecuteDelegatedToolTool({ runId: 'run-b', generateToolUseId: () => 'tu' });
    await toolA.handler({ toolId: 't1' }, ctx);
    await toolB.handler({ toolId: 't1' }, ctx);
    expect((postDaemonJson.mock.calls[0] as unknown[])[2]).toMatchObject({ runId: 'run-a' });
    expect((postDaemonJson.mock.calls[1] as unknown[])[2]).toMatchObject({ runId: 'run-b' });
  });

  it('surfaces the result envelope unchanged, including a non-completed status (e.g. denied)', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'denied' } });
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' });
    const result = await tool.handler({ toolId: 't1' }, ctx);
    expect(result).toEqual({ executionId: 'e1', status: 'denied' });
  });
});
