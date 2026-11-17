/**
 * @module claude-stream
 *
 * Parses Claude Code's `--output-format stream-json --verbose` JSONL stream
 * (with or without `--include-partial-messages`) into a small set of
 * UI-friendly events. With partial messages on, text arrives as
 * `stream_event` deltas; without it (older builds <1.0.86, or any build
 * where the flag isn't passed) text arrives only in the final `assistant`
 * wrapper. We handle both. The UI only needs to know five things:
 *
 *   - status        : high-level lifecycle ("initializing", "requesting",
 *                     "thinking")
 *   - text_delta    : assistant text chunk (gets fed to the artifact parser)
 *   - thinking_delta: extended-thinking chunk (shown in a collapsed block)
 *   - tool_use      : { id, name, input }     (fires when input is complete)
 *   - tool_result   : { toolUseId, content, isError } (camelCase — this is our own emitted
 *                     event shape, not a passthrough of Claude's `tool_use_id`/`is_error` wire
 *                     field names; see the `user`-message handling below)
 *   - usage         : aggregated input/output/cache tokens + cost
 *
 * Callers give us `onEvent({ type, ...payload })`. We track per-content-block
 * state to accumulate partial tool_use input JSON and emit a single
 * `tool_use` event when that block stops.
 *
 * Module layout: functions above `createClaudeStreamHandler` are hoisted,
 * exported, unit-testable pure (or near-pure, dependency-injected) decision
 * logic — they take their inputs explicitly rather than reading them off a
 * closure. `createClaudeStreamHandler` itself, and everything declared
 * inside it, is the genuinely stateful part: per-message id/epoch
 * bookkeeping, the block-accumulation map, and the artifact-echo
 * dedup state machine all mutate several interdependent fields together
 * (see the inline comments on `anonymousMessageEpoch` and
 * `stripDuplicateArtifactText` for the specific invariants), so pulling
 * those out into standalone functions would mean designing an explicit
 * reducer over the whole stream state rather than extracting a helper —
 * a larger, riskier change than this pass makes. They stay as closures,
 * exercised only through `feed`/`flush` in the test suite.
 */

import type { RoleMarkerWarningEvent } from './role-marker-guard.js';
import type { EventSink, McpServerStatus } from './claude-stream-frames.js';
import { createStreamHandlerImpl, type ClaudeStreamHandlerOptions } from './claude-stream-handler.js';

/**
 * Every event `createClaudeStreamHandler` can emit, discriminated on `type`. Exported (via
 * `index.ts`) precisely because it wasn't before: a consumer outside this package previously had
 * only `Record<string, unknown>` to go on, guessed a field name that doesn't exist
 * (`event.text` instead of the real `event.delta` on `text_delta`), and silently lost every
 * streamed token — no type error, no runtime error. Field types stay `unknown` wherever the
 * parser itself never validates that field's shape (e.g. `tool_use.input` is whatever Claude's
 * CLI sent, unchecked) — narrower than that would assert a guarantee this module doesn't actually
 * enforce.
 */
export type ClaudeStreamEvent =
  | {
      type: 'status';
      label: string;
      model?: unknown;
      sessionId?: unknown;
      ttftMs?: number;
      /** Init frames only: each MCP server's connection state as the CLI reported it (see {@link initMcpServers}). */
      mcpServers?: McpServerStatus[];
    }
  | { type: 'text_delta' | 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: unknown; name: unknown; input: unknown }
  | { type: 'tool_input_delta'; id: string; name: string; delta: string }
  | { type: 'tool_result'; toolUseId: unknown; content: string; isError: boolean; delegatedToolUseId?: string; delegatedResultContent?: readonly unknown[] }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'usage'; usage: unknown; costUsd: unknown; cumulativeCostUsd?: number; costSessionId?: string; durationMs: unknown; stopReason: string | null }
  | { type: 'error'; message: string; code: string }
  | { type: 'raw'; line: string }
  | RoleMarkerWarningEvent;


export function createClaudeStreamHandler({ onEvent }: { onEvent: EventSink }, options: ClaudeStreamHandlerOptions = {}
) {
  return createStreamHandlerImpl(onEvent, options);
}
