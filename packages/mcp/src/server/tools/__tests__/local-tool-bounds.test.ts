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

function text(result: Awaited<ReturnType<typeof call>>): string {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('Expected model-visible text');
  return block.text;
}

describe('MCP-local tools opt in to clamp: out-of-range page controls are repaired with one note', () => {
  const NOTE_8000 = 'normalized: limit was lowered to its maximum, 8000';

  it.each([8300, '8300'])('read_tool_result limit %j reads 8000 characters and carries the one note', async (limit) => {
    const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
    pages.project({ result: { content: [{ type: 'text', text: 'x'.repeat(15000) }] } });
    const result = await call({ tool: pages.tool, args: { resultId: 'saved-a', limit } });
    expect(result.isError).toBeUndefined();
    const body = text(result);
    expect(JSON.parse(body.slice(0, body.indexOf('\n')))).toEqual({ resultId: 'saved-a', offset: 0, nextOffset: 8000, totalChars: 15000 });
    expect(result.content.filter(block => block.type === 'text' && block.text === NOTE_8000)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('8300');
  });

  it.each([['limit', 26], ['max_results', 26], ['limit', '26'], ['max_results', '26']])('search_tools %s %j runs with 25 and says so once', async (key, value) => {
    const result = await call({ tool: searchToolsTool, args: { query: 'q', [key]: value } });
    expect(result.isError).toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://daemon.example/api/tools/search?q=q&limit=25');
    expect(JSON.stringify(result).match(/limit was lowered to its maximum, 25/g)).toHaveLength(1);
  });

  it.each([['limit', 0], ['max_results', 0]])('search_tools %s %j is raised to 1 with the note', async (key, value) => {
    const result = await call({ tool: searchToolsTool, args: { query: 'q', [key]: value } });
    expect(result.isError).toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://daemon.example/api/tools/search?q=q&limit=1');
    expect(JSON.stringify(result)).toContain('limit was raised to its minimum, 1');
  });

  it('read_tool_result and search_tools keep every other refusal text unchanged', async () => {
    const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
    const refusals: Array<[McpToolDef, Record<string, unknown>, string]> = [
      // The missing-argument refusal quotes the published schema, so its `limit` now also shows `clamp`.
      [pages.tool, { limit: 5 }, 'invalid arguments for read_tool_result: supply required argument `resultId`; Input schema: {"type":"object","required":["resultId"],"additionalProperties":false,"properties":{"resultId":{"type":"string","minLength":1},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":8000,"clamp":true}}}'],
      [pages.tool, { resultId: 'saved-a', limit: 1.5 }, 'invalid arguments for read_tool_result: change `limit`: Instance type "number" is invalid. Expected "integer".'],
      [searchToolsTool, { query: 'q', limit: 1.5 }, 'invalid arguments for search_tools: change `limit`: Instance type "number" is invalid. Expected "integer".'],
      [searchToolsTool, { query: 'q', limit: 'eight' }, 'invalid arguments for search_tools: change `limit`: Instance type "string" is invalid. Expected "integer".'],
    ];
    for (const [tool, args, expected] of refusals) {
      const result = await call({ tool, args });
      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: expected }] });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('search_tools still runs max_results "8" as 8 with no normalization note', async () => {
    const result = await call({ tool: searchToolsTool, args: { query: 'q', max_results: '8' } });
    expect(result).toEqual({ content: [{ type: 'text', text: '[]' }] });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://daemon.example/api/tools/search?q=q&limit=8');
  });
});
