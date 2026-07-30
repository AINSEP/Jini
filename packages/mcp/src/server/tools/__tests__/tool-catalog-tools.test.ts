import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getDaemonJson: vi.fn() }));
const { getDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import { TOOL_CATALOG_TOOLS, describeToolTool, searchToolsTool } from '../tool-catalog-tools.js';
import { buildToolIndex, handleToolCall, type McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

describe('TOOL_CATALOG_TOOLS', () => {
  it('exports both tools with unique names', () => {
    expect(TOOL_CATALOG_TOOLS.map((t) => t.name)).toEqual(['search_tools', 'describe_tool']);
  });
});

describe('searchToolsTool', () => {
  it('requires query', async () => {
    await expect(searchToolsTool.handler({}, ctx)).rejects.toThrow('query is required (string).');
  });

  it('omits limit from the query string when not supplied', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchToolsTool.handler({ query: 'navigate page' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/search?q=navigate+page', { fetchImpl: ctx.fetchImpl });
  });

  it('includes limit in the query string when supplied as a number', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchToolsTool.handler({ query: 'navigate page', limit: 5 }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/search?q=navigate+page&limit=5', { fetchImpl: ctx.fetchImpl });
  });

  it('returns the hits array from the daemon response', async () => {
    const hits = [{ id: 'page.fill', description: 'Fill a field', source: 'engine', score: 0.9 }];
    getDaemonJson.mockResolvedValueOnce({ hits });
    const result = await searchToolsTool.handler({ query: 'fill' }, ctx);
    expect(result).toBe(hits);
  });
});

describe('searchToolsTool.inputSchema limit bounds', () => {
  // The schema is the only thing standing between an agent-supplied `limit` and the
  // HTTP route, and the two must agree. `packages/http-kit/src/tool-catalog.ts`'s
  // `parseSearchInput` rejects a non-integer or `< 1` limit outright and clamps
  // anything above MAX_SEARCH_LIMIT, so a schema of bare `type: 'number'` lets
  // arguments through MCP validation that the route then refuses — the caller gets a
  // daemon-side error for input the tool declared acceptable.
  const tools = buildToolIndex([searchToolsTool]);

  // These cases assert on whether the daemon was reached at all, so the shared
  // module-level mock must not carry calls in from earlier tests.
  beforeEach(() => {
    getDaemonJson.mockReset();
  });

  async function call(limit: unknown) {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    return handleToolCall('search_tools', { query: 'q', limit }, tools, ctx);
  }

  it('describes limit as an integer in the range the route actually accepts', () => {
    const limitSchema = (searchToolsTool.inputSchema.properties as Record<string, Record<string, unknown>>).limit;
    expect(limitSchema).toMatchObject({ type: 'integer', minimum: 1, maximum: 25 });
  });

  it.each([0, -1, 1.5, 26])('rejects out-of-range limit %p instead of forwarding it to the daemon', async (limit) => {
    const result = await call(limit);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for search_tools');
    expect(getDaemonJson).not.toHaveBeenCalled();
  });

  it.each([1, 10, 25])('still accepts in-range limit %p', async (limit) => {
    const result = await call(limit);
    expect(result.isError).toBeUndefined();
    expect(getDaemonJson).toHaveBeenCalledWith(
      'http://d.example',
      `/api/tools/search?q=q&limit=${limit}`,
      { fetchImpl: ctx.fetchImpl },
    );
  });
});

describe('describeToolTool', () => {
  it('requires id', async () => {
    await expect(describeToolTool.handler({}, ctx)).rejects.toThrow('id is required (string).');
  });

  it('fetches the tool descriptor by id, URI-encoded', async () => {
    getDaemonJson.mockResolvedValueOnce({ id: 'page.fill', description: 'Fill a field' });
    const result = await describeToolTool.handler({ id: 'page.fill' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/page.fill', { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ id: 'page.fill', description: 'Fill a field' });
  });
});
