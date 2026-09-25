/**
 * `DelegatedToolBridge` — the execution path for agents/protocols that ask
 * Jini to run a registered tool on their behalf. It is deliberately separate
 * from ACP's `session/request_permission`: ACP authorizes an agent's *native*
 * tool loop, whereas this bridge invokes Jini's `ToolExecutor` and therefore
 * enforces Jini's registry policy, confirmation, timeout, cancellation, and
 * audit trail before any registered handler runs.
 */
import type { Principal, RunRef, SurfaceEmission } from '@jini-ai/core';
import type { RunAgentPayload } from '@jini-ai/protocol';
import type { RunLifecycle } from './run-lifecycle.js';
import { extractResultMedia } from './tool-result-media.js';
import { splitToolResultSurfaces } from './tool-result-surfaces.js';
import type { ToolExecutionResult, ToolExecutor } from './tool-executor.js';

/**
 * Run-protocol `type` for a human-only surface withheld from a tool result.
 *
 * Named for the ext-event a chat host renders it through (`@jini-ai/chat`'s
 * `MCP_UI_EXT_EVENT_NAME`), so a host that already registered
 * `registerMcpUiSurfaceRenderer()` picks these up with no further wiring.
 */
export const MCP_UI_EVENT_TYPE = 'mcp-ui';

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

/**
 * Channels whose run-event payload declares a `toolUseId`, and therefore want the bridge to supply
 * it.
 *
 * Correlation genuinely differs per channel rather than being universal, so injecting `toolUseId`
 * everywhere would put a field on the wire that the channel's own schema does not declare. The other
 * channels carry their own handle instead — A2UI correlates by `surfaceId`, and so does the
 * protocol's `surface_request`/`surface_response` pair — and a handler driving those sets it from
 * the exchange it opened, which is a strictly better correlation than `toolUseId` anyway: it
 * survives across the several messages one exchange sends.
 *
 * A one-line addition is all a new `toolUseId`-carrying channel needs. Kept explicit rather than
 * inferred so that decision stays visible.
 */
const CHANNELS_CARRYING_TOOL_USE_ID: ReadonlySet<string> = new Set([MCP_UI_EVENT_TYPE]);

