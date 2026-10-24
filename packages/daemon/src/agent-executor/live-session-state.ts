import type { RunAgentPayload } from '@jini-ai/protocol';
import { isRecord } from './values.js';

type BackgroundTask = Extract<RunAgentPayload, { type: 'background_task' }> & { local: boolean };

/** Parse only records; malformed stdout remains the stream parser's responsibility. */
function frameRecord(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** UUID attribution is a consumption receipt; an echoed user line or HTTP 202 is not. */
function consumedIds(frame: Record<string, unknown>): string[] {
  if (!['assistant', 'stream_event', 'result'].includes(String(frame.type))) return [];
  const ids = Array.isArray(frame.user_message_uuids) ? frame.user_message_uuids : [frame.user_message_uuid];
  return ids.filter((id): id is string => typeof id === 'string');
}

/** Preserve unknown task outcomes rather than guessing success or who stopped them. */
function taskStatus(value: unknown): BackgroundTask['status'] {
  if (value === 'killed') return 'stopped';
  if (value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped') return value;
  return 'unknown';
}

/** Per-process receipts and task projection for the existing stdin lifecycle. O(p + t) retained
 * state for pending inputs and observed tasks; each frame is O(frame size + affected tasks).
 * The injected emitter uses the lifecycle's existing FIFO, preserving ordering with tool output.
 */
export function createLiveSessionState({ emit }: { emit: (payload: RunAgentPayload) => void }, _options = {}) {
  const pending = new Map<string, string>();
  // Ids written since the last result. Only these and the CLI's own queued_turn_count hold stdin:
  // a CLI that never attributes a receipt must not keep the run open forever. Closing after a
  // result is safe for a line still in the pipe: the CLI answers everything written before EOF.
  const unanswered = new Set<string>();
  const tasks = new Map<string, BackgroundTask>();
  let queuedTurns = 0;
  let backgroundTasks = 0;

  function publishTask(task: BackgroundTask): void {
    tasks.set(task.id, task);
    const { local: _local, ...payload } = task;
    emit(payload);
  }

  function taskDetails(frame: Record<string, unknown>, previous: BackgroundTask | undefined) {
    const patch = isRecord(frame.patch) ? frame.patch : frame;
    const description = typeof patch.description === 'string' ? patch.description : previous?.description;
    const detail = typeof frame.summary === 'string' ? frame.summary : previous?.detail;
    const local = frame.task_type === 'local_agent' || typeof frame.subagent_type === 'string' || previous?.local === true;
    return { local, ...(description === undefined ? {} : { description }), ...(detail === undefined ? {} : { detail }) };
  }

  function nextTaskStatus(frame: Record<string, unknown>, previous: BackgroundTask | undefined): BackgroundTask['status'] {
    if (frame.subtype === 'task_started') return 'running';
    const patch = isRecord(frame.patch) ? frame.patch : frame;
    if (patch.status === undefined) return previous?.status ?? 'unknown';
    return taskStatus(patch.status);
  }

  /** Older task runs and duplicate starts cannot overwrite a confirmed terminal receipt. */
  function staleTaskUpdate(previous: BackgroundTask | undefined, taskRunId: string | undefined, status: BackgroundTask['status']): boolean {
    if (!previous) return false;
    // The CLI mints run ids as zero-padded base36 time plus random hex, so they sort by start.
    if (previous.taskRunId && taskRunId && taskRunId < previous.taskRunId) return true;
    const terminal = ['completed', 'failed', 'stopped'].includes(previous.status);
    return terminal && previous.taskRunId === taskRunId && status === 'running';
  }

  function updateTask(frame: Record<string, unknown>): void {
    if (typeof frame.task_id !== 'string') return;
    const previous = tasks.get(frame.task_id);
    const taskRunId = typeof frame.run_id === 'string' ? frame.run_id : previous?.taskRunId;
    const status = nextTaskStatus(frame, previous);
    // Resumed tasks reuse task_id. A late frame from an older run cannot stop its replacement.
    if (staleTaskUpdate(previous, taskRunId, status)) return;
    publishTask({ type: 'background_task', id: frame.task_id, status, ...taskDetails(frame, previous),
      ...(taskRunId === undefined ? {} : { taskRunId }) });
  }

  function updateMembership(frame: Record<string, unknown>): void {
    if (!Array.isArray(frame.tasks)) return;
    backgroundTasks = frame.tasks.length;
    const listed = new Set<string>();
    for (const task of frame.tasks) {
      if (!isRecord(task)) continue;
      if (typeof task.task_id === 'string') listed.add(task.task_id);
      updateTask({ ...task, subtype: 'task_started' });
    }
    // Level and edge notifications have unspecified ordering. Disappearance proves neither
    // completion nor cancellation; a later task_notification supplies the actual outcome.
    for (const task of tasks.values()) {
      if (task.status === 'running' && !listed.has(task.id)) publishTask({ ...task, status: 'unknown', detail: 'status unknown' });
    }
  }

  function consume(frame: Record<string, unknown>): boolean {
    let consumed = false;
    for (const id of consumedIds(frame)) {
      const text = pending.get(id);
      if (text === undefined) continue;
      pending.delete(id);
      unanswered.delete(id);
      emit({ type: 'user_message', id, text, deliveryState: 'consumed' });
      consumed = true;
    }
    return consumed;
  }

  function observe({ line }: { line: string }): { result: boolean; startedInput: boolean } {
    const frame = frameRecord(line);
    if (!frame) return { result: false, startedInput: false };
    const consumed = consume(frame);
    if (frame.type === 'result') {
      queuedTurns = typeof frame.queued_turn_count === 'number' ? Math.max(0, frame.queued_turn_count) : 0;
      unanswered.clear();
    }
    if (frame.type === 'system') observeSystem(frame);
    return { result: frame.type === 'result', startedInput: consumed && frame.type !== 'result' };
  }

  function observeSystem(frame: Record<string, unknown>): void {
    if (frame.subtype === 'background_tasks_changed') updateMembership(frame);
    if (['task_started', 'task_notification', 'task_updated'].includes(String(frame.subtype))) updateTask(frame);
  }

  return {
    queue({ id, text }: { id: string; text: string }): void {
      pending.set(id, text);
      unanswered.add(id);
      emit({ type: 'user_message', id, text, deliveryState: 'queued' });
    },
    observe,
    hasPendingInput: () => unanswered.size > 0 || queuedTurns > 0,
    backgroundTaskCount: () => backgroundTasks,
    endSession(): void {
      for (const task of tasks.values()) {
        if (task.status !== 'running' && task.status !== 'unknown') continue;
        // A task already missing from membership may have completed without a receipt. Only
        // a still-running, process-local subagent is known to stop with this session.
        const stopped = task.local && task.status === 'running';
        publishTask({ ...task, status: stopped ? 'stopped' : 'unknown',
          detail: stopped ? 'Stopped because the agent session ended' : 'status unknown' });
      }
    },
  };
}
