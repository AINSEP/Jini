import { randomUUID } from 'node:crypto';
import type { ToolExecutor, ToolExecutionResult } from '../tool-executor.js';
import type { ToolAttemptEvent, ToolAttemptAuditSink, ToolAuditOptions } from '../tool-audit.js';
import * as implementation from '../tool-audit.js';

export function createInMemoryToolAttemptAuditSink() {
  const events: ToolAttemptEvent[] = [];
  return { events, append: async (event: ToolAttemptEvent) => { events.push(event); } };
}
export const describeInput = (input: unknown) => implementation.describeInput({ input });
export function withToolAttemptAudit(inner: ToolExecutor, sink: ToolAttemptAuditSink, options: ToolAuditOptions & { workspaceId: string; now?: () => string; newAttemptId?: () => string }): ToolExecutor {
  const audited = implementation.withToolAttemptAudit({
    inner, sink, workspaceId: options.workspaceId, now: options.now ?? (() => new Date().toISOString()), newAttemptId: options.newAttemptId ?? randomUUID,
    readErrorId: ({ result }) => { const id = (result as ToolExecutionResult & { errorId?: string }).errorId; return typeof id === 'string' ? id : undefined; },
  }, options);
  return audited;
}
