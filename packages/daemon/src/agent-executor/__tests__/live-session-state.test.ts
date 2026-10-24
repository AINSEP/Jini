import { describe, expect, it } from 'vitest';
import type { RunAgentPayload } from '@jini-ai/protocol';
import { createLiveSessionState } from '../live-session-state.js';

function fixture() {
  const events: RunAgentPayload[] = [];
  const session = createLiveSessionState({ emit: event => { events.push(event); } });
  return { events, session, observe: (frame: unknown) => session.observe({ line: JSON.stringify(frame) }) };
}

describe('live session receipts', () => {
  it('consumes merged inputs by UUID exactly once, without treating an echo as consumption', () => {
    const h = fixture();
    h.session.queue({ id: 'one', text: 'same' });
    h.session.queue({ id: 'two', text: 'same' });
    h.observe({ type: 'user', uuid: 'one', message: { content: 'same' } });
    expect(h.session.hasPendingInput()).toBe(true);
    expect(h.events.map(event => (event as { deliveryState?: string }).deliveryState)).toEqual(['queued', 'queued']);
    h.observe({ type: 'result', user_message_uuid: 'two', user_message_uuids: ['one', 'two'], queued_turn_count: 1 });
    expect(h.events.slice(2)).toEqual([
      { type: 'user_message', id: 'one', text: 'same', deliveryState: 'consumed' },
      { type: 'user_message', id: 'two', text: 'same', deliveryState: 'consumed' },
    ]);
    expect(h.session.hasPendingInput()).toBe(true);
    h.observe({ type: 'result', user_message_uuids: ['one', 'two'], queued_turn_count: 0 });
    expect(h.events).toHaveLength(4);
    expect(h.session.hasPendingInput()).toBe(false);
  });

  it('releases the stdin hold at a result without receipts, keeping the bubble queued', () => {
    const h = fixture();
    h.session.queue({ id: 'one', text: 'later' });
    h.observe({ type: 'result', queued_turn_count: 2 });
    expect(h.session.hasPendingInput()).toBe(true);
    h.observe({ type: 'result' });
    expect(h.session.hasPendingInput()).toBe(false);
    h.observe({ type: 'result', user_message_uuids: ['one'] });
    expect(h.events.map(event => (event as { deliveryState?: string }).deliveryState)).toEqual(['queued', 'consumed']);
  });

  it('ignores malformed records and unrelated UUIDs', () => {
    const h = fixture();
    h.session.queue({ id: 'one', text: '' });
    for (const line of ['not-json', 'null', '[]', '42']) h.session.observe({ line });
    h.observe({ type: 'assistant', user_message_uuids: [null, 7, 'unknown'] });
    expect(h.events).toHaveLength(1);
    expect(h.session.hasPendingInput()).toBe(true);
    h.observe({ type: 'stream_event', user_message_uuid: 'one' });
    expect(h.events.at(-1)).toEqual({ type: 'user_message', id: 'one', text: '', deliveryState: 'consumed' });
  });
});

describe('background task outcomes', () => {
  it.each(['completed', 'failed', 'stopped'] as const)('projects a task_notification as %s without changing it on session exit', status => {
    const h = fixture();
    h.observe({ type: 'system', subtype: 'task_started', task_id: 'agent', task_type: 'local_agent', description: 'Review' });
    h.observe({ type: 'system', subtype: 'task_notification', task_id: 'agent', status, summary: 'Agent report' });
    h.session.endSession();
    expect(h.events).toEqual([
      { type: 'background_task', id: 'agent', status: 'running', description: 'Review' },
      { type: 'background_task', id: 'agent', status, description: 'Review', detail: 'Agent report' },
    ]);
  });

  it.each(['mcp_task', 'local_bash', 'local_agent'])('does not infer completion or cessation of %s from membership disappearance', taskType => {
    const h = fixture();
    h.observe({ type: 'system', subtype: 'background_tasks_changed', tasks: [
      { task_id: 'remote', task_type: taskType, description: 'Hosted work' },
    ] });
    expect(h.session.backgroundTaskCount()).toBe(1);
    h.observe({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
    expect(h.session.backgroundTaskCount()).toBe(0);
    expect(h.events.at(-1)).toEqual({ type: 'background_task', id: 'remote', status: 'unknown', description: 'Hosted work', detail: 'status unknown' });
    h.session.endSession();
    expect(h.events.at(-1)).toEqual({ type: 'background_task', id: 'remote', status: 'unknown', description: 'Hosted work', detail: 'status unknown' });
  });

  it('keeps a resumed task running when a prior run reports a late stop', () => {
    const h = fixture();
    h.observe({ type: 'system', subtype: 'task_started', task_id: 'agent', run_id: '002', task_type: 'local_agent' });
    h.observe({ type: 'system', subtype: 'task_notification', task_id: 'agent', run_id: '001', status: 'stopped' });
    expect(h.events).toEqual([{ type: 'background_task', id: 'agent', taskRunId: '002', status: 'running' }]);
    h.observe({ type: 'system', subtype: 'task_updated', task_id: 'agent', run_id: '002', patch: { description: 'Updated' } });
    expect(h.events.at(-1)).toEqual({ type: 'background_task', id: 'agent', taskRunId: '002', status: 'running', description: 'Updated' });
  });

  it('does not let a duplicate start reopen a completed task and normalizes killed to stopped', () => {
    const h = fixture();
    h.observe({ type: 'system', subtype: 'task_notification', task_id: 'agent', status: 'completed' });
    h.observe({ type: 'system', subtype: 'task_started', task_id: 'agent' });
    expect(h.events).toEqual([{ type: 'background_task', id: 'agent', status: 'completed' }]);
    h.observe({ type: 'system', subtype: 'task_updated', task_id: 'other', patch: { status: 'killed' } });
    expect(h.events.at(-1)).toEqual({ type: 'background_task', id: 'other', status: 'stopped' });
  });
});
