import { describe, expect, it } from 'vitest';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { ToolAttemptEvent } from '../tool-audit.js';
import { createToolGapCollector, nativeFallbackSummary, decodeToolGapEntry, toolGapsFromAuditEvents } from '../tool-gaps.js';

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
const gapJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  id: 'g', at: 'T', site: 's', chatId: 'c', runId: 'r', provider: 'p', toolUsed: 'Bash', summary: 'ls', gapLine: null, ...overrides,
});

describe('decodeToolGapEntry (characterization)', () => {
  it.each([
    ['a null json', null],
    ['a JSON null', 'null'],
    ['a JSON number', '5'],
    ['a JSON array', '[]'],
  ])('returns null for %s', (_label, json) => {
    expect(decodeToolGapEntry({ json })).toBeNull();
  });
  it.each(['id', 'at', 'site', 'chatId', 'runId', 'provider', 'toolUsed', 'summary'])('returns null when %s is not a string', key => {
    expect(decodeToolGapEntry({ json: gapJson({ [key]: 1 }) })).toBeNull();
  });
  it('returns null when gapLine is missing or not a string', () => {
    const missing = JSON.parse(gapJson()); delete missing.gapLine;
    expect(decodeToolGapEntry({ json: JSON.stringify(missing) })).toBeNull();
    expect(decodeToolGapEntry({ json: gapJson({ gapLine: 3 }) })).toBeNull();
  });
  it('accepts a string gapLine and keeps native_tool_used', () => {
    expect(decodeToolGapEntry({ json: gapJson({ gapLine: 'why', type: 'native_tool_used' }) })).toMatchObject({ gapLine: 'why', type: 'native_tool_used' });
  });
  it('returns null for an unknown type and keeps extra fields on a valid row', () => {
    expect(decodeToolGapEntry({ json: gapJson({ type: 'other' }) })).toBeNull();
    expect(decodeToolGapEntry({ json: gapJson({ type: 'tool_gap', extra: 1 }) })).toEqual({ ...JSON.parse(gapJson()), type: 'tool_gap', extra: 1 });
  });
});

describe('toolGapsFromAuditEvents (characterization)', () => {
  const row = (id: string, overrides: Partial<{ toolId: string; workspaceId: string; principalId: string; detail: string | null }> = {}): ToolAttemptEvent => ({
    attemptId: id, executionId: null, runId: 'r', at: '', phase: 'requested' as const,
    toolId: 'native_tool_gap', workspaceId: 'w', principalId: 'o', detail: gapJson({ id }), ...overrides,
  });
  const withoutDetail = ({ detail: _omitted, ...rest }: ToolAttemptEvent): ToolAttemptEvent => rest;
  const many = Array.from({ length: 250 }, (_, index) => row(`g${index}`));
  const count = (limit?: number) => toolGapsFromAuditEvents({ events: many, workspaceId: 'w', principalId: 'o' }, limit === undefined ? {} : { limit }).length;
  it.each([[undefined, 100], [0, 100], [Number.NaN, 100], [0.5, 100], [1.9, 1], [-5, 1], [500, 200], [7, 7]])('clamps limit %s to %s', (limit, expected) => {
    expect(count(limit)).toBe(expected);
  });
  it('returns newest-first, keeps the latest revision per id and skips foreign, corrupt and empty rows', () => {
    const events = [
      row('a', { detail: gapJson({ id: 'a', gapLine: 'old' }) }), row('b'),
      row('x', { toolId: 'other' }), row('y', { detail: 'corrupt' }), withoutDetail(row('z')), row('n', { detail: null }),
      row('a', { detail: gapJson({ id: 'a', gapLine: 'new' }) }),
    ];
    const result = toolGapsFromAuditEvents({ events, workspaceId: 'w', principalId: 'o' });
    expect(result.map(entry => [entry.id, entry.gapLine])).toEqual([['a', 'new'], ['b', null]]);
  });
});

describe('nativeFallbackSummary (characterization)', () => {
  it.each([
    ['a non-fallback tool', 'Read', { command: 'x' }, null],
    ['a functions.-prefixed fallback', 'functions.shell', { cmd: 'ls' }, 'ls'],
    ['a string input to a non-patch tool', 'Bash', 'echo secret', '[native tool input omitted]'],
    ['an Add/Delete patch', 'apply_patch', '*** Add File: a\nbody\n*** Delete File: b\n*** Move File: c', '*** Add File: a; *** Delete File: b'],
    ['a primitive input', 'Edit', 7, '[no command/path reported]'],
    ['a non-string command falling back to a path', 'Write', { command: 1, path: '/p' }, '/p'],
    ['a notebook path', 'NotebookEdit', { notebook_path: '/n.ipynb' }, '/n.ipynb'],
    ['a paths array with non-strings', 'apply_patch', { paths: ['/a', 2, '/b'] }, '/a; /b'],
    ['an object paths value', 'edit_file', { paths: { a: 1 } }, '[no command/path reported]'],
    ['an empty object', 'replace', {}, '[no command/path reported]'],
  ])('summarizes %s', (_label, name, input, expected) => {
    expect(nativeFallbackSummary({ name, input })).toBe(expected);
  });
  it('prefers command over cmd and file_path over path', () => {
    expect(nativeFallbackSummary({ name: 'exec_command', input: { command: 'a', cmd: 'b' } })).toBe('a');
    expect(nativeFallbackSummary({ name: 'write_file', input: { file_path: '/f', path: '/p' } })).toBe('/f');
  });
});

