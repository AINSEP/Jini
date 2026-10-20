import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import type { DurableRun, DurableRunStore } from '../../../core/durable-runs/ports.js';
import { RECOVERY_WINDOW_MS } from '../../../core/durable-runs/policies.js';
import { CONTINUATION_DIVIDER } from '../../../core/durable-runs/continuation.js';
import type { ChatStore } from '../../ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { attemptCanExecute, createDurableRunStore, RUN_SLOT_BUSY, RunSlotBusyError, savedRunEvents } from '../durable-run-store.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });

interface Harness { store: DurableRunStore; history: ChatStore }
async function setup(): Promise<Harness> {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  return { store: createDurableRunStore({ kernel: f.kernel, isDaemonRunId }), history };
}
const userMessage = { id: 'u1', role: 'user', content: 'hi', createdAt: 90 };
type AcceptInput = Parameters<DurableRunStore['accept']>[0];
function acceptInput(over: Partial<AcceptInput> = {}, context: Record<string, unknown> = { userMessage }): AcceptInput {
  return { conversationId: 'c', messageId: 'a1', runId: 'daemon-1', principalId: 'alice', workspaceId: 'ws', now: 100,
    request: { agentId: 'codex', contextRef: JSON.stringify(context) }, ...over };
}
async function accepted(h: Harness, over: Partial<AcceptInput> = {}): Promise<DurableRun> {
  const run = await h.store.accept(acceptInput(over), {});
  if (!run) throw new Error('fixture acceptance failed');
  return run;
}
interface AttemptRow { recovery_count: number; recovery_deadline: number | null; recovery_elapsed_ms: number; attempt_started_at: number;
  last_progress_at: number; cancel_reason: string | null; session_id: string | null; session_confirmed: number; child_pid: number | null;
  child_started_at: string | null; attempt_base_json: string; engine: string }
const attempt = (id = 'a1') => f.rows<AttemptRow>('SELECT * FROM assistant_run_attempts WHERE message_id = ?', id)[0];
const messageRow = (id = 'a1') => f.rows<{ run_id: string; run_status: string; content: string; events_json: string }>('SELECT * FROM ai_chat_messages WHERE id = ?', id)[0];
/** Legacy assistant row written before acceptance metadata existed. */
async function legacy(h: Harness, message: Partial<ChatMessage> = {}, { dropEvents = false }: { dropEvents?: boolean } = {}): Promise<void> {
  const row: ChatMessage = { id: 'a1', role: 'assistant', content: 'saved', runId: 'daemon-1', runStatus: 'running', createdAt: 50, events: [], ...message };
  if (dropEvents) delete row.events;
  await h.history.appendMessage({ conversationId: 'c', message: row });
}
/** Simulate a concurrent deletion landing between the unlocked probe and the locked re-read:
 * the probe's own load takes the first run lock, the operation's lock is the second. */
function deleteOnLock(id = 'a1'): void {
  const lockKey = f.kernel.lockKey.bind(f.kernel);
  let runLocks = 0;
  vi.spyOn(f.kernel, 'lockKey').mockImplementation(async (key) => {
    if (key.startsWith('chat-run:') && ++runLocks === 2) f.sql('DELETE FROM ai_chat_messages WHERE id = ?', id);
    return lockKey(key);
  });
}

describe('exported helpers', () => {
  it('attemptCanExecute admits only uncanceled queued/running runs', async () => {
    const h = await setup();
    const run = await accepted(h);
    expect(attemptCanExecute({ run: null })).toBe(false);
    expect(attemptCanExecute({ run })).toBe(true);
    expect(attemptCanExecute({ run: { ...run, message: { ...run.message, runStatus: 'running' } } })).toBe(true);
    expect(attemptCanExecute({ run: { ...run, message: { ...run.message, runStatus: 'succeeded' } } })).toBe(false);
    const { runStatus: _omitted, ...statusless } = run.message;
    expect(attemptCanExecute({ run: { ...run, message: statusless } })).toBe(false);
    expect(attemptCanExecute({ run: { ...run, cancelReason: 'user-stop' } })).toBe(false);
  });
  it('savedRunEvents returns parsed arrays and [] for null, non-array or corrupt JSON', () => {
    expect(savedRunEvents({ json: '[{"kind":"text","text":"a"}]' })).toEqual([{ kind: 'text', text: 'a' }]);
    expect(savedRunEvents({ json: null })).toEqual([]);
    expect(savedRunEvents({ json: '{}' })).toEqual([]);
    expect(savedRunEvents({ json: '{' })).toEqual([]);
  });
  it('RunSlotBusyError carries the queued-turn message', () => {
    expect(new RunSlotBusyError().message).toBe(RUN_SLOT_BUSY);
  });
});

