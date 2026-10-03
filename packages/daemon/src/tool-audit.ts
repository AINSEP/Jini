import type { Principal, RunRef, SurfaceEmitter } from '@jini-ai/core';
import type {
  ConfirmationDecision, ToolExecutionAuditRecord, ToolExecutionPhase,
  ToolExecutionResult, ToolExecutionStatus, ToolExecutor,
} from './tool-executor.js';

/** The daemon vocabulary, plus attempts that never acquired an execution ID. */
export type ToolAttemptPhase = Extract<ToolExecutionPhase, 'requested' | ToolExecutionStatus> | 'unknown-tool';
export const TOOL_ATTEMPT_PHASES = [
  'requested', 'completed', 'denied', 'confirmation-denied', 'timed-out', 'cancelled', 'failed', 'unknown-tool',
] as const satisfies readonly ToolAttemptPhase[];

export interface ToolAttemptEvent {
  readonly attemptId: string;
  readonly executionId: string | null;
  readonly workspaceId: string;
  readonly runId: string;
  readonly toolId: string;
  readonly principalId: string;
  readonly phase: ToolAttemptPhase;
  readonly at: string;
  /** Value-free metadata; never raw input, query, output or error text. */
  readonly detail?: string | null;
}
export interface ToolAttemptAuditSink { append(requiredArgs: Pick<ToolAttemptEvent, "attemptId" | "executionId" | "workspaceId" | "runId" | "toolId" | "principalId" | "phase" | "at">, optionalArgs?: Pick<ToolAttemptEvent, "detail">): Promise<void> }
export interface ToolAuditDependencies {
  readonly sink: ToolAttemptAuditSink;
  readonly now: () => string;
  readonly newAttemptId: () => string;
}
export interface ToolAuditOptions { readonly onSinkError?: (error: unknown) => void }

function reportSinkError(error: unknown, options: ToolAuditOptions): void {
  // An observer's reporter is itself an observer: a throwing reporter cannot gate a tool.
  try { options.onSinkError?.(error); } catch { /* execution remains authoritative */ }
}
async function appendSafely(event: ToolAttemptEvent, deps: ToolAuditDependencies, options: ToolAuditOptions): Promise<void> {
  try { await deps.sink.append(event); } catch (error) { reportSinkError(error, options); }
}

export function describeInput({ input }: { readonly input: unknown }): string {
  if (input === null || input === undefined) return `input: ${String(input)}`;
  if (Array.isArray(input)) return `input: an array of ${input.length}`;
  if (typeof input !== 'object') return `input: a ${typeof input}`;
  try {
    const parts = Object.entries(input).map(([key, value]) => Array.isArray(value) ? `${key}[${value.length}]` : key).sort();
    return parts.length === 0 ? 'keys: none' : `keys: ${parts.join(', ')}`;
  } catch { return 'input: an unreadable object'; }
}

export interface AuditedToolExecutor {
  execute(args: { principal: Principal; run: RunRef; toolId: string; input: unknown }, options?: { signal?: AbortSignal; emitSurface?: SurfaceEmitter }): Promise<ToolExecutionResult>;
  resumeConfirmation(args: { executionId: string; decision: ConfirmationDecision }): void;
  cancel(args: { executionId: string }): void;
  getAuditRecord(args: { executionId: string }): ToolExecutionAuditRecord | null;
}

