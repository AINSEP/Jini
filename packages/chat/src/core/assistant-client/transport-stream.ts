import { captureAgentPluginUsage, type AgentPluginUsage } from '../agent-plugin-chat-state.js';
import type { ChatMessage } from "../messages.js";
import type { RunHandlers } from "../transport.js";
import * as runEvents from "../run-events/entry.js";
import type { RunAgentPayload } from "../run-events/entry.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
import type { AssistantTransportPorts, ByokFrameContext, ByokStreamContext } from "./transport.js";

// The daemon-stream translation (`translateRunAgentPayload`, the terminal notices, `translateRunFrame`)
// lives in `@jini-ai/chat/core/run-events`, extracted from the host's 2026-09-27 contract, so the API's
// run finalizer saves exactly what this transport would have. Re-exported here so existing importers
// and tests keep their paths.

/** The transport's shared closure state: injected ports plus this client's in-flight BYOK controllers.
 * In-flight controllers belong to the client instance, never the package. */
export interface TransportCtx {
  readonly ports: AssistantTransportPorts;
  /** In-flight BYOK turns' abort controllers, keyed by the client-minted runId — the ONLY way
   *  `stopRun` can cancel a BYOK turn: unlike the daemon path, there is no server-side run record to
   *  `POST .../cancel` against, so cancellation has to reach back into THIS tab's own in-flight
   *  `fetch`. Entries are removed as soon as a turn settles (normally, on error, or on abort) so a
   *  stale id can never resurrect a finished controller. */
  readonly byokAbortControllers: Map<string, AbortController>;
}

/** The durable message owns recovery and terminal state; this subscription follows replacement
 * attempts without writing a browser-inferred failure into history. */
export function subscribeToRun(
  { transport, runId, handlers, signal }: { transport: TransportCtx; runId: string; handlers: RunHandlers; signal?: AbortSignal | undefined },
  _optional: Record<string, never> = {},
): void {
  transport.ports.followRun({ runId, handlers: capturePluginUsage({ handlers }), ...(signal === undefined ? {} : { signal }) }, {});
}

/** The well-formed plugin usage an `agent_plugins` extension event carries, or `undefined` for any
 * other event — the one validity rule both live events and checkpoint replays are captured by. */
function pluginUsageOf({ event }: { event: AgentEvent }, _optional: Record<string, never>): AgentPluginUsage | undefined {
  if (event.kind !== 'ext' || event.name !== 'agent_plugins') return undefined;
  const usage = event.data as AgentPluginUsage | undefined;
  return typeof usage?.conversationId === 'string' && usage.state && Array.isArray(usage.state.excluded) ? usage : undefined;
}

/** Capture before notifying the UI so answers received after reload persist for the next turn.
 * Checkpoint panes skip live deltas to avoid duplicate text, so capture their saved events here
 * too. Keep this wrapper as the single capture owner for both delivery contracts.
 * @complexity O(e + s) per checkpoint; O(s) per live event, in saved events and plugin-state size.
 */
export function capturePluginUsage({ handlers }: { handlers: RunHandlers }, _optional: Record<string, never> = {}): RunHandlers {
  const captured = new Map<string, string>();
  const capture = (event: AgentEvent) => {
    const usage = pluginUsageOf({ event }, {});
    if (!usage) return;
    const state = JSON.stringify(usage.state);
    if (captured.get(usage.conversationId) === state) return;
    captured.set(usage.conversationId, state);
    captureAgentPluginUsage({ event });
  };
  return {
    ...handlers,
    onEvent: event => { capture(event); handlers.onEvent(event); },
    ...(handlers.onCheckpoint ? { onCheckpoint: (message: ChatMessage) => {
      // Historical answers must not roll the current state backwards on every poll.
      const latest = new Map<string, AgentEvent>();
      for (const event of message.events ?? []) {
        const usage = pluginUsageOf({ event }, {});
        if (usage) latest.set(usage.conversationId, event);
      }
      for (const event of latest.values()) capture(event);
      handlers.onCheckpoint!(message);
    } } : {}),
  };
}

