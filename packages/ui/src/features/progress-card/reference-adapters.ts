/**
 * Reference adapters mapping two independently-shaped "agent run" inputs onto
 * the generic `ProgressCardData` shape. The input types here are narrow,
 * locally-declared structural subsets (`*Like`) rather than real imports of
 * an external product's contracts package — this package has no dependency
 * on that package, and any host whose real types are a structural superset
 * can pass them in directly. Field-level provenance and what was
 * deliberately dropped (a Bash `rm`-command heuristic from the file-ops
 * derivation) are documented in `packages/ui/archived provenance ledger`.
 *
 * These adapters are shipped as documented reference material, not as the
 * package's primary port surface — a host with its own run/job shape maps
 * directly onto `ProgressCardData` instead of going through these.
 */
import type { ProgressCardItem, ProgressCardData, ProgressStatus } from './types.js';
import { clampProgressPercent } from './rules.js';

// ---------------------------------------------------------------------------
// Agent-event primitives
// ---------------------------------------------------------------------------

export interface AgentToolUseEventLike {
  kind: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface AgentToolResultEventLike {
  kind: 'tool_result';
  toolUseId: string;
  isError?: boolean;
}

export interface AgentStatusEventLike {
  kind: 'status';
  label: string;
  detail?: string;
}

export interface AgentOtherEventLike {
  kind: string;
}

export type AgentEventLike =
  | AgentToolUseEventLike
  | AgentToolResultEventLike
  | AgentStatusEventLike
  | AgentOtherEventLike;

function isToolUseEvent(event: AgentEventLike): event is AgentToolUseEventLike {
  return event.kind === 'tool_use' && 'id' in event && 'name' in event;
}

function isToolResultEvent(event: AgentEventLike): event is AgentToolResultEventLike {
  return event.kind === 'tool_result' && 'toolUseId' in event;
}

function isStatusEvent(event: AgentEventLike): event is AgentStatusEventLike {
  return event.kind === 'status' && 'label' in event;
}

// ---------------------------------------------------------------------------
// Todo/step derivation (ported from the source `runtime/todos.ts`)
// ---------------------------------------------------------------------------

export type TodoStatusLike = 'pending' | 'in_progress' | 'completed' | 'stopped';

export interface TodoItemLike {
  content: string;
  status: TodoStatusLike;
}

const TODO_WRITE_TOOL_NAMES = new Set(['TodoWrite', 'todowrite', 'todo_write', 'update_plan']);

export function isTodoWriteToolName(name: string): boolean {
  return TODO_WRITE_TOOL_NAMES.has(name);
}

function normalizeTodoStatus(status: unknown): TodoStatusLike {
  if (status === 'completed' || status === 'in_progress' || status === 'stopped') return status;
  if (status === 'cancelled' || status === 'canceled' || status === 'failed') return 'stopped';
  return 'pending';
}

export function parseTodoWriteInput(input: unknown): TodoItemLike[] {
  if (!input || typeof input !== 'object') return [];
  const record = input as { todos?: unknown; plan?: unknown };
  const rawItems = Array.isArray(record.todos) ? record.todos : Array.isArray(record.plan) ? record.plan : [];
  return rawItems
    .map((todo): TodoItemLike | null => {
      if (!todo || typeof todo !== 'object') return null;
      const todoRecord = todo as Record<string, unknown>;
      const content =
        typeof todoRecord.content === 'string'
          ? todoRecord.content
          : typeof todoRecord.step === 'string'
            ? todoRecord.step
            : typeof todoRecord.description === 'string'
              ? todoRecord.description
              : typeof todoRecord.label === 'string'
                ? todoRecord.label
                : typeof todoRecord.text === 'string'
                  ? todoRecord.text
                  : '';
      if (!content) return null;
      return { content, status: normalizeTodoStatus(todoRecord.status) };
    })
    .filter((todo): todo is TodoItemLike => todo !== null);
}

export function latestTodosFromAgentEvents(events: AgentEventLike[] | undefined): TodoItemLike[] {
  if (!events) return [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || !isToolUseEvent(event) || !isTodoWriteToolName(event.name)) continue;
    return parseTodoWriteInput(event.input);
  }
  return [];
}

export function latestStatusDetailFromAgentEvents(events: AgentEventLike[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || !isStatusEvent(event)) continue;
    const label = event.label.replace(/[_-]/g, ' ');
    return event.detail ? `${label}: ${event.detail}` : label;
  }
  return null;
}

function todoStatusToProgressStatus(status: TodoStatusLike): ProgressStatus {
  if (status === 'completed') return 'succeeded';
  if (status === 'in_progress') return 'running';
  if (status === 'stopped') return 'failed';
  return 'pending';
}

