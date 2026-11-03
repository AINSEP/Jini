import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { dedupeToolUsesById, foldDelegatedWrapperCalls, isDelegatedWrapperToolName } from '../tool-events.js';
import { DIRECT_MCP_EVENTS } from './fixtures/direct-mcp-events.js';

/**
 * The event sequence stored for chat.db message e8c84205 (2026-10-05): the model called the
 * read-only wrapper with no `input` (refused, red), then retried with `input: {}` (green). The
 * wrapper rows carry the CLI's `toolu_…` ids and the canonical rows the bridge's own UUIDs, so
 * dedupe-by-id cannot merge them, and the pane showed four rows (two red, two green) for two calls.
 */
const STORED_SEQUENCE: AgentEvent[] = [
  { kind: 'tool_use', id: 'toolu_search', name: 'mcp__jini__search_tools', input: { query: 'list or count blog posts content entries' } },
  { kind: 'tool_use', id: 'toolu_search', name: 'mcp__jini__search_tools', input: { query: 'list or count blog posts content entries' } },
  { kind: 'tool_result', toolUseId: 'toolu_search', content: '[{"id":"content_stats"}]', isError: false },
  { kind: 'tool_use', id: 'toolu_017N', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats' } },
  { kind: 'tool_use', id: 'toolu_017N', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats' } },
  { kind: 'tool_use', id: 'ad3e4275', name: 'content_stats', input: undefined },
  { kind: 'tool_result', toolUseId: 'ad3e4275', content: 'input must be an object', isError: true },
  { kind: 'tool_result', toolUseId: 'toolu_017N', content: 'daemon 400 on http://127.0.0.1:63378/api/delegated-tool-calls: BAD_REQUEST: input must be an object', isError: true },
  { kind: 'tool_use', id: 'toolu_01Nv', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats', input: {} } },
  { kind: 'tool_use', id: 'toolu_01Nv', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats', input: {} } },
  { kind: 'tool_use', id: '81ef04f5', name: 'content_stats', input: {} },
  { kind: 'tool_result', toolUseId: '81ef04f5', content: '{"posts":{"total":10}}', isError: false },
  { kind: 'tool_result', toolUseId: 'toolu_01Nv', content: '{"executionId":"a277","status":"completed"}', isError: false },
];

function toolUseIds(events: AgentEvent[]): string[] {
  return events.flatMap((e) => (e.kind === 'tool_use' ? [e.id] : []));
}

describe('foldDelegatedWrapperCalls — direct MCP transport calls', () => {
  it('keeps only the bridge row and its real result for the reported ask-choice sequence', () => {
    const folded = foldDelegatedWrapperCalls({ events: dedupeToolUsesById({ events: DIRECT_MCP_EVENTS }) });
    expect(folded).toEqual(DIRECT_MCP_EVENTS.slice(1, 3));
  });

  it.each(['jini', 'my_host'])('folds mcp__%s__ names with structurally equal, reordered inputs', (server) => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w', name: `mcp__${server}__theme_read_file`, input: { path: 'a', options: { lines: [1, 2], raw: true } } },
      { kind: 'tool_use', id: 'c', name: 'theme_read_file', input: { options: { raw: true, lines: [1, 2] }, path: 'a' } },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([events[1]]);
  });

  it.each([
    [{ path: 'a' }, { path: 'b' }],
    [{ lines: [1, 2] }, { lines: [2, 1] }],
    [undefined, {}],
    [null, {}],
  ])('keeps calls whose inputs differ: %j versus %j', (first, second) => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w', name: 'mcp__jini__theme_read_file', input: first },
      { kind: 'tool_use', id: 'c', name: 'theme_read_file', input: second },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it.each(['a', 'b'])('keeps two sequential genuine calls when the second input is %s', (path) => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'mcp__jini__theme_read_file', input: { path: 'a' } },
      { kind: 'tool_use', id: 'c1', name: 'theme_read_file', input: { path: 'a' } },
      { kind: 'tool_result', toolUseId: 'c1', content: 'first', isError: false },
      { kind: 'tool_result', toolUseId: 'w1', content: 'done', isError: false },
      { kind: 'tool_use', id: 'w2', name: 'mcp__jini__theme_read_file', input: { path } },
      { kind: 'tool_use', id: 'c2', name: 'theme_read_file', input: { path } },
      { kind: 'tool_result', toolUseId: 'c2', content: 'second', isError: true },
      { kind: 'tool_result', toolUseId: 'w2', content: 'failed', isError: true },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([events[1], events[2], events[5], events[6]]);
  });

  // Demo practice run (2026-11-02): every tool row showed twice, `mcp__jini__X` and `X`. The MCP
  // server normalizes arguments before the bridge sees them (an integer string read as the integer,
  // an alias renamed), so the bridge row's input is not the CLI row's and the equal-input match missed.
  // A CLI call's own result only returns after the bridge row it caused, so between the two a
  // same-name bridge row is that call, whatever the server prefix and whichever CLI named it.
  it.each([
    ['an integer string read as the integer', { limit: '10' }, { limit: 10 }],
    ['an alias renamed to its canonical key', { max_results: 5 }, { limit: 5 }],
  ])('folds a direct call whose bridge input was normalized: %s', (_case, cliInput, bridgeInput) => {
    for (const server of ['jini', 'my_host']) {
      const events: AgentEvent[] = [
        { kind: 'tool_use', id: 'toolu_1', name: `mcp__${server}__content_list`, input: cliInput },
        { kind: 'tool_use', id: 'bridge-1', name: 'content_list', input: bridgeInput },
        { kind: 'tool_result', toolUseId: 'bridge-1', content: '{"items":[]}', isError: false },
        { kind: 'tool_result', toolUseId: 'toolu_1', content: '{"status":"completed"}', isError: false },
      ];
      expect(foldDelegatedWrapperCalls({ events })).toEqual([events[1], events[2]]);
    }
  });

  it('pairs parallel normalized calls in order, one row per call', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'mcp__jini__content_list', input: { limit: '1' } },
      { kind: 'tool_use', id: 'w2', name: 'mcp__jini__content_list', input: { limit: '2' } },
      { kind: 'tool_use', id: 'c1', name: 'content_list', input: { limit: 1 } },
      { kind: 'tool_use', id: 'c2', name: 'content_list', input: { limit: 2 } },
      { kind: 'tool_result', toolUseId: 'c1', content: 'one', isError: false },
      { kind: 'tool_result', toolUseId: 'c2', content: 'two', isError: false },
      { kind: 'tool_result', toolUseId: 'w1', content: 'done', isError: false },
      { kind: 'tool_result', toolUseId: 'w2', content: 'done', isError: false },
    ];
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['c1', 'c2']);
  });

  it('keeps a call refused before the bridge visible beside a parallel call that reached it', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'mcp__jini__content_list', input: { limit: 'many' } },
      { kind: 'tool_use', id: 'w2', name: 'mcp__jini__content_list', input: { limit: '2' } },
      { kind: 'tool_use', id: 'c2', name: 'content_list', input: { limit: 2 } },
      { kind: 'tool_result', toolUseId: 'w1', content: 'limit must be an integer', isError: true },
      { kind: 'tool_result', toolUseId: 'c2', content: 'two', isError: false },
      { kind: 'tool_result', toolUseId: 'w2', content: 'done', isError: false },
    ];
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['w1', 'c2']);
  });

  it('claims a bridge row once across parallel calls and replayed CLI events', () => {
    const wrapper: AgentEvent = { kind: 'tool_use', id: 'w1', name: 'mcp__jini__render_ui', input: {} };
    const events: AgentEvent[] = [wrapper, wrapper,
      { ...wrapper, id: 'w2' },
      { kind: 'tool_use', id: 'c1', name: 'render_ui', input: {} },
    ];
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['w2', 'c1']);
  });

  it('keeps a failed CLI call separate from a later identical call after its result', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'mcp__jini__render_ui', input: {} },
      { kind: 'tool_result', toolUseId: 'w1', content: 'bridge unavailable', isError: true },
      { kind: 'tool_use', id: 'w2', name: 'mcp__jini__render_ui', input: {} },
      { kind: 'tool_use', id: 'c2', name: 'render_ui', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([events[0], events[1], events[3]]);
  });

  it('keeps bare calls, earlier rows, mismatched names and incomplete MCP names', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'c0', name: 'render_ui', input: {} },
      { kind: 'tool_use', id: 'w', name: 'mcp__jini__render_ui', input: {} },
      { kind: 'tool_use', id: 'c1', name: 'assistant_ask_choice', input: {} },
      { kind: 'tool_use', id: 'c2', name: 'assistant_ask_choice', input: {} },
      { kind: 'tool_use', id: 'x', name: 'mcp__render_ui', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('retains direct MCP ordering and result boundaries alongside a buffered Antigravity wrapper', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'earlier', name: 'render_ui', input: {} },
      { kind: 'tool_use', id: 'agy', name: 'call_mcp_tool', input: { ServerName: 'jini', ToolName: 'render_ui', Arguments: {} } },
      { kind: 'tool_use', id: 'claude', name: 'mcp__jini__render_ui', input: {} },
      { kind: 'tool_result', toolUseId: 'claude', content: 'bridge unavailable', isError: true },
      { kind: 'tool_use', id: 'later', name: 'render_ui', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([events[0], events[2], events[3], events[4]]);
  });
});

