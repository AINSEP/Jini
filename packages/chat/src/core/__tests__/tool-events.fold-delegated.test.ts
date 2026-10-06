import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { dedupeToolUsesById, foldDelegatedWrapperCalls, isDelegatedWrapperToolName } from '../tool-events.js';

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