describe('accept', () => {
  it('persists the accepted question before a queued daemon answer and returns the run snapshot', async () => {
    const h = await setup();
    const run = await accepted(h);
    expect(run).toMatchObject({ messageId: 'a1', conversationId: 'c', runId: 'daemon-1', workspaceId: 'ws', principalId: 'alice', engine: 'daemon',
      recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: 100, lastProgressAt: 100, cancelReason: null, sessionId: null,
      sessionConfirmed: false, child: null, attemptBase: [], request: acceptInput().request });
    expect(run.message).toMatchObject({ id: 'a1', role: 'assistant', runStatus: 'queued', agentId: 'codex', createdAt: 100, startedAt: 100 });
    expect(run.transcript.map(m => m.id)).toEqual(['u1', 'a1']);
    expect(run.transcript[0]).toMatchObject({ role: 'user', content: 'hi', createdAt: 90 });
  });
  it('stamps the user message with the acceptance clock when the browser sent none and keeps attachments', async () => {
    const h = await setup();
    const attachments = [{ path: 'p', name: 'n', kind: 'image' }];
    const run = await h.store.accept(acceptInput({}, { userMessage: { id: 'u1', role: 'user', content: 'hi', attachments } }), {});
    expect(run?.transcript[0]).toMatchObject({ id: 'u1', createdAt: 100, attachments });
  });
  it('accepts a prompt-only legacy context without inventing a user message', async () => {
    const h = await setup();
    const run = await h.store.accept(acceptInput({ request: { contextRef: JSON.stringify({ prompt: 'p' }) } }), {});
    expect(run?.transcript.map(m => m.id)).toEqual(['a1']);
    expect(run?.message).not.toHaveProperty('agentId');
  });
  it('returns null for a conversation the principal does not own', async () => {
    const h = await setup();
    expect(await h.store.accept(acceptInput({ principalId: 'mallory' }), {})).toBeNull();
    expect(await h.store.accept(acceptInput({ conversationId: 'missing' }), {})).toBeNull();
  });
  it('is idempotent for the same logical turn', async () => {
    const h = await setup();
    const first = await accepted(h);
    expect(await h.store.accept(acceptInput(), {})).toEqual(first);
  });
  it('refuses an existing message id bound to another conversation', async () => {
    const h = await setup();
    await accepted(h);
    await h.history.create({ id: 'c2' });
    expect(await h.store.accept(acceptInput({ conversationId: 'c2' }), {})).toBeNull();
  });
  it('throws RunSlotBusyError while another answer in the chat is still active', async () => {
    const h = await setup();
    await accepted(h);
    await expect(h.store.accept(acceptInput({ messageId: 'a2', runId: 'daemon-2' }, { userMessage: { ...userMessage, id: 'u2' } }), {}))
      .rejects.toThrow(RunSlotBusyError);
  });
  it('refuses a user message that reuses the assistant id', async () => {
    const h = await setup();
    await expect(h.store.accept(acceptInput({}, { userMessage: { ...userMessage, id: 'a1' } }), {})).rejects.toThrow('User and assistant messages must have different IDs');
  });
  it.each([
    ['null', null], ['empty id', { ...userMessage, id: '' }], ['numeric id', { ...userMessage, id: 1 }],
    ['assistant role', { ...userMessage, role: 'assistant' }], ['non-string content', { ...userMessage, content: 1 }],
    ['non-numeric clock', { ...userMessage, createdAt: 'x' }],
  ])('refuses an invalid accepted user message (%s)', async (_name, message) => {
    const h = await setup();
    await expect(h.store.accept(acceptInput({}, { userMessage: message }), {})).rejects.toThrow('Invalid accepted user message');
  });
  it.each([
    ['non-array', {}], ['null entry', [null]], ['numeric path', [{ path: 1, name: 'n', kind: 'file' }]],
    ['numeric name', [{ path: 'p', name: 1, kind: 'file' }]], ['unknown kind', [{ path: 'p', name: 'n', kind: 'video' }]],
  ])('refuses invalid accepted attachments (%s)', async (_name, attachments) => {
    const h = await setup();
    await expect(h.store.accept(acceptInput({}, { userMessage: { ...userMessage, attachments } }), {})).rejects.toThrow('Invalid accepted user attachments');
  });
  it('rolls back when the question id already names an assistant row', async () => {
    const h = await setup();
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'u1', role: 'assistant', content: 'old', runStatus: 'succeeded' } });
    await expect(h.store.accept(acceptInput(), {})).rejects.toThrow('Accepted user message could not be persisted');
    expect(messageRow()).toBeUndefined();
  });
  it('rolls back the question when the answer id already names a user row', async () => {
    const h = await setup();
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'a1', role: 'user', content: 'old' } });
    await expect(h.store.accept(acceptInput(), {})).rejects.toThrow('Accepted assistant message could not be persisted');
    expect(messageRow('u1')).toBeUndefined();
  });
  it('returns null without a question when the answer id collides', async () => {
    const h = await setup();
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'a1', role: 'user', content: 'old' } });
    expect(await h.store.accept(acceptInput({ request: { contextRef: '{}' } }), {})).toBeNull();
    expect(attempt()).toBeUndefined();
  });
});

