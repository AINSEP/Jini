/**
 * `DelegatedToolBridge` — the execution path for agents/protocols that ask
 * Jini to run a registered tool on their behalf. It is deliberately separate
 * from ACP's `session/request_permission`: ACP authorizes an agent's *native*
 * tool loop, whereas this bridge invokes Jini's `ToolExecutor` and therefore
 * enforces Jini's registry policy, confirmation, timeout, cancellation, and
 * audit trail before any registered handler runs.
 */
import { type Principal, type RunRef, type SurfaceEmission } from '@jini-ai/core';
import type { RunAgentPayload } from '@jini-ai/protocol';
import type { RunLifecycle } from './run-lifecycle.js';
import { projectToolResultEvent } from './tool-result-media.js';
import type { DelegatedResultCorrelation } from './delegated-result-correlation.js';
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
   * exactly one matching `tool_result`. Unknown tool ids are input errors
   * from `ToolExecutor` and are rethrown after their error
   * result is recorded.
   */
  execute(requiredArgs: Pick<DelegatedToolInvocation, "runId" | "toolUseId" | "toolId" | "principal" | "input">, optionalArgs?: Pick<DelegatedToolInvocation, "signal">): Promise<ToolExecutionResult>;
}

export interface CreateDelegatedToolBridgeOptions {
  readonly lifecycle: RunLifecycle;
  readonly toolExecutor: ToolExecutor;
  /** Share with the executor and lifecycle only after the host negotiates marker v1. */
  readonly delegatedResultCorrelation?: DelegatedResultCorrelation;
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

export { serializeDelegatedToolOutput, resultContent } from './tool-result-media.js';

/** Context shared by the helpers of one delegated call. */
interface DelegatedCall {
  readonly lifecycle: RunLifecycle;
  readonly delegatedResultCorrelation?: DelegatedResultCorrelation;
  readonly runId: string;
  readonly toolUseId: string;
}

/**
 * Builds the abort controller handed to `ToolExecutor`, aborted by either a run cancellation or the
 * invocation's own transport signal. `dispose()` detaches both listeners once the call settles.
 */
function linkCancellation({ lifecycle, runId }: Pick<DelegatedCall, 'lifecycle' | 'runId'>, { signal }: { readonly signal?: AbortSignal }): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => controller.abort() });
  const abortFromTransport = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromTransport, { once: true });
  return {
    controller,
    dispose: () => {
      unsubscribeCancel();
      signal?.removeEventListener('abort', abortFromTransport);
    },
  };
}

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
function createSurfaceSeam({ lifecycle, runId, toolUseId }: DelegatedCall): { emitSurface: (emission: SurfaceEmission) => Promise<void>; settle: () => void; release: () => void } {
  let settled = false;
  // A handler emits a surface mid-call because it is about to WAIT on the human (a form, a card).
  // Nothing reaches the run's event stream while they answer, so the slow-run watchdog would read
  // that silence as a stall and post "Still working…" over an open form — which then reappears
  // once the form is answered. Suspended from the first surface until the call settles (the
  // `finally` below); the watchdog re-arms then, so a genuine stall afterwards is still caught.
  let slowRunSuspended = false;
  const emitSurface = async (emission: SurfaceEmission): Promise<void> => {
    if (settled) throw new Error(`emitSurface: tool call ${toolUseId} has already completed`);
    if (!slowRunSuspended) {
      slowRunSuspended = true;
      lifecycle.suspendSlowRunNotice({ runId: runId });
    }
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
    await lifecycle.emit({ runId: runId, input: { event: 'agent', data } });
  };
  /** Refuses every later emission: the call has a result. */
  const settle = (): void => {
    settled = true;
  };
  /** Re-arms the slow-run notice if a surface suspended it — run last, once the call's events are out. */
  const release = (): void => {
    if (slowRunSuspended) lifecycle.resumeSlowRunNotice({ runId: runId });
  };
  return { emitSurface, settle, release };
}