/**
 * Dispatches one parsed BYOK SSE frame to the right `RunHandlers` call — the `"agent"`/`"error"`/
 * `"end"` handling pulled out of `startByokRun`'s stream-consumer IIFE (2026-08-06, complexity
 * pass), where it sat four levels of nesting deep (async IIFE > `try` > `for await` > `if`/
 * `else if`, with a further nested `if` inside the `"agent"` and `"end"` cases). At module scope it
 * is a single, independently testable function: a plain `{event, data}` frame in, a fake
 * `RunHandlers` to assert against, no `ReadableStream`/`fetch`/timers required.
 *
 * @param ctx.collected - This turn's running event log — the same array `startByokRun` hands to
 *   `handlers.onDone` once the stream ends.
 * @param ctx.finish - `startByokRun`'s own idempotent finish (closes out the turn, deletes its abort
 *   controller, calls `onDone`). Called on `"end"`, exactly as the inline version did.
 */
export function handleByokFrame(
  { transport, frame, ctx }: { transport: TransportCtx; frame: { event: string; data: string }; ctx: ByokFrameContext },
  _optional: Record<string, never> = {},
): void {
  if (frame.event === "agent") {
    const payload = JSON.parse(frame.data) as RunAgentPayload;
    const translated = runEvents.translateRunAgentPayload({ payload }, {});
    if (translated) {
      ctx.collected.push(translated);
      ctx.handlers.onEvent(translated);
    }
  } else if (frame.event === "error") {
    const payload = JSON.parse(frame.data) as { message?: unknown };
    ctx.handlers.onError(new Error(runEvents.asString({ value: payload.message }, {}) || "BYOK turn failed"));
  } else {
    if (frame.event !== "end") return;
    const notice = runEvents.terminalReasonNotice({ reason: runEvents.readTerminalReason({ raw: frame.data, wrapped: false }, {}), notice: transport.ports.notices.toolStepLimit }, {});
    if (notice) {
      ctx.collected.push(notice);
      ctx.handlers.onEvent(notice);
    }
    ctx.finish();
  }
}

/**
 * Drains a BYOK turn's SSE body to completion, dispatching each frame via {@link handleByokFrame}
 * and settling the turn through `ctx.finish` — the async IIFE `startByokRun` used to hold its
 * stream-consumer loop in, pulled out to a top-level function (2026-08-06, complexity pass, second
 * pass). `startByokRun`'s own per-function score is already under the per-function ceiling; this
 * split is for the OTHER metric this repo's complexity ceiling tracks — a tool that rolls a nested
 * closure's branches into its enclosing function's total still counted this IIFE as part of
 * `startByokRun` as long as it stayed physically inside the body. Moving it to a sibling top-level
 * function removes it from that rollup instead of just moving it to a different nested scope (a
 * `const` inside `startByokRun` would not have changed the rollup at all).
 *
 * @param ctx.runId - Only used to clear {@link byokAbortControllers} on a genuine (non-abort)
 *   failure — the abort path itself already deletes its own entry in `startByokRun` before this
 *   runs, so `ctx.runId` here is scoped to the error branch alone.
 * @param ctx.controller - Read only for `.signal.aborted`, to tell a deliberate `stopRun`/composer
 *   abort apart from a real stream failure — same distinction the inline version drew.
 */
export async function consumeByokStream(
  { transport, body, ctx }: { transport: TransportCtx; body: ReadableStream<Uint8Array>; ctx: ByokStreamContext },
  _optional: Record<string, never> = {},
): Promise<void> {
  try {
    for await (const frame of runEvents.readSseFrames({ body }, {})) {
      handleByokFrame({ transport, frame, ctx: { collected: ctx.collected, handlers: ctx.handlers, finish: ctx.finish } });
    }
    ctx.finish();
  } catch (error) {
    transport.byokAbortControllers.delete(ctx.runId);
    if (ctx.controller.signal.aborted) {
      // Cancelled via `stopRun` or the composer's own signal — an expected exit, not a reportable
      // failure. `subscribeToRun`'s `EventSource` has no equivalent branch because `.close()`
      // doesn't reject a promise the way an aborted `fetch`'s body reader does; this mirrors what a
      // cancelled daemon run already looks like to the rest of the pane: silence, not an error toast.
      ctx.finish();
      return;
    }
    // Error THEN finish, same order and same reason as `subscribeToRun`'s `end` listener: reporting
    // alone left the turn unsettled (no `onDone`, so the events collected before the failure were
    // never persisted), and finishing first would record the dead run as succeeded.
    ctx.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    ctx.finish();
  }
}
