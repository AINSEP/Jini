import { describe, expect, it } from 'vitest';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createToolGapCollector, nativeFallbackSummary, decodeToolGapEntry, toolGapsFromAuditEvents } from '../core/tool-gaps.js';

const event = (payload: unknown, sequence = 1): RunProtocolEvent => ({
  runId: 'r', eventId: `r:${sequence}`, opaqueCursor: String(sequence), ts: 1000,
  protocolVersion: 1, durability: 'durable', kind: 'agent', payload,
} as RunProtocolEvent);

function collector() {
  const rows: { attemptId: string; toolId: string; detail: string }[] = [];
  const audit = createToolGapCollector({
    workspaceId: 'w', principalId: 'owner', site: 'site-a', chatId: 'chat-a', runId: 'r', provider: 'claude',
    redact: text => text.replace(/password=\S+/g, 'password=[REDACTED]'),
    sink: { append: async (row, options) => { rows.push({ ...row, detail: options?.detail ?? '' }); } },
  }, {});
  return { audit, rows };
}

describe('automatic tool gap auditing', () => {
  it('records a fallback without any model explanation; rejects MCP lookalikes and deduplicates tool replay', async () => {
    const { audit, rows } = collector();
    const tool = event({ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'curl password=supersecret' } });
    audit.observe({ event: tool }); audit.observe({ event: tool });
    audit.observe({ event: event({ type: 'tool_use', id: 'other', name: 'mcp__vendor__Bash', input: {} }) });
    await audit.flush();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ at: '1970-01-01T00:00:01.000Z', site: 'site-a', chatId: 'chat-a', provider: 'claude', toolUsed: 'Bash', summary: 'curl password=[REDACTED]', gapLine: null });
    expect(JSON.parse(rows[1]!.detail)).toMatchObject({ type: 'native_tool_used', toolUsed: 'mcp__vendor__Bash', gapLine: null });
    expect(JSON.stringify(rows)).not.toContain('supersecret');
  });
  it('captures an explanation split across text chunks and attaches a later explanation as a revision', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: event({ type: 'text_delta', delta: 'Tool ga' }) });
    audit.observe({ event: event({ type: 'text_delta', delta: 'p: compile — no Tovu tool for it.\n' }) });
    audit.observe({ event: event({ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'make' } }) });
    audit.observe({ event: event({ type: 'tool_use', id: 'b', name: 'Write', input: { file_path: '/tmp/a', content: 'NEVER STORE FILE BODY' } }) });
    audit.observe({ event: event({ type: 'text_delta', delta: 'Tool gap: file — no Tovu tool for it.\n' }) });
    audit.observe({ event: { ...event({}), kind: 'end', payload: {} } as RunProtocolEvent });
    await audit.flush();
    expect(rows).toHaveLength(3);
    expect(rows[1]!.attemptId).toBe(rows[2]!.attemptId);
    expect(JSON.parse(rows[0]!.detail).gapLine).toContain('compile');
    expect(JSON.parse(rows[2]!.detail)).toMatchObject({ summary: '/tmp/a', gapLine: 'Tool gap: file — no Tovu tool for it.' });
    expect(JSON.stringify(rows)).not.toContain('NEVER STORE FILE BODY');
  });
  it('stores only paths from patches and handles missing native input', () => {
    expect(nativeFallbackSummary({ name: 'apply_patch', input: '*** Update File: /tmp/a\n+password=secret' })).toBe('*** Update File: /tmp/a');
    expect(nativeFallbackSummary({ name: 'apply_patch', input: { paths: ['/tmp/a', '/tmp/b'] } })).toBe('/tmp/a; /tmp/b');
    expect(nativeFallbackSummary({ name: 'Edit', input: null })).toContain('no command/path');
  });
  it('redacts before truncating a command, and flushes a trailing explanation at terminal', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: event({ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'x'.repeat(480) + ' password=' + 'S'.repeat(100) } }) });
    audit.observe({ event: event({ type: 'text_delta', delta: 'Tool gap: compile — no Tovu tool for it.' }) });
    audit.observe({ event: { ...event({}), kind: 'end', payload: {} } as RunProtocolEvent });
    await audit.flush();
    expect(JSON.stringify(rows)).not.toContain('SSSS');
    expect(JSON.parse(rows.at(-1)!.detail).gapLine).toContain('compile');
    expect(JSON.parse(rows[0]!.detail).summary.length).toBeLessThanOrEqual(500);
  });
  it('decodes only complete metadata and gives the memory reader latest-revision semantics', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: event({ type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: '/tmp/a' } }) });
    audit.observe({ event: event({ type: 'text_delta', delta: 'Tool gap: edit — no Tovu tool for it.\n' }) });
    audit.observe({ event: { ...event({}), kind: 'end', payload: {} } as RunProtocolEvent });
    await audit.flush();
    expect(decodeToolGapEntry({ json: 'not json' })).toBeNull();
    expect(decodeToolGapEntry({ json: '{"id":"wrong"}' })).toBeNull();
    const events = rows.map(row => ({ ...row, executionId: null, workspaceId: 'w', principalId: 'owner', runId: 'r', at: '', phase: 'requested' as const }));
    expect(toolGapsFromAuditEvents({ events, workspaceId: 'w', principalId: 'owner' }, {})).toHaveLength(1);
    expect(toolGapsFromAuditEvents({ events, workspaceId: 'w', principalId: 'other' }, {})).toEqual([]);
    expect(toolGapsFromAuditEvents({ events, workspaceId: 'other', principalId: 'owner' }, {})).toEqual([]);
  });
});

it('Task, workflow and external MCP are native observations; only shell/file edits are gaps, catalog calls are already audited', async () => {
  const { audit, rows } = collector();
  for (const [id, name] of ['Bash', 'Task', 'Agent', 'Workflow', 'mcp__chrome__read_page', 'Read', 'mcp__jini__search_tools', 'execute_delegated_tool'].entries()) {
    audit.observe({ event: event({ type: 'tool_use', id: String(id), name, input: { command: 'pwd', prompt: 'private task text', secret: 'private-token' } }) });
  }
  await audit.flush();
  const entries = rows.map(row => JSON.parse(row.detail));
  expect(entries).toHaveLength(6);
  expect(entries[0]).toMatchObject({ type: 'tool_gap', toolUsed: 'Bash', summary: 'pwd' });
  for (const entry of entries.slice(1)) expect(entry).toMatchObject({ type: 'native_tool_used', summary: 'Native tool used', gapLine: null });
  expect(JSON.stringify(entries)).not.toMatch(/private task text|private-token/);
  const legacy = { ...entries[0] }; delete legacy.type;
  expect(decodeToolGapEntry({ json: JSON.stringify(legacy) })?.type).toBe('tool_gap');
});