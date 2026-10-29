import { expect, it } from 'vitest';
import type { RunAgentPayload } from '@jini-ai/protocol';
import { createLiveSessionState } from '../live-session-state.js';

it('retains unknown task outcomes and carries prior run identity and details through sparse updates', () => {
  const events: RunAgentPayload[] = [];
  const state = createLiveSessionState({ emit: event => events.push(event) });
  const observe = (frame: object) => state.observe({ line: JSON.stringify({ type: 'system', ...frame }) });
  observe({ subtype: 'task_updated', task_id: 'new', patch: {} });
  observe({ subtype: 'task_updated', task_id: 'new', patch: { status: 'unexpected' } });
  observe({ subtype: 'task_started', task_id: 'worker', run_id: '002', description: 'Index files', summary: 'Working' });
  observe({ subtype: 'task_updated', task_id: 'worker', patch: {} });
  observe({ subtype: 'task_updated', task_id: 'worker', patch: { status: 'killed' } });
  expect(events).toEqual([
    { type: 'background_task', id: 'new', status: 'unknown' },
    { type: 'background_task', id: 'new', status: 'unknown' },
    { type: 'background_task', id: 'worker', status: 'running', taskRunId: '002', description: 'Index files', detail: 'Working' },
    { type: 'background_task', id: 'worker', status: 'running', taskRunId: '002', description: 'Index files', detail: 'Working' },
    { type: 'background_task', id: 'worker', status: 'stopped', taskRunId: '002', description: 'Index files', detail: 'Working' },
  ]);
});
