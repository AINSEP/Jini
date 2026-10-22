export const RUN_STATES = [
  'queued',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES: readonly RunState[] = ['succeeded', 'failed', 'cancelled'];

export function isTerminalRunState({ state }: { state: RunState }): boolean {
  return (TERMINAL_RUN_STATES as readonly string[]).includes(state);
}

export interface RunStatus {
  id: string;
  state: RunState;
  label?: string;
  detail?: string;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
}

/** A caller-supplied cancellation request; RunLifecycle ports translate this into subprocess signal delivery. */
export interface RunCancelRequest {
  runId: string;
  reason?: string;
}
