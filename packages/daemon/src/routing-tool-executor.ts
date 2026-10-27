/**
 * @module routing-tool-executor
 *
 * One `ToolExecutor` over two: tools this process registered run locally, every other id goes to a
 * remote executor (`createRemoteToolExecutor`). The routing key is only "is this id in the local
 * registry". Remote descriptors are never registered locally as executable placeholders, so a
 * remote id can never reach a local handler, and an id nobody knows is refused by the far side's
 * executor exactly as an in-process one would refuse it.
 *
 * Execution ids are not tracked here. `cancel` goes to both executors, each of which ignores ids it
 * does not own; `getAuditRecord` asks the local one first (the remote one has none); and
 * `resumeConfirmation` is local-only because remote confirmations park on the far side. That keeps
 * routing correct without a per-call map that would grow for the life of the process.
 */
import type { ToolExecutor } from './tool-executor.js';

export interface RoutingToolExecutorRequired {
  readonly local: ToolExecutor;
  readonly remote: ToolExecutor;
  /** True when `toolId` is in the local registry. */
  readonly isLocal: (required: { readonly toolId: string }, optional?: Record<string, never>) => boolean;
}

/**
 * Creates the routing executor.
 * @complexity O(1) plus `isLocal`'s own cost per call.
 */
export function createRoutingToolExecutor({ local, remote, isLocal }: RoutingToolExecutorRequired, _optional: Record<string, never> = {}): ToolExecutor {
  return {
    execute: (args, optional) => (isLocal({ toolId: args.toolId }) ? local : remote).execute(args, optional),
    resumeConfirmation: (args) => local.resumeConfirmation(args),
    cancel: (args) => {
      local.cancel(args);
      remote.cancel(args);
    },
    getAuditRecord: (args) => local.getAuditRecord(args) ?? remote.getAuditRecord(args),
  };
}