describe('isDelegatedWrapperToolName', () => {
  it('matches both gateways, bare and under any mcp__<server>__ prefix', () => {
    for (const name of [
      'execute_delegated_tool',
      'execute_readonly_delegated_tool',
      'mcp__jini__execute_delegated_tool',
      'mcp__jini__execute_readonly_delegated_tool',
      'mcp__my_host__execute_readonly_delegated_tool',
    ]) {
      expect(isDelegatedWrapperToolName({ name }), name).toBe(true);
    }
  });

  it('does not match a canonical tool id or another MCP tool', () => {
    for (const name of ['content_stats', 'page.fill', 'mcp__jini__search_tools', 'execute_delegated_tool_x', 'mcp__execute_delegated_tool']) {
      expect(isDelegatedWrapperToolName({ name }), name).toBe(false);
    }
  });
});

describe('foldDelegatedWrapperCalls', () => {
  it('leaves one row per call for the stored e8c84205 sequence: the red canonical and the green canonical', () => {
    const folded = foldDelegatedWrapperCalls({ events: dedupeToolUsesById({ events: STORED_SEQUENCE }) });
    expect(toolUseIds(folded)).toEqual(['toolu_search', 'ad3e4275', '81ef04f5']);
    // The wrappers' own results go with them, so nothing is left pointing at a dropped row.
    expect(folded.some((e) => e.kind === 'tool_result' && e.toolUseId.startsWith('toolu_01'))).toBe(false);
    expect(folded.filter((e) => e.kind === 'tool_result').map((e) => (e as { toolUseId: string }).toolUseId)).toEqual(['toolu_search', 'ad3e4275', '81ef04f5']);
  });

  it('keeps a wrapper that never got a canonical row (refused before the bridge), so its error stays visible', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content.post_delete' } },
      { kind: 'tool_result', toolUseId: 'w1', content: 'daemon 403: not read-only', isError: true },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('claims each canonical row once, so two parallel wrappers for the same tool fold onto two canonicals', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'wA', name: 'execute_delegated_tool', input: { toolId: 'page.fill' } },
      { kind: 'tool_use', id: 'wB', name: 'execute_delegated_tool', input: { toolId: 'page.fill' } },
      { kind: 'tool_use', id: 'c1', name: 'page.fill', input: {} },
    ];
    // Only one canonical exists: the first wrapper folds onto it, the second stays.
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['wB', 'c1']);
  });

  it('does not fold a wrapper onto a canonical row that came BEFORE it', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'c0', name: 'page.fill', input: {} },
      { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: { toolId: 'page.fill' } },
    ];
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['c0', 'w1']);
  });

  it('keeps a wrapper whose input names no toolId', () => {
    const events: AgentEvent[] = [{ kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: {} }];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('returns [] for no events', () => {
    expect(foldDelegatedWrapperCalls({ events: undefined })).toEqual([]);
  });
});