describe('load and find', () => {
  it('returns null for unknown ids, user rows and assistant rows without a run', async () => {
    const h = await setup();
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'q', role: 'user', content: 'q' } });
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'plain', role: 'assistant', content: 'x' } });
    expect(await h.store.load({ messageId: 'none' }, {})).toBeNull();
    expect(await h.store.load({ messageId: 'q' }, {})).toBeNull();
    expect(await h.store.load({ messageId: 'plain' }, {})).toBeNull();
    expect(await h.store.find({ runId: 'none' }, {})).toBeNull();
  });
  it('derives a legacy daemon run request and recovery defaults from the transcript', async () => {
    const h = await setup();
    await h.history.appendMessage({ conversationId: 'c', message: { id: 'q', role: 'user', content: 'question', createdAt: 40 } });
    await legacy(h, { startedAt: 60 });
    expect(await h.store.load({ messageId: 'a1' }, {})).toMatchObject({ engine: 'daemon', recoveryCount: 0, recoveryDeadline: null,
      attemptStartedAt: 0, lastProgressAt: 60, cancelReason: null, sessionId: null, sessionConfirmed: false, child: null, attemptBase: [],
      request: { agentId: 'claude', contextRef: JSON.stringify({ conversationId: 'c', prompt: 'user: question\n\nassistant: saved' }) } });
  });
  it('labels a legacy request-bound run and falls back to the creation clock and stored agent', async () => {
    const h = await setup();
    await legacy(h, { runId: 'browser-1', agentId: 'gemini' });
    expect(await h.store.load({ messageId: 'a1' }, {})).toMatchObject({ engine: 'request', lastProgressAt: 50, request: { agentId: 'gemini' } });
  });
  it('find filters by principal only when one is given', async () => {
    const h = await setup();
    await accepted(h);
    expect((await h.store.find({ runId: 'daemon-1' }, {}))?.messageId).toBe('a1');
    expect((await h.store.find({ runId: 'daemon-1', principalId: 'alice' }, {}))?.messageId).toBe('a1');
    expect(await h.store.find({ runId: 'daemon-1', principalId: 'mallory' }, {})).toBeNull();
  });
});

describe('owner identity', () => {
  it('reports no principal for a guest-owned run', async () => {
    f = runtimeFixture();
    const guest = createChatHistoryStore({ kernel: f.kernel, scope: { ...scope, ownerKind: 'guest', ownerId: 'hash' }, isDaemonRunId });
    await guest.create({ id: 'g' });
    await guest.appendMessage({ conversationId: 'g', message: { id: 'a1', role: 'assistant', content: '', runId: 'daemon-1', runStatus: 'running' } });
    const store = createDurableRunStore({ kernel: f.kernel, isDaemonRunId });
    expect(await store.load({ messageId: 'a1' }, {})).toMatchObject({ principalId: null, workspaceId: 'ws' });
  });
});

