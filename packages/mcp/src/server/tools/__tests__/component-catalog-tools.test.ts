import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getDaemonJson: vi.fn() }));
const { getDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import { COMPONENT_CATALOG_TOOLS, describeComponentTool, searchComponentsTool } from '../component-catalog-tools.js';
import { buildToolIndex, handleToolCall, type McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

describe('COMPONENT_CATALOG_TOOLS', () => {
  it('exports both tools with unique names', () => {
    expect(COMPONENT_CATALOG_TOOLS.map((t) => t.name)).toEqual(['search_components', 'describe_component']);
  });
});

describe('searchComponentsTool', () => {
  it('requires query', async () => {
    await expect(searchComponentsTool.handler({}, ctx)).rejects.toThrow('query is required (string).');
  });

  it('omits limit from the query string when not supplied', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchComponentsTool.handler({ query: 'tabular data' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/components/search?q=tabular+data', { fetchImpl: ctx.fetchImpl });
  });

  it('includes limit in the query string when supplied as a number', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchComponentsTool.handler({ query: 'tabular data', limit: 5 }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/components/search?q=tabular+data&limit=5', { fetchImpl: ctx.fetchImpl });
  });

  it('returns the hits array from the daemon response', async () => {
    const hits = [{ id: 'native.data-table', provider: 'native', capabilities: ['data-table'], score: 0.9 }];
    getDaemonJson.mockResolvedValueOnce({ hits });
    const result = await searchComponentsTool.handler({ query: 'table' }, ctx);
    expect(result).toBe(hits);
  });
});

describe('searchComponentsTool.inputSchema limit bounds', () => {
  const tools = buildToolIndex([searchComponentsTool]);

  beforeEach(() => {
    getDaemonJson.mockReset();
  });

  async function call(limit: unknown) {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    return handleToolCall('search_components', { query: 'q', limit }, tools, ctx);
  }

  it('describes limit as an integer in the range the route actually accepts', () => {
    const limitSchema = (searchComponentsTool.inputSchema.properties as Record<string, Record<string, unknown>>).limit;
    expect(limitSchema).toMatchObject({ type: 'integer', minimum: 1, maximum: 25 });
  });

  it.each([0, -1, 1.5, 26])('rejects out-of-range limit %p instead of forwarding it to the daemon', async (limit) => {
    const result = await call(limit);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for search_components');
    expect(getDaemonJson).not.toHaveBeenCalled();
  });

  it.each([1, 10, 25])('still accepts in-range limit %p', async (limit) => {
    const result = await call(limit);
    expect(result.isError).toBeUndefined();
    expect(getDaemonJson).toHaveBeenCalledWith(
      'http://d.example',
      `/api/components/search?q=q&limit=${limit}`,
      { fetchImpl: ctx.fetchImpl },
    );
  });
});

describe('describeComponentTool', () => {
  it('requires id', async () => {
    await expect(describeComponentTool.handler({}, ctx)).rejects.toThrow('id is required (string).');
  });

  it('fetches the component descriptor by id, URI-encoded', async () => {
    getDaemonJson.mockResolvedValueOnce({ id: 'native.data-table', provider: 'native' });
    const result = await describeComponentTool.handler({ id: 'native.data-table' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/components/native.data-table', { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ id: 'native.data-table', provider: 'native' });
  });
});
