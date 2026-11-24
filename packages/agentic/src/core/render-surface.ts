/**
 * @file Draw one arbitrary A2UI component tree on a live surface channel, once, with no scripted
 * follow-up, and report whether the renderer refused it. The caller passes a flat `components` array
 * (`{id, component, ...props}`, children referenced by id, exactly one `root`) learned from its own
 * component search/describe tools. The host owns the tool id, permission and model-facing notes.
 */
import { buildDomainRegistrations, indexCatalogById } from '@jini-ai/core';
import type { AgentToolDefinition, DerivedRiskByToolId, SurfaceEmitter, SurfaceExchange, SurfaceExchangeStore, SurfaceMessage, ToolExecutionContext, ToolHandler, ToolMetadataById, ToolRegistration } from '@jini-ai/core';
import type { createLabCatalog, parseAgentToRendererMessage, ActionMessagePayload, AgentToRendererMessage } from '@jini-ai/protocol/a2ui';

/**
 * The protocol's agent-to-renderer parser, supplied by the host. The surface helpers take it (and
 * the catalog) as arguments so this package keeps a type-only edge on the protocol package.
 */
export type ParseAgentToRendererMessage = typeof parseAgentToRendererMessage;

/** The slice of a catalog (`createLabCatalog`'s result) a surface is created against. */
export type A2uiSurfaceCatalog = Pick<ReturnType<typeof createLabCatalog>, 'catalogId'>;

/**
 * How long to wait, after sending a surface's components, for the renderer to report it rejected them
 * before giving up waiting and assuming the render succeeded.
 *
 * There is no success acknowledgment on this channel: only a renderer relaying a catalog-validation
 * refusal (through the same action pipe a button click uses) ever sends anything back. So
 * `exchange.receive()` alone would hang for the full idle TTL on every successful render. Racing it
 * against a short timer turns "wait forever for a message that isn't coming" into "wait a bit, then
 * assume the silence means it worked": long enough for a same-origin round trip (interpreter
 * validation is synchronous; the only latency is the relay POST), short enough not to stall the
 * model on every ordinary, successful draw.
 */
export const DEFAULT_RENDER_REJECTION_GRACE_MS = 4000;

export type RenderA2uiSurfaceOutcome =
  | { readonly rendered: true }
  | { readonly rendered: false; readonly reason: 'schema-rejected' | 'rejected-by-renderer'; readonly detail: string };

/** Resolves with the next inbound message, or `null` if none arrives within `graceMs`. The loser of the
 * race is not cancelled: the caller's `exchange.close()` resolves any still-pending `receive()` with
 * `{status: "abandoned"}` moments later, which nothing here reads. */
function receiveRejectionWithGrace({ exchange, graceMs }: { exchange: SurfaceExchange; graceMs: number }, _optional = {}): Promise<SurfaceMessage | null> {
  return Promise.race([exchange.receive({}), new Promise<null>((resolve) => setTimeout(() => resolve(null), graceMs))]);
}

/** `ack.params.message` is the renderer's relayed `RendererToAgentMessage`. Only its `error` shape means
 * "refused"; an `action`/`functionResponse` can never mean refusal here (this renders once and never
 * asks a question a click would answer). */
function rejectionMessageOf({ ack }: { ack: SurfaceMessage | null }, _optional = {}): string | undefined {
  if (ack?.status !== 'received') return undefined;
  const inbound = ack.params['message'];
  if (typeof inbound !== 'object' || inbound === null || !('error' in inbound)) return undefined;
  const error = (inbound as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : 'The browser rejected this surface.';
}

/**
 * Opens one exchange bound to `toolId`/`principalId` on the `a2ui` channel, creates a display-only
 * surface, sends `components`, then waits up to the grace period for a renderer refusal. Always closes
 * the exchange.
 * @complexity O(components) validation; one exchange and one timer per call.
 */
export async function renderA2uiSurface(
  { exchanges, emitSurface, toolId, principalId, components, parseAgentMessage, catalog, displayOnlyProperty }: {
    exchanges: SurfaceExchangeStore; emitSurface: SurfaceEmitter; toolId: string; principalId: string; components: unknown[];
    /** The protocol's agent-to-renderer parser; every outgoing message is validated against it. */
    parseAgentMessage: ParseAgentToRendererMessage;
    /** The catalog the surface is created against (the host's `createLabCatalog({})`). */
    catalog: A2uiSurfaceCatalog;
    /** The protocol's display-only surface property name (`A2UI_DISPLAY_ONLY_PROPERTY`). */
    displayOnlyProperty: string;
  },
  { rejectionGraceMs = DEFAULT_RENDER_REJECTION_GRACE_MS }: { rejectionGraceMs?: number } = {},
): Promise<RenderA2uiSurfaceOutcome> {
  const exchange = exchanges.open({ binding: { toolId, principalId, channel: 'a2ui' }, emit: emitSurface });
  const surfaceId = exchange.id;

  const emitA2ui = async (message: AgentToRendererMessage): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const validated = parseAgentMessage({ raw: message });
    if (!validated.ok) return { ok: false, reason: validated.message };
    await emitSurface({ channel: 'a2ui', payload: { message: validated.message } });
    return { ok: true };
  };

  try {
    // Display-only: this draws and asks nothing, so a chat must not read the surface as a question
    // while the call waits out its refusal grace period. `surfaceProperties` is an open record;
    // renderers ignore it.
    const created = await emitA2ui({
      version: 'v1.0',
      createSurface: { surfaceId, catalogId: catalog.catalogId, surfaceProperties: { [displayOnlyProperty]: true }, dataModel: {} },
    });
    if (!created.ok) return { rendered: false, reason: 'schema-rejected', detail: created.reason };

    const updated = await emitA2ui({ version: 'v1.0', updateComponents: { surfaceId, components: components as never } });
    if (!updated.ok) return { rendered: false, reason: 'schema-rejected', detail: updated.reason };

    const rejection = rejectionMessageOf({ ack: await receiveRejectionWithGrace({ exchange, graceMs: rejectionGraceMs }) });
    return rejection ? { rendered: false, reason: 'rejected-by-renderer', detail: rejection } : { rendered: true };
  } finally {
    exchange.close({});
  }
}