function correlationFor(channel: string, toolUseId: string): { toolUseId?: string } {
  return CHANNELS_CARRYING_TOOL_USE_ID.has(channel) ? { toolUseId } : {};
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

    /**
     * The seam a handler needs in order to show something it then WAITS on.
     *
     * Surfaces normally ride out in the return value and are split out below — which is useless to a
     * handler that cannot return until the human has answered the very thing it wants to display.
     * Emitting through here reaches the same run event stream, so a message pushed mid-call is
     * indistinguishable to a renderer from one carried by the result.
     *
     * **Channel-neutral by construction.** The handler names its own channel, and this only injects
     * correlation. That is what lets one seam drive `mcp-ui`, A2UI's multi-turn envelope
     * (`createSurface` → `updateComponents` → …), the protocol's own `surface_request`/
     * `surface_response` pair, or a channel invented later — none of which this file needs to know
     * the shape of, matching `@jini-ai/protocol`'s own posture of typing each channel's body
     * `unknown` and validating where the concrete type is known.
     *
     * Callable any number of times before the call settles; refused after. A handler that stashed
     * this emitter could otherwise paint a surface onto a run whose `tool_result` is already on
     * screen, with no call left to answer it.
     */
    let settled = false;
    const emitSurface = async (emission: SurfaceEmission): Promise<void> => {
      if (settled) throw new Error(`emitSurface: tool call ${toolUseId} has already completed`);
      // Cast because `RunAgentPayload` is a closed union and `channel` is deliberately an open
      // string — a seam that only accepts channels this file already knows about is not a
      // channel-neutral seam. This mirrors `@jini-ai/protocol`'s own posture of typing each
      // channel's BODY `unknown` and validating where the concrete type is known, applied one level
      // up to the channel name itself.
      //
      // Blast radius of a bogus channel is bounded and worth stating: this path is human-only, so
      // the failure mode is an event no renderer subscribes to — nothing rendered. It cannot put
      // anything into model context, which is the property that would actually matter.
      //
      // That bound holds only for an UNKNOWN channel, which is why the spread order below matters.
      // `payload` used to be spread LAST, so a handler could set `type` to a channel this bridge
      // does know — `tool_result`, `mcp-ui` — and set `toolUseId` to a DIFFERENT call's, producing
      // a well-formed forged event correlated against someone else's tool call. The cast is what
      // let it past the closed `RunAgentPayload` union unnoticed. `SurfaceEmission.payload` is
      // documented as "the channel's own fields, merged into the emitted event BESIDE `type`" —
      // beside, not over — so both reserved keys are stripped rather than merely out-ordered.
      // Stripping, not reordering: `correlationFor` returns `{}` for a channel that carries no
      // `toolUseId`, so spread order alone would still let a payload smuggle one onto those.
      const safePayload: Record<string, unknown> = { ...emission.payload };
      delete safePayload['type'];
      delete safePayload['toolUseId'];
      const data = {
        ...safePayload,
        type: emission.channel,
        ...correlationFor(emission.channel, toolUseId),
      } as unknown as RunAgentPayload;
      await lifecycle.emit(runId, { event: 'agent', data });
    };

    try {
      try {
        const executed = await toolExecutor.execute(
          principal,
          run,
          toolId,
          input,
          controller.signal,
          emitSurface,
        );
        settled = true;

        // Recognized media blocks (images) are collected here purely to populate the sibling
        // `media` field the `tool_result` event carries below, for a UI that wants to render one
        // inline without re-parsing `content` (`ToolCard`'s `<img>`, per `assistant_demo_image`'s
        // own doc). This does NOT remove the image block from `executed.output` — `image` is one
        // of `tool-result-surfaces.ts`'s own `MODEL_VISIBLE_BLOCK_TYPES`, so the split below already
        // keeps it in `modelOutput` on its own. An image reaching the model IS the point
        // (`assistant_demo_image`/`admin.capture_screenshot` exist to prove exactly that round
        // trip) — unlike an `mcp-ui` resource, which is genuinely human-only and must never survive
        // into `modelOutput`. (Earlier this extraction fed its own de-imaged `remainder` into the
        // surfaces split below and discarded the image from `output` entirely, on the assumption
        // that the sibling `media` field was the only channel a caller needed — true for a UI
        // reading the run's event stream, false for `@jini-ai/mcp`'s `execute_delegated_tool`, which
        // hands the bridge's RETURN VALUE to the model with no access to that event stream at all.)
        const { media } = extractResultMedia(executed.output);

        // THE MODEL/HUMAN FORK. A tool call's return value is definitionally what the model
        // receives, so a UI resource left inside it is model-visible context no matter what any
        // downstream layer does — `@jini-ai/mcp`'s `okResult()` JSON.stringifies the whole result
        // into a single text block. This is the only point holding BOTH the raw result and the
        // run's event stream, which is why the split happens here rather than later.
        //
        // Whitelist, not blacklist: only block types known to be model-safe survive into `output`;
        // everything else is withheld and emitted for the human. See `tool-result-surfaces.ts` for
        // why that direction is load-bearing.
        const { modelOutput, surfaces } = splitToolResultSurfaces(executed.output);
        const result: ToolExecutionResult = surfaces.length === 0 ? executed : { ...executed, output: modelOutput };

        // Emitted BEFORE `tool_result` so the surface is on screen by the time the transcript shows
        // the call completing — otherwise the human is asked to confirm something not yet visible.
        for (const surface of surfaces) {
          await lifecycle.emit(runId, {
            event: 'agent',
            data: { type: MCP_UI_EVENT_TYPE, toolUseId, resource: surface },
          });
        }

        await lifecycle.emit(runId, {
          event: 'agent',
          data: {
            type: 'tool_result',
            toolUseId,
            content: resultContent(result),
            ...(result.status === 'completed' ? {} : { isError: true }),
            ...(media.length > 0 ? { media } : {}),
          },
        });
        return result;
      } catch (error) {
        settled = true;
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
