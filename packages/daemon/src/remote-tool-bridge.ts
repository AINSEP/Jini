/**
 * `RemoteToolEventRecorder` — lets a tool call that executed in a DIFFERENT process from the one
 * holding this run's `RunLifecycle` still record its `tool_use`/`tool_result` events into that
 * run's own event log, so the run's SSE subscribers (a chat UI, a reattaching client) see it the
 * same way they see a locally-executed delegated tool call.
 *
 * This exists because `DelegatedToolBridge.execute()` (this package's `delegated-tool-bridge.ts`)
 * calls `lifecycle.emit()` directly, in-process — there was previously no way for a caller that
 * executed a tool somewhere else to report the outcome back into this run's log. That absence is
 * what forced `ToolExecutor`/`ToolRegistry`/`RunLifecycle` to all live in one process per run (see
 * this repo's own `tovu-learnings.md` §1a). This module is the missing half: the same two event
 * shapes `DelegatedToolBridge.execute()` already emits (`tool_use` then `tool_result`), exposed as
 * a small, explicit recording API a *transport* (this package does not itself expose one — see
 * `@jini-ai/http-kit`'s `remote-run-events.ts`) can wrap with authentication and call remotely.
 *
 * This does not change how tool execution is authorized. A caller of `recordToolUse`/
 * `recordToolResult` has, by definition, already run the tool through its OWN `ToolExecutor` (with
 * its own `ToolPolicy` gate) before calling this — this module only records that the run's chat UI
 * should reflect. It is not a second execution path and does not itself run anything.
 */
import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { RunLifecycle } from './run-lifecycle.js';

export interface RemoteToolUseRecord {
  /** Stable agent-side correlation id, matched by the following `recordToolResult` call. */
  readonly toolUseId: string;
  /** Jini registry id — never an agent-vendor-specific tool name. */
  readonly toolId: string;
  readonly input: unknown;
}

export interface RemoteToolResultRecord {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface RemoteToolEventRecorder {
  /** Records that a tool call started. Throws (matching `RunLifecycle.emit`) if `runId` is unknown or already terminal. */
  recordToolUse(runId: string, record: RemoteToolUseRecord): Promise<RunProtocolEvent>;
  /** Records that a tool call finished (or failed) — mirrors `DelegatedToolBridge.execute()`'s own `tool_result` shape exactly. */
  recordToolResult(runId: string, record: RemoteToolResultRecord): Promise<RunProtocolEvent>;
}

export interface CreateRemoteToolEventRecorderOptions {
  readonly lifecycle: RunLifecycle;
}

export function createRemoteToolEventRecorder(options: CreateRemoteToolEventRecorderOptions): RemoteToolEventRecorder {
  const { lifecycle } = options;

  return {
    recordToolUse(runId, record) {
      return lifecycle.emit(runId, {
        event: 'agent',
        data: { type: 'tool_use', id: record.toolUseId, name: record.toolId, input: record.input },
      });
    },
    recordToolResult(runId, record) {
      return lifecycle.emit(runId, {
        event: 'agent',
        data: {
          type: 'tool_result',
          toolUseId: record.toolUseId,
          content: record.content,
          ...(record.isError ? { isError: true } : {}),
        },
      });
    },
  };
}