describe('createToolGapCollector.observe (characterization)', () => {
  const end = (runId = 'r') => ({ ...event({}), runId, kind: 'end', payload: {} } as RunProtocolEvent);
  const delta = (text: string) => event({ type: 'text_delta', delta: text });
  const tool = (id: string, name = 'Bash', input: unknown = { command: 'ls' }) => event({ type: 'tool_use', id, name, input });
  const details = (rows: { detail: string }[]) => rows.map(row => JSON.parse(row.detail));

  it('ignores events of another run, non-agent kinds and other agent payloads', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: { ...tool('a'), runId: 'other' } });
    audit.observe({ event: { ...tool('b'), kind: 'stdout', payload: { chunk: 'Tool gap: stdout\n' } } as RunProtocolEvent });
    audit.observe({ event: event({ type: 'thinking_delta', delta: 'x' }) });
    audit.observe({ event: end('other') });
    await audit.flush();
    expect(rows).toEqual([]);
  });
  it('attaches a preceding explanation to the next gap and does not revise it at end', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: delta('note Tool gap: build\n') });
    audit.observe({ event: tool('a') });
    audit.observe({ event: end() });
    await audit.flush();
    expect(details(rows)).toEqual([expect.objectContaining({ id: 'r:gap:a', gapLine: 'Tool gap: build' })]);
  });
  it('ignores "Tool gap:" glued to a preceding word', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('a') });
    audit.observe({ event: delta('xTool gap: no\n') });
    audit.observe({ event: end() });
    await audit.flush();
    expect(rows).toHaveLength(1);
  });
  it('appends no revision at end without a gap or without an explanation', async () => {
    const first = collector();
    first.audit.observe({ event: delta('Tool gap: orphan') });
    first.audit.observe({ event: end() });
    const second = collector();
    second.audit.observe({ event: tool('a') });
    second.audit.observe({ event: end() });
    await first.audit.flush(); await second.audit.flush();
    expect(first.rows).toEqual([]);
    expect(second.rows).toHaveLength(1);
  });
  it('discards an oversized line, resumes after its newline and reads a later explanation', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('a') });
    audit.observe({ event: delta(`Tool gap: ${'S'.repeat(2050)}`) });
    audit.observe({ event: delta('tail of oversized line\nTool gap: real\n') });
    audit.observe({ event: end() });
    await audit.flush();
    expect(details(rows).at(-1)).toMatchObject({ gapLine: 'Tool gap: real' });
    expect(JSON.stringify(rows)).not.toContain('SSSS');
  });
  it('does not read a discarded tail at end', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('a') });
    audit.observe({ event: delta(`Tool gap: ${'S'.repeat(2050)}`) });
    audit.observe({ event: end() });
    await audit.flush();
    expect(rows).toHaveLength(1);
  });
  it('a gap tool_use reads the pending tail as its explanation and clears discarding', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: delta(`${'S'.repeat(2050)}`) });
    audit.observe({ event: tool('a') });
    audit.observe({ event: delta('Tool gap: pending') });
    audit.observe({ event: tool('b') });
    await audit.flush();
    expect(details(rows).map(entry => entry.gapLine)).toEqual([null, 'Tool gap: pending']);
  });
  it('treats functions.-prefixed catalog bridges as already audited and never marks them seen', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('c', 'functions.describe_tool', {}) });
    audit.observe({ event: tool('d', 'mcp__jini__execute_readonly_delegated_tool', {}) });
    await audit.flush();
    expect(rows).toEqual([]);
  });
  it('records a functions.-prefixed fallback as a gap under its original name', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('a', 'functions.exec_command', { cmd: 'pwd' }) });
    await audit.flush();
    expect(details(rows)[0]).toMatchObject({ type: 'tool_gap', toolUsed: 'functions.exec_command', summary: 'pwd' });
  });
  it('deduplicates a replayed native tool id', async () => {
    const { audit, rows } = collector();
    audit.observe({ event: tool('n', 'Read', {}) });
    audit.observe({ event: tool('n', 'Read', {}) });
    await audit.flush();
    expect(rows).toHaveLength(1);
  });
  it('reports sink failures, survives a throwing reporter and keeps writing', async () => {
    const reported: unknown[] = [];
    let calls = 0;
    const base = { workspaceId: 'w', principalId: 'o', site: 's', chatId: 'c', runId: 'r', provider: 'p', redact: (text: string) => text };
    const failing = createToolGapCollector({ ...base, sink: { append: async () => { calls++; throw new Error('sink down'); } } }, { onError: error => { reported.push(error); throw new Error('reporter down'); } });
    failing.observe({ event: tool('a') });
    failing.observe({ event: tool('b') });
    await failing.flush();
    expect(calls).toBe(2);
    expect(reported.map(String)).toEqual(['Error: sink down', 'Error: sink down']);
    const silent = createToolGapCollector({ ...base, sink: { append: async () => { throw new Error('sink down'); } } });
    silent.observe({ event: tool('a') });
    await expect(silent.flush()).resolves.toBeUndefined();
  });
});