// ---------------------------------------------------------------------------
// File-op derivation (ported from the source `runtime/file-ops.ts` and
// `runtime/tool-events.ts`, minus the Bash `rm`-command detection heuristic —
// see archived provenance ledger)
// ---------------------------------------------------------------------------

export type FileOpStatusLike = 'running' | 'done' | 'error';
export type FileOpKindLike = 'read' | 'write' | 'edit' | 'delete';

export interface FileOpEntryLike {
  path: string;
  fullPath: string;
  ops: FileOpKindLike[];
  status: FileOpStatusLike;
}

const READ_TOOL_NAMES = new Set(['Read', 'read_file']);
const WRITE_TOOL_NAMES = new Set(['Write', 'create_file']);
const EDIT_TOOL_NAMES = new Set(['Edit', 'str_replace_edit', 'MultiEdit', 'multi_edit']);
const DELETE_TOOL_NAMES = new Set(['Delete', 'delete', 'delete_file', 'remove_file', 'rm_file', 'unlink_file']);

function classifyFileOp(name: string): FileOpKindLike | null {
  if (READ_TOOL_NAMES.has(name)) return 'read';
  if (WRITE_TOOL_NAMES.has(name)) return 'write';
  if (EDIT_TOOL_NAMES.has(name)) return 'edit';
  if (DELETE_TOOL_NAMES.has(name)) return 'delete';
  return null;
}

function extractFileOpPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const filePath =
    record.file_path ?? record.filePath ?? record.path ?? record.filename ?? record.target_path ?? record.targetPath;
  return typeof filePath === 'string' && filePath.trim() ? filePath : null;
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

function mergeFileOpStatus(a: FileOpStatusLike, b: FileOpStatusLike): FileOpStatusLike {
  if (a === 'error' || b === 'error') return 'error';
  if (a === 'running' || b === 'running') return 'running';
  return 'done';
}

/** Drops duplicate `tool_use` events sharing an id, keeping the run's final
 *  attempt for each — a retried tool call otherwise double-counts. */
export function dedupeToolUsesById(events: AgentEventLike[] | undefined): AgentEventLike[] {
  if (!events || events.length === 0) return [];
  const seen = new Set<string>();
  let deduped: AgentEventLike[] | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (isToolUseEvent(event)) {
      if (seen.has(event.id)) {
        if (!deduped) deduped = events.slice(0, index);
        continue;
      }
      seen.add(event.id);
    }
    if (deduped) deduped.push(event);
  }
  return deduped ?? events;
}

export function deriveFileOpsFromAgentEvents(events: AgentEventLike[] | undefined): FileOpEntryLike[] {
  if (!events || events.length === 0) return [];
  const dedupedEvents = dedupeToolUsesById(events);
  const resultByToolUseId = new Map<string, AgentToolResultEventLike>();
  for (const event of dedupedEvents) {
    if (isToolResultEvent(event)) resultByToolUseId.set(event.toolUseId, event);
  }

  const byPath = new Map<string, FileOpEntryLike>();
  for (const event of dedupedEvents) {
    if (!isToolUseEvent(event)) continue;
    const kind = classifyFileOp(event.name);
    if (!kind) continue;
    const fullPath = extractFileOpPath(event.input);
    if (!fullPath) continue;
    const result = resultByToolUseId.get(event.id);
    const status: FileOpStatusLike = result === undefined ? 'running' : result.isError ? 'error' : 'done';
    const existing = byPath.get(fullPath);
    if (existing) {
      if (!existing.ops.includes(kind)) existing.ops.push(kind);
      existing.status = mergeFileOpStatus(existing.status, status);
      continue;
    }
    byPath.set(fullPath, { path: basename(fullPath), fullPath, ops: [kind], status });
  }
  return Array.from(byPath.values());
}

function fileOpStatusToProgressStatus(status: FileOpStatusLike): ProgressStatus {
  if (status === 'error') return 'failed';
  if (status === 'running') return 'running';
  return 'succeeded';
}

// ---------------------------------------------------------------------------
// Adapter 1 — ported from `WorkspaceActivityCard`
// ---------------------------------------------------------------------------

export interface ChatActivityLike {
  events?: AgentEventLike[];
  runStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
}

export interface ChatActivityToProgressCardOptions {
  /** `ProgressCardData.id` — the source has no natural id of its own for
   *  this view (it's derived from a chat message + a live/absent run), so
   *  the host supplies one. */
  id: string;
  /** Whether a run is actively streaming right now, independent of
   *  `runStatus` (mirrors the source's separate `active` prop). */
  active: boolean;
}

function chatActivityStatus(message: ChatActivityLike | null, active: boolean): ProgressStatus {
  if (active || message?.runStatus === 'queued' || message?.runStatus === 'running') return 'running';
  if (message?.runStatus === 'failed' || message?.runStatus === 'canceled') return 'failed';
  return 'succeeded';
}