/** Splits human-only surfaces out of an executed result, emits them, then the matching `tool_result`. */
async function emitExecutedResult({ lifecycle, runId, toolUseId, delegatedResultCorrelation }: DelegatedCall, { executed }: { readonly executed: ToolExecutionResult }): Promise<ToolExecutionResult> {
    // THE MODEL/HUMAN FORK. A tool call's return value is definitionally what the model
    // receives, so a UI resource left inside it is model-visible context no matter what any
    // downstream layer does — `@jini-ai/mcp`'s `okResult()` JSON.stringifies the whole result
    // into a single text block. This is the only point holding BOTH the raw result and the
    // run's event stream, which is why the split happens here rather than later.
    //
    // Whitelist, not blacklist: only block types known to be model-safe survive into `output`;
    // everything else is withheld and emitted for the human. See `tool-result-surfaces.ts` for
    // why that direction is load-bearing.
  const { modelOutput, surfaces } = splitToolResultSurfaces({ output: executed.output });
  const result: ToolExecutionResult = surfaces.length === 0 ? executed : { ...executed, output: modelOutput };

    // Emitted BEFORE `tool_result` so the surface is on screen by the time the transcript shows
    // the call completing — otherwise the human is asked to confirm something not yet visible.
  for (const surface of surfaces) {
    await lifecycle.emit({ runId: runId, input: {
      event: 'agent',
      data: { type: MCP_UI_EVENT_TYPE, toolUseId, resource: surface },
    } });
  }

  // The return keeps model-visible images; only the stored event removes their duplicate.
  const projection = projectToolResultEvent({ result });
  await lifecycle.emit({ runId: runId, input: {
    event: 'agent',
    data: {
      type: 'tool_result',
      toolUseId,
      ...projection,
    },
  } });
  // Record only after the canonical result is saved; failed emission cannot hide an echo.
  if (result.status === 'completed' && isContentEnvelope(result.output)) {
    delegatedResultCorrelation?.record({ runId, toolUseId, content: result.output.content, isError: projection.isError === true });
  }
  return result;
}

function isContentEnvelope(output: unknown): output is { content: readonly unknown[] } {
  return typeof output === 'object' && output !== null && 'content' in output && Array.isArray(output.content);
}

/**
 * Creates the transport-neutral bridge used by future ACP-delegate, MCP, or
 * other host protocols. This module does not invent a server transport: a
 * concrete protocol calls this bridge after it has decoded and authenticated a
 * delegated tool request.
 */
export function createDelegatedToolBridge(requiredArgs: Pick<CreateDelegatedToolBridgeOptions, 'lifecycle' | 'toolExecutor'>, optionalArgs: Pick<CreateDelegatedToolBridgeOptions, 'delegatedResultCorrelation'> = {}): DelegatedToolBridge {
  const options = { ...requiredArgs, ...optionalArgs };
  // A route may pass its broader deps as options; its wrapped executor remains authoritative.
  const { lifecycle, toolExecutor } = requiredArgs;

  async function execute(requiredArgs: Pick<DelegatedToolInvocation, "runId" | "toolUseId" | "toolId" | "principal" | "input">, optionalArgs: Pick<DelegatedToolInvocation, "signal"> = {}): Promise<ToolExecutionResult> {
    // Merged rather than read from `optionalArgs` alone: a caller may hand `signal` in the first
    // object (the delegated-tools HTTP route does), and it must still be honoured.
    const invocation: DelegatedToolInvocation = { ...requiredArgs, ...optionalArgs };
    const { runId, toolUseId, toolId, principal, input } = invocation;
    const call: DelegatedCall = { lifecycle, runId, toolUseId, ...(options.delegatedResultCorrelation ? { delegatedResultCorrelation: options.delegatedResultCorrelation } : {}) };
    await lifecycle.emit({ runId: runId, input: {
      event: 'agent',
      data: { type: 'tool_use', id: toolUseId, name: toolId, input },
    } });

    const cancellation = linkCancellation(call, invocation);
    const seam = createSurfaceSeam(call);
    const run: RunRef = { id: runId };

    try {
      try {
        const executed = await toolExecutor.execute({ principal: principal, run: run, toolId: toolId, input: input }, { signal: cancellation.controller.signal, emitSurface: seam.emitSurface }
        );
        seam.settle();
        return await emitExecutedResult(call, { executed });
      } catch (error) {
        seam.settle();
        await lifecycle.emit({ runId: runId, input: {
          event: 'agent',
          data: { type: 'tool_result', toolUseId, content: errorMessage(error), isError: true },
        } });
        throw error;
      }
    } finally {
      cancellation.dispose();
      seam.release();
    }
  }

  return { execute };
}
