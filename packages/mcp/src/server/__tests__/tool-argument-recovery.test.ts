import { describe, expect, it } from 'vitest';
import { buildToolIndex, handleToolCall, type McpToolContext, type McpToolDef } from '../tool-protocol.js';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool, createTypedDelegatedToolTool } from '../tools/delegated-tool.js';

/** Real MCP dispatch and validation; only the authenticated daemon HTTP hop is replaced. */
function harness({ id, inputSchema, readOnly = false }: {
  id: string; inputSchema: McpToolDef['inputSchema']; readOnly?: boolean;
}, _options = {}) {
  const calls: Record<string, unknown>[] = [];
  const ctx: McpToolContext = {
    baseUrl: 'http://daemon.example',
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ result: { status: 'completed', output: { changed: true } } });
    },
  };
  const tools = buildToolIndex({ tools: [
    createTypedDelegatedToolTool({ runId: 'trusted-run', tool: { wireName: id, descriptor: { id, inputSchema, readOnly } } }),
    createExecuteDelegatedToolTool({ runId: 'trusted-run' }),
    createExecuteReadonlyDelegatedToolTool({ runId: 'trusted-run' }),
  ] });
  const context: McpToolContext = { ...ctx, callLocalTool: async ({ name, input, requireReadOnly }) => {
    const tool = tools.get(name);
    if (!tool) return undefined;
    if (requireReadOnly && tool.annotations?.readOnlyHint !== true) throw new Error('not read-only');
    return handleToolCall({ name, tools, ctx }, { rawArgs: input });
  } };
  return { calls, tools, ctx: context, call: (name: string, rawArgs: Record<string, unknown>) =>
    handleToolCall({ name, tools, ctx: context }, { rawArgs }) };
}

const pluginSchema: McpToolDef['inputSchema'] = {
  type: 'object', additionalProperties: false, required: ['family', 'pluginId', 'enabled'],
  properties: { family: { type: 'string' }, pluginId: { type: 'string', aliases: ['id'] }, enabled: { type: 'boolean' } },
};

describe('first-call tool argument recovery for every MCP CLI', () => {
  it('turning on a plugin accepts an agreeing extra id before strict MCP validation', async () => {
    const h = harness({ id: 'plugins_set_enabled', inputSchema: pluginSchema });
    const input = { family: 'agent-plugin', pluginId: 'charts', id: 'charts', enabled: true };
    const result = await h.call('plugins_set_enabled', input);
    expect(result.isError).not.toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ runId: 'trusted-run', toolId: 'plugins_set_enabled',
      input: { family: 'agent-plugin', pluginId: 'charts', enabled: true } });
    expect(input).toEqual({ family: 'agent-plugin', pluginId: 'charts', id: 'charts', enabled: true });
    expect(JSON.stringify(result)).toContain('id→pluginId');
  });

  it('switching a theme accepts its declared argument alias through direct and delegated calls', async () => {
    const inputSchema: McpToolDef['inputSchema'] = { type: 'object', additionalProperties: false,
      required: ['themeId'], properties: { themeId: { type: 'string', aliases: ['activeThemeId'] } } };
    const h = harness({ id: 'theme_set_active', inputSchema });
    for (const name of ['theme_set_active', 'execute_delegated_tool']) {
      const input = { active_theme_id: 'lucky-goat' };
      const result = await h.call(name, name === 'theme_set_active' ? input : { toolId: 'theme_set_active', input });
      expect(result.isError).not.toBe(true);
    }
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) expect(call.input).toEqual({ themeId: 'lucky-goat' });
  });

  it('conflicting plugin identifiers fail without executing or exposing their values', async () => {
    const h = harness({ id: 'plugins_set_enabled', inputSchema: pluginSchema });
    const result = await h.call('plugins_set_enabled', { family: 'agent-plugin', pluginId: 'private-one', id: 'private-two', enabled: true });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("Send only 'pluginId'");
    expect(JSON.stringify(result)).not.toMatch(/private-one|private-two/);
    expect(h.calls).toEqual([]);
  });

  it('a wrong wait argument returns the complete declared contract in one repair message', async () => {
    // Representative remote contract: never infer units or a timeout alias from its spelling.
    const inputSchema: McpToolDef['inputSchema'] = { type: 'object', additionalProperties: false,
      properties: { jobIds: { type: 'array', items: { type: 'string' } }, maxWaitSeconds: { type: 'integer' } } };
    const h = harness({ id: 'jobs_wait', inputSchema, readOnly: true });
    const result = await h.call('jobs_wait', { timeout_seconds: 10 });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(`Input schema: ${JSON.stringify(inputSchema)}`);
    expect(h.calls).toEqual([]);
  });

  it('the prefixed connect name reaches the same trusted run through either call surface', async () => {
    const h = harness({ id: 'agent_plugin_connect', inputSchema: { type: 'object', additionalProperties: false,
      required: ['pluginId'], properties: { pluginId: { type: 'string' } } } });
    for (const name of ['mcp__jini__agent_plugin_connect', 'execute_delegated_tool']) {
      const input = { pluginId: 'media' };
      const result = await h.call(name, name === 'execute_delegated_tool' ? { toolId: 'mcp__jini__agent_plugin_connect', input } : input);
      expect(result.isError).not.toBe(true);
    }
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) expect(call).toMatchObject({ runId: 'trusted-run', toolId: 'agent_plugin_connect', input: { pluginId: 'media' } });
  });

  it('prefix recovery keeps exact names, foreign server names and read-only enforcement intact', async () => {
    const h = harness({ id: 'agent_plugin_connect', inputSchema: { type: 'object', properties: {} } });
    const readonly = await h.call('execute_readonly_delegated_tool', { toolId: 'mcp__jini__agent_plugin_connect', input: {} });
    expect(readonly.isError).toBe(true);
    expect(JSON.stringify(readonly)).toContain('read-only');
    expect((await h.call('mcp__other__agent_plugin_connect', {})).isError).toBe(true);
    expect(h.calls).toEqual([]);
    const exact: McpToolDef = { name: 'mcp__jini__agent_plugin_connect', description: 'Exact registered name',
      inputSchema: { type: 'object' }, handler: () => 'exact' };
    const tools = buildToolIndex({ tools: [...h.tools.values(), exact] });
    expect(await handleToolCall({ name: exact.name, tools, ctx: h.ctx }, { rawArgs: {} })).toEqual({ content: [{ type: 'text', text: 'exact' }] });
  });
});