describe('dedupeToolUsesById', () => {
  it('returns [] for no events', () => {
    expect(dedupeToolUsesById({ events: undefined })).toEqual([]);
  });

  it('returns [] for an empty list', () => {
    expect(dedupeToolUsesById({ events: [] })).toEqual([]);
  });

  it('returns the same reference when no tool_use id repeats', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'a' },
      { kind: 'tool_use', id: 't1', name: 'Read', input: {} },
      { kind: 'tool_use', id: 't2', name: 'Read', input: {} },
    ];
    expect(dedupeToolUsesById({ events })).toBe(events);
  });

  it('drops later replays of a tool_use id and keeps every other event in order', () => {
    const first: AgentEvent = { kind: 'tool_use', id: 't1', name: 'Read', input: {} };
    const events: AgentEvent[] = [
      first,
      { kind: 'text', text: 'a' },
      { ...first, input: { replay: true } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { ...first, input: { replay: 2 } },
      { kind: 'tool_use', id: 't2', name: 'Read', input: {} },
    ];
    expect(dedupeToolUsesById({ events })).toEqual([events[0], events[1], events[3], events[5]]);
  });
});

describe('foldDelegatedWrapperCalls — wrapper input edges', () => {
  it('returns [] for an empty list', () => {
    expect(foldDelegatedWrapperCalls({ events: [] })).toEqual([]);
  });

  it('keeps a wrapper whose input is null', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: null },
      { kind: 'tool_use', id: 'c1', name: 'page.fill', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('keeps a wrapper whose input is not an object', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: 'page.fill' },
      { kind: 'tool_use', id: 'c1', name: 'page.fill', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('keeps a wrapper whose toolId is an empty string', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: { toolId: '' } },
      { kind: 'tool_use', id: 'c1', name: '', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('keeps a wrapper whose toolId is not a string', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: { toolId: 7 } },
      { kind: 'tool_use', id: 'c1', name: '7', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });

  it('does not let a replayed wrapper (same id) claim a second canonical row', () => {
    const wrapper: AgentEvent = { kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: { toolId: 'page.fill' } };
    const events: AgentEvent[] = [
      wrapper,
      wrapper,
      { kind: 'tool_use', id: 'c1', name: 'page.fill', input: {} },
      { kind: 'tool_use', id: 'c2', name: 'page.fill', input: {} },
    ];
    expect(toolUseIds(foldDelegatedWrapperCalls({ events }))).toEqual(['c1', 'c2']);
  });

  it('leaves a non-wrapper tool_use that shares a canonical name untouched', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'x1', name: 'Read', input: { toolId: 'page.fill' } },
      { kind: 'tool_use', id: 'c1', name: 'page.fill', input: {} },
    ];
    expect(foldDelegatedWrapperCalls({ events })).toBe(events);
  });
});
