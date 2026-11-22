import type { ToolExecutor } from "../tool-executor-types.js";

/** A ToolExecutor that replaces only `execute`; confirmation, cancel and audit reads pass straight through to `inner`. */
export function decorateToolExecutor({ inner, execute }: { inner: ToolExecutor; execute: ToolExecutor['execute'] }, _optional: Record<string, never> = {}): ToolExecutor {
  return { execute, resumeConfirmation: (args) => inner.resumeConfirmation(args), cancel: (args) => inner.cancel(args), getAuditRecord: (args) => inner.getAuditRecord(args) };
}
