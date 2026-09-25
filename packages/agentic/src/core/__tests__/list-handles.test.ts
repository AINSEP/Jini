import { describe, expect, it } from 'vitest';

import { buildAgentListHandles } from '../index.js';

/**
 * @file Ported from a host app's own per-feature test suite for its `buildExternalMcpCardHandles`
 * wrapper when the per-item list-handle policy moved from that host's local module into this
 * package, so every host gets it for free. Cases are unchanged in substance — only the fixed
 * `"mcp-server"` prefix became an explicit argument, since this module serves any list, not just
 * one feature's cards.
 */
describe('buildAgentListHandles', () => {
  it('derives a legible handle from each id, not its position', () => {
    expect(buildAgentListHandles('mcp-server', ['higgsfield', 'github'])).toEqual([
      'mcp-server-higgsfield',
      'mcp-server-github',
    ]);
  });

  it('slugifies an id that is not already handle-shaped, since a handle is [a-z0-9-] only', () => {
    expect(buildAgentListHandles('mcp-server', ['My_Server.1'])).toEqual(['mcp-server-my-server-1']);
  });

  it('falls back to the position for an id with nothing sluggable left in it', () => {
    expect(buildAgentListHandles('mcp-server', ['***', '…'])).toEqual(['mcp-server-1', 'mcp-server-2']);
  });

  it('keeps two ids that slugify identically apart', () => {
    expect(buildAgentListHandles('mcp-server', ['My_Server', 'my.server'])).toEqual([
      'mcp-server-my-server',
      'mcp-server-my-server-2',
    ]);
  });

  // The case a single `-<index>` append gets wrong: the third entry's fallback would be
  // `mcp-server-x-3`, which the SECOND entry already holds. Duplicate handles do not fail loudly —
  // they make every `page.click`/`page.fill` aimed at either card resolve to whichever the DOM
  // reaches first. This is why the suffix search is a loop.
  it('keeps a de-duplication suffix from colliding with an id that already looks like one', () => {
    const handles = buildAgentListHandles('mcp-server', ['x', 'x-3', 'x']);
    expect(new Set(handles).size).toBe(3);
    expect(handles).toEqual(['mcp-server-x', 'mcp-server-x-3', 'mcp-server-x-2']);
  });

  it('never repeats a handle, however adversarial the id list', () => {
    const ids = ['x', 'x-2', 'x', 'x-3', 'x', 'X', 'x_', '-x-', 'x-2-2'];
    const handles = buildAgentListHandles('mcp-server', ids);
    expect(handles).toHaveLength(ids.length);
    expect(new Set(handles).size).toBe(ids.length);
  });

  it('returns nothing for an empty list', () => {
    expect(buildAgentListHandles('mcp-server', [])).toEqual([]);
  });

  it('works under a different prefix, since the policy is not specific to any one feature', () => {
    expect(buildAgentListHandles('form-field', ['about-us', 'contact'])).toEqual([
      'form-field-about-us',
      'form-field-contact',
    ]);
  });
});
