/**
 * `DelegatedToolBridge` — the execution path for agents/protocols that ask
 * Jini to run a registered tool on their behalf. It is deliberately separate
 * from ACP's `session/request_permission`: ACP authorizes an agent's *native*
 * tool loop, whereas this bridge invokes Jini's `ToolExecutor` and therefore
 * enforces Jini's registry policy, confirmation, timeout, cancellation, and
 * audit trail before any registered handler runs.
 */
import type { Principal, RunRef } from '@jini-ai/core';
import type { RunLifecycle } from './run-lifecycle.js';
import type { ToolExecutionResult, ToolExecutor } from './tool-executor.js';

/** A tool request received through a Jini-owned delegated-execution protocol. */
export interface DelegatedToolInvocation {
  /** The already-started run that owns the request. */
  readonly runId: string;
  /** Stable agent-side correlation id, mirrored in run `tool_use`/`tool_result` events. */
  readonly toolUseId: string;
  /** Jini registry id — never an agent-vendor-specific tool name. */
  readonly toolId: string;
  readonly principal: Principal;
  readonly input: unknown;
  /** Optional transport disconnect/abort signal, combined with run cancellation. */
  readonly signal?: AbortSignal;
}

export interface DelegatedToolBridge {
  /**
   * Emits a canonical `tool_use`, executes through `ToolExecutor`, then emits
   * exactly one matching `tool_result`. Unknown tool ids remain programmer or
   * routing errors from `ToolExecutor` and are rethrown after their error
   * result is recorded.
   */
  execute(invocation: DelegatedToolInvocation): Promise<ToolExecutionResult>;
}

export interface CreateDelegatedToolBridgeOptions {
  readonly lifecycle: RunLifecycle;
  readonly toolExecutor: ToolExecutor;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Converts arbitrary registered-tool output into the string-bearing run protocol. */
export function serializeDelegatedToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined) return '';
  try {
    const serialized = JSON.stringify(output);
    return serialized === undefined ? String(output) : serialized;
  } catch {
    return String(output);
  }
}

/**
 * Maps a `ToolExecutionResult`'s status to the string a delegated-tool caller (this bridge, or
 * gap 3's stdin-tool-result injector in `agent-executor.ts`) reports back as the tool's visible
 * output/failure reason. Exported so both real callers share one mapping rather than drifting.
 */
export function resultContent(result: ToolExecutionResult): string {
  switch (result.status) {
    case 'completed':
      return serializeDelegatedToolOutput(result.output);
    case 'denied':
      return 'Tool execution denied by policy.';
    case 'confirmation-denied':
      return 'Tool execution denied during confirmation.';
    case 'timed-out':
      return 'Tool execution timed out.';
    case 'cancelled':
      return 'Tool execution cancelled.';
    case 'failed':
      return result.error ?? 'Tool execution failed.';
  }
}

/**
 * Creates the transport-neutral bridge used by future ACP-delegate, MCP, or
 * other host protocols. This module does not invent a server transport: a
 * concrete protocol calls this bridge after it has decoded and authenticated a
 * delegated tool request.
 */
export function createDelegatedToolBridge(options: CreateDelegatedToolBridgeOptions): DelegatedToolBridge {
  const { lifecycle, toolExecutor } = options;

  async function execute(invocation: DelegatedToolInvocation): Promise<ToolExecutionResult> {
    const { runId, toolUseId, toolId, principal, input } = invocation;
    await lifecycle.emit(runId, {
      event: 'agent',
      data: { type: 'tool_use', id: toolUseId, name: toolId, input },
    });

    const controller = new AbortController();
    const unsubscribeCancel = lifecycle.onCancelRequested(runId, () => controller.abort());
    const abortFromTransport = () => controller.abort();
    if (invocation.signal) {
      if (invocation.signal.aborted) controller.abort();
      else invocation.signal.addEventListener('abort', abortFromTransport, { once: true });
    }

    const run: RunRef = { id: runId };
    try {
      try {
        const result = await toolExecutor.execute(principal, run, toolId, input, controller.signal);
        await lifecycle.emit(runId, {
          event: 'agent',
          data: {
            type: 'tool_result',
            toolUseId,
            content: resultContent(result),
            ...(result.status === 'completed' ? {} : { isError: true }),
          },
        });
        return result;
      } catch (error) {
        await lifecycle.emit(runId, {
          event: 'agent',
          data: { type: 'tool_result', toolUseId, content: errorMessage(error), isError: true },
        });
        throw error;
      }
    } finally {
      unsubscribeCancel();
      invocation.signal?.removeEventListener('abort', abortFromTransport);
    }
  }

  return { execute };
}
