import { expect, test } from 'vitest';
import type { RunAgentPayload } from '@jini-ai/protocol';
import { createLiveSessionState } from '../live-session-state.js';

test('session exit stops a running local agent but preserves uncertainty for remote work', () => {
  const events: RunAgentPayload[] = [];
  const state = createLiveSessionState({ emit: event => events.push(event) });
  state.observe({ line: JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 'local', subagent_type: 'reviewer', description: 'Review' }) });
  state.observe({ line: JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 'remote', task_type: 'mcp_task' }) });
  state.endSession();
  expect(events).toEqual([
    { type: 'background_task', id: 'local', status: 'running', description: 'Review' },
    { type: 'background_task', id: 'remote', status: 'running' },
    { type: 'background_task', id: 'local', status: 'stopped', description: 'Review', detail: 'Stopped because the agent session ended' },
    { type: 'background_task', id: 'remote', status: 'unknown', detail: 'status unknown' },
  ]);
  state.endSession();
  expect(events.filter(event => event.type === 'background_task' && event.id === 'local')).toHaveLength(2);
});

test('unknown task patches retain descriptions and summaries without inferring completion', () => {
  const events: RunAgentPayload[] = [];
  const state = createLiveSessionState({ emit: event => events.push(event) });
  state.observe({ line: JSON.stringify({ type: 'system', subtype: 'task_updated', task_id: 'task', patch: { description: 'First', status: 'queued' }, summary: 'Waiting' }) });
  state.observe({ line: JSON.stringify({ type: 'system', subtype: 'task_updated', task_id: 'task', patch: { status: 'vendor-state' } }) });
  expect(events).toEqual([
    { type: 'background_task', id: 'task', status: 'unknown', description: 'First', detail: 'Waiting' },
    { type: 'background_task', id: 'task', status: 'unknown', description: 'First', detail: 'Waiting' },
  ]);
});