describe('advance', () => {
  async function advanced(h: Harness, events: readonly AgentEvent[], over: Partial<ChatMessage> = {}, options: { dropEvents?: boolean } = {}) {
    await legacy(h, over, options);
    const run = (await h.store.load({ messageId: 'a1' }, {}))!;
    expect(await h.store.advance({ run, nextRunId: 'daemon-2', now: 1_000, events }, {})).toBe(true);
    return { row: messageRow(), attempt: attempt()! };
  }
  it('moves the attempt id by CAS, opens a recovery window and rebases on the divider segment', async () => {
    const h = await setup();
    const { row, attempt: meta } = await advanced(h, [{ kind: 'text', text: 'old' }, { kind: 'text', text: CONTINUATION_DIVIDER }, { kind: 'text', text: 'new' }]);
    expect(row).toMatchObject({ run_id: 'daemon-2', run_status: 'queued' });
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'text', text: CONTINUATION_DIVIDER }, { kind: 'text', text: 'new' }]);
    expect(meta).toMatchObject({ recovery_count: 1, recovery_deadline: 1_000 + RECOVERY_WINDOW_MS, attempt_started_at: 1_000, last_progress_at: 50,
      session_id: null, session_confirmed: 0, engine: 'daemon' });
    expect(JSON.parse(meta.attempt_base_json)).toEqual(JSON.parse(row!.events_json));
  });
  it('rebases on the latest divider when the incoming events carry several', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: CONTINUATION_DIVIDER }, { kind: 'text', text: 'first' }, { kind: 'text', text: CONTINUATION_DIVIDER }, { kind: 'text', text: 'second' }]);
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'text', text: CONTINUATION_DIVIDER }, { kind: 'text', text: 'second' }]);
  });
  it('does not prepend saved content when the saved events already hold text', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: CONTINUATION_DIVIDER }], { events: [{ kind: 'text', text: 'saved' }] });
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'text', text: CONTINUATION_DIVIDER }]);
  });
  it('treats a row without stored events as an empty projection', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: CONTINUATION_DIVIDER }], {}, { dropEvents: true });
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'text', text: CONTINUATION_DIVIDER }]);
  });
  it('does not prepend empty saved content', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: CONTINUATION_DIVIDER }], { content: '' });
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: CONTINUATION_DIVIDER }]);
  });
  it('rebases a visible startup retry under its latest recovery marker', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'status', code: 'run_recovering', label: 'Continuing…' }, { kind: 'text', text: 'after' }]);
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'text', text: CONTINUATION_DIVIDER },
      { kind: 'status', code: 'run_recovering', label: 'Continuing…' }, { kind: 'text', text: 'after' }]);
  });
  it('rebases a silent startup retry with an invisible marker', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'status', label: 'other' }, { kind: 'status', code: 'run_recovering', label: '' }]);
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'status', code: 'run_recovering', label: '' }]);
  });
  it('keeps incoming events that already cover the saved content', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: 'saved and more' }]);
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved and more' }]);
  });
  it('keeps the saved projection over shorter incoming events', async () => {
    const h = await setup();
    const { row } = await advanced(h, [{ kind: 'text', text: 's' }]);
    expect(JSON.parse(row!.events_json)).toEqual([{ kind: 'text', text: 'saved' }]);
  });
  it('keeps an existing recovery deadline and updates the accepted attempt row', async () => {
    const h = await setup();
    const run = await accepted(h);
    f.sql('UPDATE assistant_run_attempts SET recovery_deadline = 5, session_id = ? WHERE message_id = ?', 's', 'a1');
    const current = (await h.store.load({ messageId: 'a1' }, {}))!;
    expect(await h.store.advance({ run: current, nextRunId: 'daemon-2', now: 1_000, events: [] }, {})).toBe(true);
    expect(attempt()).toMatchObject({ recovery_count: 1, recovery_deadline: 5, attempt_started_at: 1_000, session_id: null, last_progress_at: run.lastProgressAt });
  });
  it('refuses stale, canceled, missing and terminal attempts', async () => {
    const h = await setup();
    const run = await accepted(h);
    expect(await h.store.advance({ run: { ...run, runId: 'daemon-0' }, nextRunId: 'daemon-2', now: 1, events: [] }, {})).toBe(false);
    expect(await h.store.advance({ run: { ...run, messageId: 'none' }, nextRunId: 'daemon-2', now: 1, events: [] }, {})).toBe(false);
    f.sql("UPDATE ai_chat_messages SET run_status = 'succeeded' WHERE id = 'a1'");
    expect(await h.store.advance({ run, nextRunId: 'daemon-2', now: 1, events: [] }, {})).toBe(false);
    f.sql("UPDATE ai_chat_messages SET run_status = 'running' WHERE id = 'a1'");
    await h.store.cancel({ runId: 'daemon-1', reason: 'user-stop' }, {});
    expect(await h.store.advance({ run, nextRunId: 'daemon-2', now: 1, events: [] }, {})).toBe(false);
    expect(messageRow()?.run_id).toBe('daemon-1');
  });
});

