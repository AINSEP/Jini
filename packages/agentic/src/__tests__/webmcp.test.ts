import { describe, expect, it, vi } from 'vitest';

import { PAGE_CAPABILITIES, toWebMcpTool, toWebMcpTools } from '../index.js';

// PAGE_CAPABILITIES alone already has multiple entries, which is all "projects a whole manifest
// in order" below needs — this package ships no product-specific manifest of its own to combine
// it with (chat-core's CHAT_CAPABILITIES stays in chat-core; see source-map.md's "What moves").
const ALL = PAGE_CAPABILITIES;
const HIGHLIGHT = PAGE_CAPABILITIES.find((c) => c.id === 'page.highlight')!;

describe('webmcp projection', () => {
  it('maps a capability onto the registerTool shape and dispatches by id', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool = toWebMcpTool(HIGHLIGHT, execute);

    expect(tool.name).toBe('page.highlight');
    expect(tool.description).toBe(HIGHLIGHT.description);
    // WebMCP names the schema field `inputSchema` — see ag-ui.test for the contrast.
    expect(tool.inputSchema).toBe(HIGHLIGHT.inputSchema);

    await tool.execute({ element: 'task-water-plants' });
    expect(execute).toHaveBeenCalledWith('page.highlight', { element: 'task-water-plants' });
  });

  it('substitutes an empty object when a caller passes nothing', async () => {
    const execute = vi.fn(async () => null);
    await toWebMcpTool(HIGHLIGHT, execute).execute(undefined as unknown as Record<string, unknown>);
    expect(execute).toHaveBeenCalledWith('page.highlight', {});
  });

  it('projects a whole manifest in order', () => {
    const tools = toWebMcpTools(ALL, async () => null);
    expect(tools.map((t) => t.name)).toEqual(ALL.map((c) => c.id));
  });
});
