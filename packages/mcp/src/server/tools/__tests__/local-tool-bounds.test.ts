import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolIndex, handleToolCall, type McpToolDef } from '../../tool-protocol.js';
import { searchToolsTool } from '../tool-catalog-tools.js';
import { createToolResultPages } from '../../tool-result-pages.js';

const fetchImpl = vi.fn<typeof fetch>();
const ctx = { baseUrl: 'http://daemon.example', fetchImpl };

function call({ tool, args }: { tool: McpToolDef; args: Record<string, unknown> }) {
  return handleToolCall({ name: tool.name, tools: buildToolIndex({ tools: [tool] }), ctx }, { rawArgs: args });
}

beforeEach(() => {
  fetchImpl.mockReset();
  fetchImpl.mockImplementation(async () => Response.json({ hits: [] }));
});

describe('MCP-local tool numeric bounds (the refusal texts a clamp must leave alone where it does not apply)', () => {
  it('read_tool_result refuses a limit above its maximum with the exact text', async () => {
    const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
    const result = await call({ tool: pages.tool, args: { resultId: 'saved-a', limit: 8300 } });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'invalid arguments for read_tool_result: change `limit`: 8300 is greater than 8000.' }] });
  });

  it('search_tools refuses limit and max_results above 25 with the exact text', async () => {
    for (const args of [{ query: 'q', limit: 26 }, { query: 'q', max_results: 26 }]) {
      const result = await call({ tool: searchToolsTool, args });
      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'invalid arguments for search_tools: change `limit`: 26 is greater than 25.' }] });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('search_tools runs max_results "8" as 8 with no normalization note', async () => {
    const result = await call({ tool: searchToolsTool, args: { query: 'q', max_results: '8' } });
    expect(result).toEqual({ content: [{ type: 'text', text: '[]' }] });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://daemon.example/api/tools/search?q=q&limit=8');
  });
});