/** The model-facing notes a host words for the one-shot render tool's non-schema outcomes. */
export interface RenderUiToolCopy {
  /** Returned when the execution has no live surface channel to draw on. */
  readonly noSurfaceChannelNote: string;
  /** Returned after a successful draw: tells the model what the human now sees and where. */
  readonly renderedNote: string;
  /** Returned when the renderer refused the surface: tells the model not to claim it rendered. */
  readonly rejectedNote: string;
}

/** The host's registration policy for the one-shot render tool (what `buildDomainRegistrations` needs). */
export interface RenderUiToolRegistrationPolicy {
  readonly domain: string;
  /** Names the host catalog module in drift errors. */
  readonly catalogModule: string;
  readonly metadata: ToolMetadataById;
  readonly derivedRisk: DerivedRiskByToolId;
}

/** Runs one render for an execution: the handler's body, split out so registration stays a binding. */
async function runRenderUiTool(
  { ctx, emitSurface, args, rejectionGraceMs }: {
    ctx: ToolExecutionContext; emitSurface: SurfaceEmitter | undefined; rejectionGraceMs: number | undefined;
    args: Pick<CreateRenderUiToolRegistrationsArgs, 'exchanges' | 'tool' | 'copy' | 'parseAgentMessage' | 'catalog' | 'displayOnlyProperty'>;
  },
  _optional = {},
): Promise<unknown> {
  const { exchanges, tool, copy, parseAgentMessage, catalog, displayOnlyProperty } = args;
  if (!emitSurface) {
    return { rendered: false, reason: 'no-surface-channel', note: copy.noSurfaceChannelNote };
  }
  const components = (ctx.input as { components?: unknown[] }).components ?? [];
  const outcome = await renderA2uiSurface(
    { exchanges, emitSurface, toolId: tool.name, principalId: ctx.principal.id, components, parseAgentMessage, catalog, displayOnlyProperty },
    rejectionGraceMs == null ? {} : { rejectionGraceMs },
  );
  if (outcome.rendered) return { rendered: true, note: copy.renderedNote };
  if (outcome.reason === 'schema-rejected') return { rendered: false, reason: 'schema-rejected', detail: outcome.detail };
  return { rendered: false, reason: 'rejected-by-renderer', detail: outcome.detail, note: copy.rejectedNote };
}

/** Arguments for {@link createRenderUiToolRegistrations}; every collaborator is host-supplied. */
export interface CreateRenderUiToolRegistrationsArgs {
  /** The host-owned catalog entry (name, description, permission, input schema `{components: [...]}`). */
  readonly tool: AgentToolDefinition;
  readonly exchanges: SurfaceExchangeStore;
  readonly parseAgentMessage: ParseAgentToRendererMessage;
  readonly catalog: A2uiSurfaceCatalog;
  readonly displayOnlyProperty: string;
  readonly copy: RenderUiToolCopy;
  readonly registration: RenderUiToolRegistrationPolicy;
}

/**
 * Registers the generic "draw whatever the model sends" tool: a one-shot, write-nothing A2UI render
 * whose success is "no renderer refusal within the grace period" (see {@link renderA2uiSurface}). The
 * host owns the tool definition, the model-facing notes and the registration policy; this owns the
 * behaviour — no-channel answer, `components` extraction, and outcome-to-result mapping.
 * @param _optional.rejectionGraceMs - Test seam shrinking the refusal grace period; production omits it.
 * @complexity O(components) per call.
 */
