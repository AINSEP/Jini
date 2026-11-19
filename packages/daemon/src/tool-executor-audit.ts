import type { ToolExecutionPhase, CreateToolExecutorOptions, ToolExecutionAuditRecord, ToolExecutionAuditEvent, ConfirmationDecision } from './tool-executor-types.js';
import type { Principal, RunRef } from '@jini-ai/core';
import { randomUUID } from 'node:crypto';


/**
 * Default cap on finished audit records kept for `getAuditRecord`. One record is added per tool
 * execution and nothing else ever removed one, so a long-lived daemon grew the map for its whole
 * uptime (memory investigation 2026-10-21). An in-flight execution's record is never evicted: its
 * later transitions still have to land on it.
 */
export const DEFAULT_MAX_AUDIT_RECORDS = 1000;

/** Phases after which an execution's audit record receives no further events. */
const TERMINAL_AUDIT_PHASES: ReadonlySet<ToolExecutionPhase> = new Set<ToolExecutionPhase>(['denied', 'confirmation-denied', 'completed', 'failed', 'timed-out', 'cancelled']);

export function createExecutionState(options: CreateToolExecutorOptions) {
  const { registry, delegate = {} } = options;
  const now = options.now ?? Date.now;
  const maxAuditRecords = options.maxAuditRecords ?? DEFAULT_MAX_AUDIT_RECORDS;

  const audits = new Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }>();
  // Finished executionIds, oldest first (Set insertion order): the only records `retireAudit` evicts.
  const finishedAudits = new Set<string>();
  const pendingConfirmations = new Map<string, (decision: ConfirmationDecision) => void>();
  // Owned by the executor, not a bridge: concurrent HTTP/MCP calls create separate bridges.
  const approvalWaits = new Map<string, Map<string, string>>();
  const activeControllers = new Map<string, AbortController>();
  /**
   * Marks a pending confirmation `cancel()` just resolved (as opposed to a genuine human `deny`),
   * so `execute()`'s confirmation branch can report `cancelled` rather than `confirmation-denied`
   * — the latter asserts a decision was made, which is false when nobody was ever asked or the
   * requester vanished before answering. Set and consumed within the same execution's lifetime
   * only; `execute()` always reads-and-clears it (`Set.delete`'s return value) right after
   * `requestConfirmation()` settles, so it can never leak onto a later execution.
   */
  const cancelledConfirmations = new Set<string>();

  return { registry, delegate, now, maxAuditRecords, audits, finishedAudits, pendingConfirmations, approvalWaits, activeControllers, cancelledConfirmations };
}

export function createExecutionRetireAudit({ finishedAudits, maxAuditRecords, audits }: { finishedAudits: Set<string>; maxAuditRecords: number; audits: Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }> }) {
  /** Marks `executionId` finished and evicts the oldest finished records past `maxAuditRecords`. */
  function retireAudit(executionId: string): void {
    finishedAudits.add(executionId);
    while (finishedAudits.size > maxAuditRecords) {
      const oldest = finishedAudits.values().next().value as string;
      finishedAudits.delete(oldest);
      audits.delete(oldest);
    }
  }
  return retireAudit;
}

export function createExecutionAppendEvent({ audits, now, retireAudit }: { audits: Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }>; now: () => number; retireAudit: ReturnType<typeof createExecutionRetireAudit> }) {
  function appendEvent(executionId: string, phase: ToolExecutionPhase, detail?: string): void {
    // Every call site passes an `executionId` this same `execute()` call
    // already registered in `audits` (right before its first `appendEvent`
    // call, below) — a non-null assertion documents that rather than a
    // defensive `if (!record) return` guard with no reachable path to hit it.
    const record = audits.get(executionId)!;
    record.events.push(detail === undefined ? { phase, at: now() } : { phase, at: now(), detail });
    // A terminal transition is each execution's last append (`execute()` returns right after it),
    // so evicting finished records can never pull one out from under a later `appendEvent`.
    if (TERMINAL_AUDIT_PHASES.has(phase)) retireAudit(executionId);
  }
  return appendEvent;
}

export function createExecutionOpenAudit({ audits, appendEvent }: { audits: Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }>; appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /** Opens the audit record for a fresh execution and records the `requested` transition. */
  function openAudit(principal: Principal, run: RunRef, toolId: string): string {
    const executionId = randomUUID();
    audits.set(executionId, {
      executionId,
      toolId,
      principalId: principal.id,
      runId: run.id,
      events: [],
    });
    appendEvent(executionId, 'requested');
    return executionId;
  }
  return openAudit;
}

export function createExecutionGetAuditRecord({ audits }: { audits: Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }> }) {
  function getAuditRecord({ executionId }: { readonly executionId: string }): ToolExecutionAuditRecord | null {
    return audits.get(executionId) ?? null;
  }
  return getAuditRecord;
}
