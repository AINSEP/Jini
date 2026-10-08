import type { Principal, RunRef, SurfaceEmitter } from '@jini-ai/core';
import type {
  ConfirmationDecision, ToolExecutionAuditRecord, ToolExecutionPhase,
  ToolExecutionResult, ToolExecutionStatus, ToolExecutor,
} from '../tool-executor.js';

/** The daemon vocabulary, plus attempts that never acquired an execution ID. */
/** Execution telemetry never proves a mutation occurred; domain revisions own write provenance. */
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

/** Retain key names and array lengths, never operator values; unreadable objects are summarized
 * without throwing. The durable trail needs only enough metadata to distinguish attempts. */
export function describeInput({ input }: { readonly input: unknown }, _optional: Record<string, never> = {}): string {
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
  resumeConfirmation(args: { executionId: string; decision: ConfirmationDecision }, optional?: Record<string, never>): void;
  cancel(args: { executionId: string }, optional?: Record<string, never>): void;
  getAuditRecord(args: { executionId: string }, optional?: Record<string, never>): ToolExecutionAuditRecord | null;
}

/** Append requested BEFORE delegation: unknown tools and throwing authorization have no execution
 * record yet, and wrapping a handler would miss denied/confirmed attempts. The executor's own
 * in-memory audit remains authoritative for getAuditRecord; an injected sink can retain history.
 * Audit observes rather than gates: sink/reporting failures never alter execution outcomes.
 * ADR-021 §2 keeps authorization with ToolPolicy.authorize and the domain evaluator.
 * Forward emitSurface unchanged or human-answer tools would silently take their fallback path.
 * Settled details retain truncation or an errorId link, never error text or operator content. */
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
        // The boundary exposes no typed unknown-tool error. Wording drift loses only label
        // precision, never the row or execution behavior; retain the error class, not its message.
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

/** Keep ids in returned rank order and record queryLength/limit, never raw query text, scores
 * or descriptions: a pasted secret must not become durable audit content. */
export function searchToolsAuditDetail({ query, limit, hits }: { query: string; limit: number | null; hits: readonly { id: string }[] }, _optional: Record<string, never> = {}): string {
  return JSON.stringify({ queryLength: query.length, limit, resultIds: hits.map(hit => hit.id), resultCount: hits.length });
}
/** Id and found flag suffice; repeating the entry schema/description adds no diagnostic value. */
export function describeToolAuditDetail({ id, entry }: { id: string; entry: unknown | null }, _optional: Record<string, never> = {}): string {
  return JSON.stringify({ id, found: entry !== null });
}
export interface ToolCatalogAuditIdentity { readonly workspaceId: string; readonly runId: string; readonly principalId: string }
export interface ToolCatalogAttemptEvent extends ToolCatalogAuditIdentity { readonly toolId: string; readonly detail: string }

/** Catalog reads bypass ToolExecutor and therefore need their own observation. Fire without
 * awaiting so synchronous catalog calls stay synchronous; appendSafely contains sink failures.
 * Completed is a read phase, not an authorization/confirmation lifecycle. */
export function appendToolCatalogAttempt(
  deps: ToolAuditDependencies & { readonly event: ToolCatalogAttemptEvent }, options: ToolAuditOptions = {},
): void {
  void appendSafely({ ...deps.event, attemptId: deps.newAttemptId(), executionId: null, phase: 'completed', at: deps.now() }, deps, options);
}
/** Structural source port: no database or catalog-provider dependency. */
export interface ToolCatalogAuditSource<Hit extends { id: string }, Entry> {
  search(args: { query: string }, options?: { limit?: number }): readonly Hit[];
  describe(args: { id: string }, optional?: Record<string, never>): Entry | null;
}
/** Preserve catalog results/ranking while appending under the supplied fixed identity. Hosts
 * with per-call attribution use appendToolCatalogAttempt directly; no identity is inferred here. */
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