function chatActivityProgress(status: ProgressStatus, todos: TodoItemLike[], fileOps: FileOpEntryLike[]): number {
  if (status === 'succeeded' || status === 'failed') return 100;
  if (todos.length > 0) {
    const completed = todos.filter((todo) => todo.status === 'completed').length;
    const inProgress = todos.some((todo) => todo.status === 'in_progress') ? 0.5 : 0;
    return Math.max(18, Math.min(92, Math.round(((completed + inProgress) / todos.length) * 100)));
  }
  if (fileOps.some((entry) => entry.ops.includes('write') || entry.ops.includes('edit'))) return 72;
  if (fileOps.length > 0) return 38;
  return 18;
}

function fallbackChatActivitySteps(status: ProgressStatus, fileOps: FileOpEntryLike[]): ProgressCardItem[] {
  const hasRead = fileOps.some((entry) => entry.ops.includes('read'));
  const hasMutation = fileOps.some((entry) => entry.ops.includes('write') || entry.ops.includes('edit'));
  const hasError = status === 'failed' || fileOps.some((entry) => entry.status === 'error');
  return [
    {
      id: 'read-current-state',
      label: 'Read current state',
      status: hasRead || hasMutation || status === 'succeeded' ? 'succeeded' : status === 'running' ? 'running' : 'pending',
    },
    {
      id: 'update-files',
      label: 'Update files',
      status: hasError
        ? 'failed'
        : hasMutation
          ? fileOps.some((entry) => entry.status === 'running')
            ? 'running'
            : 'succeeded'
          : status === 'running'
            ? 'pending'
            : 'succeeded',
    },
    {
      id: 'finalize',
      label: 'Finalize',
      status: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'pending',
    },
  ];
}

/** Maps a chat message's agent-event stream onto `ProgressCardData`. Returns
 *  `null` when there's nothing worth showing (mirrors the source's own
 *  `hasActivity` early-return — a message with no run, no todos, no file
 *  ops, no status detail, and not currently active renders nothing). */
export function chatActivityToProgressCard(
  message: ChatActivityLike | null,
  options: ChatActivityToProgressCardOptions,
): ProgressCardData | null {
  const events = message?.events ?? [];
  const todos = latestTodosFromAgentEvents(events);
  const fileOps = deriveFileOpsFromAgentEvents(events);
  const status = chatActivityStatus(message, options.active);
  const statusDetail = latestStatusDetailFromAgentEvents(events);
  const hasActivity =
    options.active || todos.length > 0 || fileOps.length > 0 || statusDetail !== null || status === 'failed';
  if (!hasActivity) return null;

  const steps: ProgressCardItem[] =
    todos.length > 0
      ? todos.map((todo, index) => ({
          id: `${todo.content}-${index}`,
          label: todo.content,
          status: todoStatusToProgressStatus(todo.status),
        }))
      : fallbackChatActivitySteps(status, fileOps);

  const secondaryItems: ProgressCardItem[] = fileOps.map((entry) => ({
    id: entry.fullPath,
    label: entry.path,
    status: fileOpStatusToProgressStatus(entry.status),
  }));

  return {
    id: options.id,
    status,
    ...(statusDetail !== null ? { detail: statusDetail } : {}),
    progress: chatActivityProgress(status, todos, fileOps),
    steps,
    ...(secondaryItems.length > 0 ? { secondaryItems } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter 2 — ported from `GenerationStatusCard`
// ---------------------------------------------------------------------------

export type DesignSystemGenerationJobStatusLike = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface DesignSystemGenerationJobStepLike {
  id: string;
  title: string;
  status: ProgressStatus;
}

export interface DesignSystemGenerationJobLike {
  id: string;
  status: DesignSystemGenerationJobStatusLike;
  /** 0-100. */
  progress: number;
  steps: DesignSystemGenerationJobStepLike[];
  message?: string;
}

function designSystemGenerationJobStatusToProgressStatus(status: DesignSystemGenerationJobStatusLike): ProgressStatus {
  if (status === 'queued') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'succeeded') return 'succeeded';
  return 'failed'; // 'failed' | 'canceled' — both terminal-non-success, same as the chat-activity adapter
}

/** Maps a generation/revision job onto `ProgressCardData`. Unlike the
 *  chat-activity adapter, this one always has something to show — the
 *  source component is only ever mounted when a job exists. */
export function designSystemGenerationJobToProgressCard(job: DesignSystemGenerationJobLike): ProgressCardData {
  return {
    id: job.id,
    status: designSystemGenerationJobStatusToProgressStatus(job.status),
    ...(job.message !== undefined ? { detail: job.message } : {}),
    progress: clampProgressPercent(job.progress),
    steps: job.steps.map((step) => ({ id: step.id, label: step.title, status: step.status })),
  };
}