describe('cancel and cancelPending', () => {
  it('records a cancel reason on an accepted attempt and ignores unknown runs', async () => {
    const h = await setup();
    await accepted(h);
    await h.store.cancel({ runId: 'none', reason: 'x' }, {});
    await h.store.cancel({ runId: 'daemon-1', reason: 'user-stop' }, {});
    expect(attempt()?.cancel_reason).toBe('user-stop');
  });
  it('creates attempt metadata for a legacy run it cancels', async () => {
    const h = await setup();
    await legacy(h);
    await h.store.cancel({ runId: 'daemon-1', reason: 'shutdown' }, {});
    expect(attempt()).toMatchObject({ cancel_reason: 'shutdown', engine: 'daemon', recovery_count: 0, last_progress_at: 50 });
  });
  it('does nothing when the run disappears before its lock is held', async () => {
    const h = await setup();
    await legacy(h);
    deleteOnLock();
    await h.store.cancel({ runId: 'daemon-1', reason: 'x' }, {});
    expect(attempt()).toBeUndefined();
  });
  const pending = (over: Partial<Parameters<DurableRunStore['cancelPending']>[0]> = {}) =>
    ({ conversationId: 'c', messageId: 'a1', runId: 'daemon-1', principalId: 'alice', workspaceId: 'ws', now: 200, ...over });
  it('stops an accepted run for its owner', async () => {
    const h = await setup();
    await accepted(h);
    expect(await h.store.cancelPending(pending(), {})).toMatchObject({ cancelReason: 'user-stop', messageId: 'a1' });
  });
  it('writes a terminal tombstone when stop beats acceptance, making later acceptance a no-op', async () => {
    const h = await setup();
    const run = await h.store.cancelPending(pending(), {});
    expect(run?.message).toMatchObject({ runStatus: 'canceled', endedAt: 200, events: [{ kind: 'status', label: 'Stopped.' }] });
    expect(await h.store.accept(acceptInput(), {})).toEqual(run);
  });
  it('refuses unowned conversations and runs bound elsewhere', async () => {
    const h = await setup();
    expect(await h.store.cancelPending(pending({ principalId: 'mallory' }), {})).toBeNull();
    await accepted(h);
    await h.history.create({ id: 'c2' });
    expect(await h.store.cancelPending(pending({ conversationId: 'c2' }), {})).toBeNull();
    expect(attempt()?.cancel_reason).toBeNull();
  });
});

