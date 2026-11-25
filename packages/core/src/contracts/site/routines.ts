export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RoutineSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekdays'; time: string; timezone: string }
  | { kind: 'weekly'; time: string; timezone: string; weekday: Weekday };

export interface RoutineRunSummary {
  runId: string;
  trigger: 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  projectId: string;
  conversationId: string;
  agentRunId: string;
  assistantMessageId?: string | null;
  agentId?: string | null;
  model?: string | null;
  summary?: string;
  error?: string;
  errorCode?: string;
  catchUp?: boolean;
  slotAt?: number | null;
  approvalState?: 'none' | 'waiting' | 'approved' | 'declined' | 'expired';
  approvalSince?: number | null;
}

export interface RoutineRow {
  id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  target: { mode: 'create_each_run' } | { mode: 'reuse'; projectId: string };
  skillId: string | null;
  agentId: string | null;
  model: string | null;
  creatorId: string;
  enabled: boolean;
  nextRunAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastRun: RoutineRunSummary | null;
}

export type RoutineAvailability = { state: 'ready' | 'desktop-only' | 'assistant-off' | 'other-window' | 'error' };