/** Wraps the existing boundary without creating another executor or another phase vocabulary. */
export function withToolAttemptAudit(
  deps: ToolAuditDependencies & { readonly inner: ToolExecutor; readonly workspaceId: string; readonly readErrorId: (args: { result: ToolExecutionResult }) => string | undefined },
  options: ToolAuditOptions = {},
): AuditedToolExecutor {
  return {
    async execute({ principal, run, toolId, input }, { signal, emitSurface } = {}) {
      const base = { attemptId: deps.newAttemptId(), workspaceId: deps.workspaceId, runId: run.id, toolId, principalId: principal.id };
      await appendSafely({ ...base, executionId: null, phase: 'requested', at: deps.now(), detail: describeInput({ input }) }, deps, options);
      let result: ToolExecutionResult;
      try { result = await deps.inner.execute({ principal, run, toolId, input }, {
        ...(signal === undefined ? {} : { signal }),
        ...(emitSurface === undefined ? {} : { emitSurface }),
      }); }
      catch (error) {
        const phase = error instanceof Error && /unknown tool/i.test(error.message) ? 'unknown-tool' : 'failed';
        await appendSafely({ ...base, executionId: null, phase, at: deps.now(), detail: error instanceof Error ? error.name : typeof error }, deps, options);
        throw error;
      }
      let detail: string | null = result.truncated ? 'output truncated' : null;
      // Host error-ID metadata is optional observation, never part of execution success.
      if (detail === null) {
        try { const id = deps.readErrorId({ result }); if (id !== undefined) detail = `errorId=${id}`; }
        catch (error) { reportSinkError(error, options); }
      }
      await appendSafely({ ...base, executionId: result.executionId, phase: result.status, at: deps.now(), detail }, deps, options);
      return result;
    },
    resumeConfirmation: ({ executionId, decision }) => deps.inner.resumeConfirmation({ executionId: executionId, decision: decision }),
    cancel: ({ executionId }) => deps.inner.cancel({ executionId }),
    getAuditRecord: ({ executionId }) => deps.inner.getAuditRecord({ executionId: executionId }),
  };
}

export function searchToolsAuditDetail({ query, limit, hits }: { query: string; limit: number | null; hits: readonly { id: string }[] }): string {
  return JSON.stringify({ queryLength: query.length, limit, resultIds: hits.map(hit => hit.id), resultCount: hits.length });
}
export function describeToolAuditDetail({ id, entry }: { id: string; entry: unknown | null }): string {
  return JSON.stringify({ id, found: entry !== null });
}
export interface ToolCatalogAuditIdentity { readonly workspaceId: string; readonly runId: string; readonly principalId: string }
export interface ToolCatalogAttemptEvent extends ToolCatalogAuditIdentity { readonly toolId: string; readonly detail: string }

export function appendToolCatalogAttempt(
  deps: ToolAuditDependencies & { readonly event: ToolCatalogAttemptEvent }, options: ToolAuditOptions = {},
): void {
  void appendSafely({ ...deps.event, attemptId: deps.newAttemptId(), executionId: null, phase: 'completed', at: deps.now() }, deps, options);
}
/** Structural source port: no database or catalog-provider dependency. */
export interface ToolCatalogAuditSource<Hit extends { id: string }, Entry> {
  search(args: { query: string }, options?: { limit?: number }): readonly Hit[];
  describe(args: { id: string }): Entry | null;
}
export function withToolCatalogAudit<Hit extends { id: string }, Entry>(
  deps: ToolAuditDependencies & { catalog: ToolCatalogAuditSource<Hit, Entry>; identity: ToolCatalogAuditIdentity; searchToolId: string; describeToolId: string },
  options: ToolAuditOptions = {},
) {
  return {
    search({ query }: { query: string }, { limit }: { limit?: number } = {}): readonly Hit[] {
      const hits = deps.catalog.search({ query }, limit === undefined ? {} : { limit });
      appendToolCatalogAttempt({ ...deps, event: { ...deps.identity, toolId: deps.searchToolId, detail: searchToolsAuditDetail({ query, limit: limit ?? null, hits }) } }, options);
      return hits;
    },
    describe({ id }: { id: string }): Entry | null {
      const entry = deps.catalog.describe({ id });
      appendToolCatalogAttempt({ ...deps, event: { ...deps.identity, toolId: deps.describeToolId, detail: describeToolAuditDetail({ id, entry }) } }, options);
      return entry;
    },
  };
}