describe('sessions', () => {
  const sessions = () => f.rows<{ agent_id: string; session_id: string }>('SELECT agent_id, session_id FROM assistant_agent_sessions');
  it('captures a confirmed session with its child process and the conversation locator', async () => {
    const h = await setup();
    await accepted(h);
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's1', child: { pid: 7, startedAt: 't' } }, {})).toBe(true);
    expect(attempt()).toMatchObject({ session_id: 's1', session_confirmed: 1, child_pid: 7, child_started_at: 't' });
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's2', confirmed: false }, {})).toBe(true);
    expect(attempt()).toMatchObject({ session_id: 's2', session_confirmed: 0, child_pid: 7 });
    expect(sessions()).toEqual([{ agent_id: 'codex', session_id: 's2' }]);
    expect(await h.store.load({ messageId: 'a1' }, {})).toMatchObject({ sessionId: 's2', sessionConfirmed: false, child: { pid: 7, startedAt: 't' } });
  });
  it('captures a session for a legacy run under the default agent', async () => {
    const h = await setup();
    await legacy(h);
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {})).toBe(true);
    expect(sessions()).toEqual([{ agent_id: 'claude', session_id: 's1' }]);
    expect(attempt()).toMatchObject({ session_id: 's1', child_pid: null });
  });
  it('refuses unknown, vanished and canceled runs', async () => {
    const h = await setup();
    expect(await h.store.captureSession({ runId: 'none', sessionId: 's' }, {})).toBe(false);
    await accepted(h);
    await h.store.cancel({ runId: 'daemon-1', reason: 'x' }, {});
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's' }, {})).toBe(false);
    deleteOnLock();
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's' }, {})).toBe(false);
    expect(sessions()).toEqual([]);
  });
  it('captures and clears a session under the default agent when the request names none', async () => {
    const h = await setup();
    await accepted(h, { request: { contextRef: '{}' } });
    expect(await h.store.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {})).toBe(true);
    expect(sessions()).toEqual([{ agent_id: 'claude', session_id: 's1' }]);
    await h.store.clearSession({ runId: 'daemon-1', sessionId: 's1' }, {});
    expect(sessions()).toEqual([]);
  });
  it('clears only the matching session', async () => {
    const h = await setup();
    await accepted(h);
    await h.store.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {});
    await h.store.clearSession({ runId: 'daemon-1', sessionId: 'other' }, {});
    expect(attempt()?.session_id).toBe('s1');
    await h.store.clearSession({ runId: 'none', sessionId: 's1' }, {});
    await h.store.clearSession({ runId: 'daemon-1', sessionId: 's1' }, {});
    expect(attempt()).toMatchObject({ session_id: null, session_confirmed: 0 });
    expect(sessions()).toEqual([]);
  });
  it('clearSession does nothing when the run vanishes before its lock', async () => {
    const h = await setup();
    await accepted(h);
    await h.store.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {});
    deleteOnLock();
    await h.store.clearSession({ runId: 'daemon-1', sessionId: 's1' }, {});
    expect(sessions()).toEqual([{ agent_id: 'codex', session_id: 's1' }]);
  });
});

describe('tool guards', () => {
  const guard = (h: Harness, over: Partial<Parameters<DurableRunStore['guardTool']>[0]> = {}) =>
    h.store.guardTool({ runId: 'daemon-1', toolId: 'write', input: { a: 1 }, toolUseId: 't1', ...over }, {});
  it('allows a new call, records it and resets the recovery clock', async () => {
    const h = await setup();
    await accepted(h);
    f.sql('UPDATE assistant_run_attempts SET recovery_count = 2, recovery_deadline = 9, recovery_elapsed_ms = 3 WHERE message_id = ?', 'a1');
    vi.spyOn(Date, 'now').mockReturnValue(777);
    expect(await guard(h)).toBe('allowed');
    expect(JSON.parse(messageRow()!.events_json)).toEqual([{ kind: 'tool_use', id: 't1', name: 'write', input: { a: 1 } }]);
    expect(attempt()).toMatchObject({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: 777 });
  });
  it('records the first tool use on a row without stored events', async () => {
    const h = await setup();
    await legacy(h, {}, { dropEvents: true });
    expect(await guard(h)).toBe('allowed');
    expect(JSON.parse(messageRow()!.events_json)).toEqual([{ kind: 'tool_use', id: 't1', name: 'write', input: { a: 1 } }]);
  });
  it('allows without recording when no tool-use id is given', async () => {
    const h = await setup();
    await accepted(h);
    expect(await h.store.guardTool({ runId: 'daemon-1', toolId: 'write', input: { a: 1 } }, {})).toBe('allowed');
    expect(JSON.parse(messageRow()!.events_json)).toEqual([]);
  });
  it('reports an uncompleted identical call as unknown, from the projection or the attempt base', async () => {
    const h = await setup();
    await accepted(h);
    await guard(h);
    expect(await guard(h, { toolUseId: 't2' })).toBe('unknown');
    f.sql("UPDATE ai_chat_messages SET events_json = '[]' WHERE id = 'a1'");
    f.sql('UPDATE assistant_run_attempts SET attempt_base_json = ? WHERE message_id = ?', JSON.stringify([{ kind: 'tool_use', id: 't0', name: 'write', input: { a: 1 } }]), 'a1');
    expect(await guard(h, { toolUseId: 't2' })).toBe('unknown');
  });
  it('ignores pending calls of other tools and completed identical calls', async () => {
    const h = await setup();
    await accepted(h);
    await guard(h, { toolId: 'other' });
    expect(await guard(h, { toolUseId: 't2' })).toBe('allowed');
    await h.store.completeTool({ runId: 'daemon-1', toolUseId: 't2', content: 'ok' }, {});
    expect(await guard(h, { toolUseId: 't3' })).toBe('allowed');
    expect(JSON.parse(messageRow()!.events_json).at(-2)).toEqual({ kind: 'tool_result', toolUseId: 't2', content: 'ok', isError: false });
  });
  it('reports unknown, canceled and vanished runs as stale', async () => {
    const h = await setup();
    expect(await guard(h)).toBe('stale');
    await accepted(h);
    await h.store.cancel({ runId: 'daemon-1', reason: 'x' }, {});
    expect(await guard(h)).toBe('stale');
    deleteOnLock();
    expect(await guard(h)).toBe('stale');
  });
  it('completeTool ignores unknown and vanished runs', async () => {
    const h = await setup();
    await h.store.completeTool({ runId: 'none', toolUseId: 't', content: 'x' }, {});
    await accepted(h);
    deleteOnLock();
    await h.store.completeTool({ runId: 'daemon-1', toolUseId: 't', content: 'x' }, {});
    expect(messageRow()).toBeUndefined();
  });
});

