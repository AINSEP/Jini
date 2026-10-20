import { describe, expect, it } from 'vitest';
import {
  chatActivityToProgressCard,
  dedupeToolUsesById,
  deriveFileOpsFromAgentEvents,
  parseTodoWriteInput,
  type AgentEventLike,
  type ChatActivityLike,
} from '../reference-adapters.js';

const options = { id: 'card', active: false };

describe('reference adapter characterization', () => {
  it.each([undefined, null, false, 0, 'todos', {}, { todos: false, plan: false }])(
    'rejects inputs without a todo or plan array: %j', (input) => {
      expect(parseTodoWriteInput(input)).toEqual([]);
    },
  );

  it('prefers even an empty todos array over plan and otherwise falls back to plan', () => {
    const plan = [{ step: 'plan', status: 'completed' }];
    expect(parseTodoWriteInput({ todos: [], plan })).toEqual([]);
    expect(parseTodoWriteInput({ todos: {}, plan })).toEqual([{ content: 'plan', status: 'completed' }]);
  });

  it('uses the first string field, including empty strings, and rejects malformed items', () => {
    expect(parseTodoWriteInput({ todos: [
      null, 0, 'text', {},
      { content: '', step: 'must not fall back' },
      { content: 'content', step: 'step', description: 'description', label: 'label', text: 'text' },
      { content: false, step: 'step', description: 'description' },
      { content: null, step: 4, description: 'description', label: 'label' },
      { description: false, label: 'label', text: 'text' },
      { label: false, text: 'text' },
      { content: ' ' },
    ] })).toEqual([
      { content: 'content', status: 'pending' },
      { content: 'step', status: 'pending' },
      { content: 'description', status: 'pending' },
      { content: 'label', status: 'pending' },
      { content: 'text', status: 'pending' },
      { content: ' ', status: 'pending' },
    ]);
  });

  it('preserves known todo statuses and normalizes all terminal aliases', () => {
    expect(parseTodoWriteInput({ todos: [
      { content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'stopped' }, { content: 'd', status: 'cancelled' },
      { content: 'e', status: 'canceled' }, { content: 'f', status: 'failed' },
      { content: 'g', status: 'other' }, { content: 'h' },
    ] }).map((todo) => todo.status)).toEqual([
      'completed', 'in_progress', 'stopped', 'stopped', 'stopped', 'stopped', 'pending', 'pending',
    ]);
  });

  it('returns the original nonempty array when no valid tool-use id repeats', () => {
    const events: AgentEventLike[] = [
      { kind: 'tool_use' }, { kind: 'tool_use', id: 'missing-name' },
      { kind: 'text' }, { kind: 'tool_result' },
      { kind: 'tool_use', id: 'a', name: 'Read', input: {} },
    ];
    expect(dedupeToolUsesById(events)).toBe(events);
    expect(dedupeToolUsesById(undefined)).toEqual([]);
    const empty: AgentEventLike[] = [];
    expect(dedupeToolUsesById(empty)).toEqual([]);
    expect(dedupeToolUsesById(empty)).not.toBe(empty);
  });

  it('keeps the first attempt rather than the documented final attempt (reported, not fixed)', () => {
    const first: AgentEventLike = { kind: 'tool_use', id: 'a', name: 'Read', input: { path: 'first.ts' } };
    const result: AgentEventLike = { kind: 'tool_result', toolUseId: 'a', isError: true };
    const later: AgentEventLike = { kind: 'tool_use', id: 'a', name: 'Write', input: { path: 'last.ts' } };
    const other: AgentEventLike = { kind: 'tool_use', id: 'b', name: 'Read', input: {} };
    const events = [first, result, later, other, later, { kind: 'text' }];
    expect(dedupeToolUsesById(events)).toEqual([first, result, other, { kind: 'text' }]);
    expect(events).toEqual([first, result, later, other, later, { kind: 'text' }]);
    expect(deriveFileOpsFromAgentEvents(events)).toEqual([
      { path: 'first.ts', fullPath: 'first.ts', ops: ['read'], status: 'error' },
    ]);
  });

  it('keeps event, tool-name, input, and path validation guards', () => {
    const events: AgentEventLike[] = [
      { kind: 'tool_use' }, { kind: 'tool_result' }, { kind: 'text' },
      { kind: 'tool_use', id: 'a', name: 'Bash', input: { path: 'ignored.ts' } },
      ...[null, 'path', {}, { path: '' }, { path: '  ' }, { path: 5 },
        { file_path: false, path: 'blocked.ts' }].map((input, index): AgentEventLike => (
        { kind: 'tool_use', id: `invalid-${index}`, name: 'Read', input }
      )),
    ];
    expect(deriveFileOpsFromAgentEvents(undefined)).toEqual([]);
    expect(deriveFileOpsFromAgentEvents([])).toEqual([]);
    expect(deriveFileOpsFromAgentEvents(events)).toEqual([]);
  });

  it.each([
    ['file_path', 'Read', 'read'], ['filePath', 'read_file', 'read'],
    ['path', 'Write', 'write'], ['filename', 'create_file', 'write'],
    ['target_path', 'Edit', 'edit'], ['targetPath', 'str_replace_edit', 'edit'],
    ['path', 'MultiEdit', 'edit'], ['path', 'multi_edit', 'edit'],
    ['path', 'Delete', 'delete'], ['path', 'delete', 'delete'], ['path', 'delete_file', 'delete'],
    ['path', 'remove_file', 'delete'], ['path', 'rm_file', 'delete'], ['path', 'unlink_file', 'delete'],
  ])('resolves %s for %s without changing path text', (field, name, kind) => {
    expect(deriveFileOpsFromAgentEvents([
      { kind: 'tool_use', id: 'a', name, input: { [field]: ' C:\\src\\a.ts ' } },
    ])).toEqual([{ path: 'a.ts ', fullPath: ' C:\\src\\a.ts ', ops: [kind], status: 'running' }]);
  });

  it('merges unique kinds in first-path order and lets errors outrank running and done', () => {
    const events: AgentEventLike[] = [
      { kind: 'tool_result', toolUseId: 'a', isError: true },
      { kind: 'tool_use', id: 'a', name: 'Read', input: { file_path: null, path: 'src/a.ts' } },
      { kind: 'tool_use', id: 'b', name: 'Read', input: { path: 'src/a.ts' } },
      { kind: 'tool_use', id: 'c', name: 'Edit', input: { path: 'src/a.ts' } },
      { kind: 'tool_result', toolUseId: 'c' },
      { kind: 'tool_use', id: 'd', name: 'Write', input: { path: 'b.ts' } },
      { kind: 'tool_result', toolUseId: 'd', isError: true },
      { kind: 'tool_result', toolUseId: 'd', isError: false },
      { kind: 'tool_result', toolUseId: 'a', isError: false },
      { kind: 'tool_use', id: 'e', name: 'Delete', input: { path: 'src/a.ts' } },
      { kind: 'tool_result', toolUseId: 'e', isError: true },
    ];
    expect(deriveFileOpsFromAgentEvents(events)).toEqual([
      { path: 'a.ts', fullPath: 'src/a.ts', ops: ['read', 'edit', 'delete'], status: 'error' },
      { path: 'b.ts', fullPath: 'b.ts', ops: ['write'], status: 'done' },
    ]);
    expect(deriveFileOpsFromAgentEvents(events.slice(0, 5))).toEqual([
      { path: 'a.ts', fullPath: 'src/a.ts', ops: ['read', 'edit'], status: 'error' },
    ]);
    expect(deriveFileOpsFromAgentEvents(events.slice(1, 5))).toEqual([
      { path: 'a.ts', fullPath: 'src/a.ts', ops: ['read', 'edit'], status: 'running' },
    ]);
    expect(deriveFileOpsFromAgentEvents([
      { kind: 'tool_use', id: 'a', name: 'Read', input: { path: '///' } },
      { kind: 'tool_result', toolUseId: 'a' },
      { kind: 'tool_use', id: 'b', name: 'Edit', input: { path: '///' } },
      { kind: 'tool_result', toolUseId: 'b' },
    ])).toEqual([{ path: '///', fullPath: '///', ops: ['read', 'edit'], status: 'done' }]);
  });

  it.each([
    { runStatus: 'running', active: true, name: '', result: 'none', states: ['running', 'pending', 'pending'], progress: 18 },
    { runStatus: 'running', active: false, name: 'Read', result: 'none', states: ['succeeded', 'pending', 'pending'], progress: 38 },
    { runStatus: 'running', active: false, name: 'Write', result: 'none', states: ['succeeded', 'running', 'pending'], progress: 72 },
    { runStatus: 'running', active: false, name: 'Edit', result: 'done', states: ['succeeded', 'succeeded', 'pending'], progress: 72 },
    { runStatus: 'running', active: false, name: 'Write', result: 'error', states: ['succeeded', 'failed', 'pending'], progress: 72 },
    { runStatus: 'running', active: false, name: 'Read', result: 'error', states: ['succeeded', 'failed', 'pending'], progress: 38 },
    { runStatus: 'succeeded', active: false, name: '', result: 'none', states: ['succeeded', 'succeeded', 'succeeded'], progress: 100 },
    { runStatus: 'failed', active: false, name: '', result: 'none', states: ['pending', 'failed', 'failed'], progress: 100 },
    { runStatus: 'canceled', active: false, name: 'Read', result: 'done', states: ['succeeded', 'failed', 'failed'], progress: 100 },
    { runStatus: 'failed', active: true, name: '', result: 'none', states: ['running', 'pending', 'pending'], progress: 18 },
    { runStatus: 'running', active: false, name: 'Delete', result: 'done', states: ['running', 'pending', 'pending'], progress: 38 },
  ] as const)('preserves fallback steps for $runStatus / $name / $result / active=$active', ({ runStatus, active, name, result, states, progress }) => {
    const events: AgentEventLike[] = [{ kind: 'status', label: 'checking_state', detail: 'a.ts' }];
    if (name) events.push({ kind: 'tool_use', id: 'a', name, input: { path: 'a.ts' } });
    if (result !== 'none') events.push({ kind: 'tool_result', toolUseId: 'a', isError: result === 'error' });
    const secondaryStatus = { none: 'running', done: 'succeeded', error: 'failed' } as const;
    expect(chatActivityToProgressCard({ runStatus, events }, { id: 'card', active })).toEqual({
      id: 'card', status: active ? 'running' : runStatus === 'canceled' ? 'failed' : runStatus,
      detail: 'checking state: a.ts', progress,
      steps: [
        { id: 'read-current-state', label: 'Read current state', status: states[0] },
        { id: 'update-files', label: 'Update files', status: states[1] },
        { id: 'finalize', label: 'Finalize', status: states[2] },
      ],
      ...(name ? { secondaryItems: [{ id: 'a.ts', label: 'a.ts', status: secondaryStatus[result] }] } : {}),
    });
  });

  it('counts any running file op when deciding whether an update is still running', () => {
    const events: AgentEventLike[] = [
      { kind: 'tool_use', id: 'a', name: 'Edit', input: { path: 'a.ts' } },
      { kind: 'tool_result', toolUseId: 'a' },
      { kind: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.ts' } },
    ];
    expect(chatActivityToProgressCard({ events, runStatus: 'running' }, options)?.steps).toEqual([
      { id: 'read-current-state', label: 'Read current state', status: 'succeeded' },
      { id: 'update-files', label: 'Update files', status: 'running' },
      { id: 'finalize', label: 'Finalize', status: 'pending' },
    ]);
  });

  it.each([null, {}, { runStatus: 'queued' }, { runStatus: 'running' }, { runStatus: 'succeeded' }] satisfies (ChatActivityLike | null)[])(
    'omits inactive messages without todos, files, status detail, or failure: %j', (message) => {
      expect(chatActivityToProgressCard(message, options)).toBeNull();
    },
  );

  it('keeps an empty status detail as activity and omits absent optional fields', () => {
    const card = chatActivityToProgressCard({ events: [{ kind: 'status', label: '', detail: '' }] }, options);
    expect(card).toEqual({ id: 'card', status: 'succeeded', detail: '', progress: 100, steps: [
      { id: 'read-current-state', label: 'Read current state', status: 'succeeded' },
      { id: 'update-files', label: 'Update files', status: 'succeeded' },
      { id: 'finalize', label: 'Finalize', status: 'succeeded' },
    ] });
    expect(chatActivityToProgressCard(null, { id: 'card', active: true })).not.toHaveProperty('detail');
  });

  it('prefers explicit todos over fallback steps and maps each status without changing labels or ids', () => {
    const events: AgentEventLike[] = [{ kind: 'tool_use', id: 'a', name: 'TodoWrite', input: { todos: [
      { content: 'same', status: 'completed' }, { content: 'same', status: 'in_progress' },
      { content: 'wait', status: 'pending' }, { content: 'stop', status: 'stopped' },
    ] } }];
    expect(chatActivityToProgressCard({ events, runStatus: 'queued' }, options)).toEqual({
      id: 'card', status: 'running', progress: 38, steps: [
        { id: 'same-0', label: 'same', status: 'succeeded' },
        { id: 'same-1', label: 'same', status: 'running' },
        { id: 'wait-2', label: 'wait', status: 'pending' },
        { id: 'stop-3', label: 'stop', status: 'failed' },
      ],
    });
  });
});