export function createRenderUiToolRegistrations(
  args: CreateRenderUiToolRegistrationsArgs,
  { rejectionGraceMs }: { rejectionGraceMs?: number } = {},
): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    [args.tool.name]: (ctx, { emitSurface } = {}) => runRenderUiTool({ ctx, emitSurface, args, rejectionGraceMs }),
  };
  return buildDomainRegistrations({
    metadata: args.registration.metadata,
    domain: args.registration.domain,
    catalogModule: args.registration.catalogModule,
    catalog: indexCatalogById({ catalog: [args.tool] }),
    handlers,
    derivedRisk: args.registration.derivedRisk,
  });
}

/**
 * Reads the `ActionMessagePayload` out of a delivered exchange message's `params`, or `undefined` if
 * this particular message was not an `action` (a `functionResponse`/`error` reaching a tool whose
 * surface has no `functionCall` action and raises no `error` of its own would be a client bug — so
 * refusing to guess, rather than throwing, is the same "degrade sanely" posture the browser side
 * already takes for shapes it does not expect).
 *
 * The actions route only ever delivers a message that already passed
 * `parseRendererToAgentMessage` — this is a re-read of already-validated data, not a second
 * validation pass.
 * @complexity O(1).
 */
export function a2uiActionOf({ params }: { params: Record<string, unknown> }, _optional = {}): ActionMessagePayload | undefined {
  const message = params['message'];
  if (typeof message !== 'object' || message === null || !('action' in message)) return undefined;
  return (message as { action: ActionMessagePayload }).action;
}

/**
 * Validates an outgoing message against its own schema before it goes out over the wire, so a typo
 * in one of a tool's literal messages fails loudly at the sender instead of reaching the renderer as
 * a message it then has to reject.
 *
 * @param required.label - Names the sender (typically its tool id) in the thrown message.
 * @param required.parseAgentMessage - The protocol's agent-to-renderer parser, supplied by the host.
 * @returns The parsed message, exactly what the renderer will receive.
 * @throws Error `<label>: refusing to emit a message that fails its own schema: <reason>`.
 * @complexity O(message size) for the schema parse.
 */
export function validatedA2uiMessage({ message, label, parseAgentMessage }: { message: unknown; label: string; parseAgentMessage: ParseAgentToRendererMessage }, _optional = {}): AgentToRendererMessage {
  const validated = parseAgentMessage({ raw: message });
  if (!validated.ok) {
    throw new Error(`${label}: refusing to emit a message that fails its own schema: ${validated.message}`);
  }
  return validated.message;
}

/** One open multi-turn A2UI exchange, as {@link withA2uiExchange} hands it to its `run`. */
export interface A2uiExchangeSession {
  /** The exchange id IS the surface id: A2UI correlates by its own `surfaceId`, and the actions route
   * cross-checks exactly this equality, so there is nothing else to smuggle it through. */
  readonly surfaceId: string;
  /** Emits one message after {@link validatedA2uiMessage} (labelled with the tool id). */
  readonly emit: (message: AgentToRendererMessage) => Promise<void>;
  /** Waits for the next inbound message (an action, or `expired`/`abandoned`). */
  readonly receive: () => Promise<SurfaceMessage>;
}

/**
 * Runs a scripted multi-turn A2UI conversation (`createSurface -> action -> updateComponents -> ...`)
 * over one exchange bound to `toolId`/`principalId` on the `a2ui` channel. The exchange is opened
 * BEFORE any message is sent — opening requires the emitter, so waiting on an unsent message is
 * unrepresentable. An abort of `signal` closes it (resolving a pending `receive` as abandoned).
 *
 * The exchange is always closed afterwards. Closing is idempotent: a conversation that ran to its
 * natural end is a no-op there, and the real cleanup happens only on an early return or an abort.
 * @complexity O(1) plus `run`'s own turns.
 */
export async function withA2uiExchange<T>(
  { exchanges, emitSurface, toolId, principalId, signal, run, parseAgentMessage }: {
    exchanges: SurfaceExchangeStore; emitSurface: SurfaceEmitter; toolId: string; principalId: string; signal: AbortSignal;
    run: (session: A2uiExchangeSession) => Promise<T>;
    /** The protocol's agent-to-renderer parser; every emitted message is validated against it. */
    parseAgentMessage: ParseAgentToRendererMessage;
  },
  _optional = {},
): Promise<T> {
  const exchange = exchanges.open({ binding: { toolId, principalId, channel: 'a2ui' }, emit: emitSurface });
  const emit = async (message: AgentToRendererMessage): Promise<void> => {
    await emitSurface({ channel: 'a2ui', payload: { message: validatedA2uiMessage({ message, label: toolId, parseAgentMessage }) } });
  };
  const closeOnAbort = () => exchange.close({});
  signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    return await run({ surfaceId: exchange.id, emit, receive: () => exchange.receive({}) });
  } finally {
    signal.removeEventListener('abort', closeOnAbort);
    exchange.close({});
  }
}