describe('recoveryClock', () => {
  it('starts a window from the remaining budget and pauses it into elapsed time', async () => {
    const h = await setup();
    await accepted(h);
    f.sql('UPDATE assistant_run_attempts SET recovery_elapsed_ms = 1000 WHERE message_id = ?', 'a1');
    await h.store.recoveryClock({ runId: 'daemon-1', now: 10_000, active: true }, {});
    expect(attempt()).toMatchObject({ recovery_deadline: 10_000 + RECOVERY_WINDOW_MS - 1000, recovery_elapsed_ms: 1000 });
    await h.store.recoveryClock({ runId: 'daemon-1', now: 20_000, active: true }, {});
    expect(attempt()?.recovery_deadline).toBe(10_000 + RECOVERY_WINDOW_MS - 1000);
    await h.store.recoveryClock({ runId: 'daemon-1', now: 12_000, active: false }, {});
    expect(attempt()).toMatchObject({ recovery_deadline: null, recovery_elapsed_ms: 3000 });
    await h.store.recoveryClock({ runId: 'daemon-1', now: 50_000, active: false }, {});
    expect(attempt()).toMatchObject({ recovery_deadline: null, recovery_elapsed_ms: 3000 });
  });
  it('never yields a negative budget or elapsed time', async () => {
    const h = await setup();
    await accepted(h);
    f.sql('UPDATE assistant_run_attempts SET recovery_elapsed_ms = ? WHERE message_id = ?', RECOVERY_WINDOW_MS + 5, 'a1');
    await h.store.recoveryClock({ runId: 'daemon-1', now: 10, active: true }, {});
    expect(attempt()?.recovery_deadline).toBe(10);
    f.sql('UPDATE assistant_run_attempts SET recovery_deadline = ? WHERE message_id = ?', 10 + RECOVERY_WINDOW_MS * 2, 'a1');
    await h.store.recoveryClock({ runId: 'daemon-1', now: 10, active: false }, {});
    expect(attempt()?.recovery_elapsed_ms).toBe(0);
  });
  it('creates attempt metadata for a legacy run', async () => {
    const h = await setup();
    await legacy(h);
    await h.store.recoveryClock({ runId: 'daemon-1', now: 10, active: true }, {});
    expect(attempt()).toMatchObject({ recovery_deadline: 10 + RECOVERY_WINDOW_MS, recovery_elapsed_ms: 0, engine: 'daemon' });
  });
  it('ignores unknown and vanished runs', async () => {
    const h = await setup();
    await h.store.recoveryClock({ runId: 'none', now: 10, active: true }, {});
    await legacy(h);
    deleteOnLock();
    await h.store.recoveryClock({ runId: 'daemon-1', now: 10, active: true }, {});
    expect(f.rows('SELECT * FROM assistant_run_attempts')).toEqual([]);
  });
});
