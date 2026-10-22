import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolIndex, handleToolCall } from '../../tool-protocol.js';
import type { McpToolDef } from '../../tool-protocol.js';
import { describeToolTool, searchToolsTool } from '../tool-catalog-tools.js';
import { getRunTool } from '../run-tools.js';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from '../delegated-tool.js';

const completed = { status: 'completed', output: 'executed' };
const fetchImpl = vi.fn<typeof fetch>();
const ctx = { baseUrl: 'http://daemon.example', fetchImpl };

/** Exercises normalization, strict validation, handler dispatch, and the HTTP proxy together. */
function call({ tool, args }: { tool: McpToolDef; args: Record<string, unknown> }) {
  return handleToolCall({ name: tool.name, tools: buildToolIndex({ tools: [tool] }), ctx }, { rawArgs: args });
}

beforeEach(() => {
  fetchImpl.mockReset();
  fetchImpl.mockImplementation(async () => Response.json({ result: completed }));
});

describe('proxy argument recovery', () => {
  it.each(['toolId', 'name'])('describe_tool accepts and advertises %s as an alias of id', async (alias) => {
    const descriptor = { id: 'page/read', description: 'Read a page', inputSchema: { type: 'object' } };
    fetchImpl.mockImplementation(async () => Response.json(descriptor));
    const result = await call({ tool: describeToolTool, args: { [alias]: descriptor.id } });
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(descriptor) }] });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://daemon.example/api/tools/page%2Fread');
    expect(describeToolTool.inputSchema.properties).toHaveProperty(alias);
    expect(describeToolTool.description).toContain(alias);
    expect(describeToolTool.inputSchema.additionalProperties).toBe(false);
  });

  it('refuses ambiguous aliases with a precise rename instruction', async () => {
    const result = await call({ tool: describeToolTool, args: { id: 'one', toolId: 'two' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'invalid arguments for describe_tool: rename `toolId` to `id` and supply only one value for `id`' }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  for (const create of [createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool]) {
    const tool = create({ runId: 'run-fixed' }, { generateToolUseId: () => 'use-fixed' });

    describe(tool.name, () => {
      it.each([undefined, { limit: 5 }])('folds a stray query into input %j and executes', async (input) => {
        const args = { toolId: 'search_agent_plugin_local', query: 'kui', ...(input === undefined ? {} : { input }) };
        const result = await call({ tool, args });
        expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(completed) }] });
        const request = fetchImpl.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual({
          runId: 'run-fixed', toolUseId: 'use-fixed', toolId: 'search_agent_plugin_local',
          input: { ...input, query: 'kui' },
          ...(tool.name === 'execute_readonly_delegated_tool' ? { requireReadOnly: true } : {}),
        });
        expect(args).toEqual({ toolId: 'search_agent_plugin_local', query: 'kui', ...(input === undefined ? {} : { input }) });
        expect(input).toEqual(input === undefined ? undefined : { limit: 5 });
        expect(tool.inputSchema.additionalProperties).toBe(false);
      });

      it.each(['kui', 'different'])('rejects a duplicate query (%s) without executing', async (query) => {
        const result = await call({ tool, args: { toolId: 'search_agent_plugin_local', query, input: { query: 'kui' } } });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: `invalid arguments for ${tool.name}: put the tool's own arguments inside \`input\`` }]);
        expect(fetchImpl).not.toHaveBeenCalled();
      });

      it.each([null, [], '{"query":"kui"}'])('rejects malformed input %j with a move instruction', async (input) => {
        const result = await call({ tool, args: { toolId: 'search_agent_plugin_local', query: 'kui', input } });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: `invalid arguments for ${tool.name}: put the tool's own arguments inside \`input\`; replace \`input\` with a JSON object` }]);
        expect(fetchImpl).not.toHaveBeenCalled();
      });

      it('never lets a folded runId or read-only flag override the host-owned envelope', async () => {
        const result = await call({ tool, args: { toolId: 'echo', runId: 'other', requireReadOnly: false } });
        expect(result.isError).toBeUndefined();
        const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
        expect(body.runId).toBe('run-fixed');
        expect(body.input).toEqual({ runId: 'other', requireReadOnly: false });
        expect(body.requireReadOnly).toBe(tool.name === 'execute_readonly_delegated_tool' ? true : undefined);
      });
    });
  }

  it.each([
    { tool: describeToolTool, args: { id: 'echo', junk: true } },
    { tool: searchToolsTool, args: { query: 'echo', junk: true } },
    { tool: getRunTool, args: { runId: 'run-1', junk: true } },
  ])('rejects unknown junk for $tool.name with an actionable key name', async ({ tool, args }) => {
    const result = await call({ tool, args });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('remove unknown argument `junk`');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { tool: searchToolsTool, args: { input: { query: 'echo' } }, key: 'query' },
    { tool: getRunTool, args: { input: { runId: 'run-1' } }, key: 'runId' },
  ])('tells callers to move nested arguments to the flat $tool.name schema', async ({ tool, args, key }) => {
    const result = await call({ tool, args });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(`move \`input.${key}\` to top-level \`${key}\``);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names the missing canonical id rather than echoing the alias schema branches', async () => {
    const result = await call({ tool: describeToolTool, args: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('supply required argument `id`');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names a mistyped field and says how to fix it', async () => {
    const result = await call({ tool: searchToolsTool, args: { query: 'echo', limit: '5' } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('change `limit`');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
