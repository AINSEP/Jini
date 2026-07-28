/**
 * @module tools
 *
 * Pure tool-lifecycle derivation shared by any host's tool-call renderer.
 * Deliberately does NOT include the renderer-registry/registration
 * mechanism (`registerToolRenderer`/`getToolRenderer` in OD's
 * `runtime/tool-renderers.ts`) — that is a presentational, React-facing
 * extension point that belongs to `@injini/chat-react` (or
 * `@injini/renderers-react`), not this framework-free package. See
 * source-map.md.
 */
import type { ToolResultEvent, ToolUseEvent } from './events.js';

export { dedupeToolUsesById } from './tool-events.js';

/** The four-state tool-call lifecycle agreed across AG-UI / CopilotKit / LangGraph render props. */
export type ToolStatus = 'inProgress' | 'executing' | 'complete' | 'error';

/** The render-prop payload a tool-call UI needs, independent of any framework. */
export interface ToolRenderProps {
  status: ToolStatus;
  name: string;
  args: unknown;
  result: string | undefined;
  /** Mirrors `tool_result.isError`. Terminal failures without a `tool_result` surface via `status: 'error'` instead. */
  isError: boolean;
}

/**
 * Map a tool call to its AG-UI-style lifecycle status.
 *
 * - `error`     — the tool returned with `isError`.
 * - `complete`  — the tool returned cleanly.
 * - `executing` — no result yet and the run is still streaming.
 * - `complete`  — no result yet but the run finished successfully (some
 *   stored assistant turns are missing a trailing `tool_result` even though
 *   the run succeeded).
 * - `error`     — no result after a run that finished unsuccessfully.
 *
 * @param result - The matching `tool_result` event, if one has arrived.
 * @param runStreaming - Whether the owning run is still emitting events.
 * @param runSucceeded - Whether the (already-terminal) run succeeded. Ignored while `runStreaming` is true.
 * @complexity O(1).
 */
export function deriveToolStatus(
  result: ToolResultEvent | undefined,
  runStreaming: boolean,
  runSucceeded = false,
): ToolStatus {
  if (result) return result.isError ? 'error' : 'complete';
  if (runStreaming) return 'executing';
  return runSucceeded ? 'complete' : 'error';
}

/**
 * Project a `tool_use`/`tool_result` pair plus run state into the render-prop
 * shape a tool-call UI consumes.
 *
 * @complexity O(1) — delegates its only branching to {@link deriveToolStatus}.
 */
export function toRenderProps(
  use: ToolUseEvent,
  result: ToolResultEvent | undefined,
  runStreaming: boolean,
  runSucceeded = false,
): ToolRenderProps {
  return {
    status: deriveToolStatus(result, runStreaming, runSucceeded),
    name: use.name,
    args: use.input,
    result: result?.content,
    isError: result?.isError ?? false,
  };
}
