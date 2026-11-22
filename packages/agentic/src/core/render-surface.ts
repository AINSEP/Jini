/**
 * @file Draw one arbitrary A2UI component tree on a live surface channel, once, with no scripted
 * follow-up, and report whether the renderer refused it. The caller passes a flat `components` array
 * (`{id, component, ...props}`, children referenced by id, exactly one `root`) learned from its own
 * component search/describe tools. The host owns the tool id, permission and model-facing notes.
 */
import type { SurfaceEmitter, SurfaceExchange, SurfaceExchangeStore, SurfaceMessage } from '@jini-ai/core';
import { A2UI_DISPLAY_ONLY_PROPERTY, createLabCatalog, parseAgentToRendererMessage, type AgentToRendererMessage } from '@jini-ai/protocol/a2ui';

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
  { exchanges, emitSurface, toolId, principalId, components }: {
    exchanges: SurfaceExchangeStore; emitSurface: SurfaceEmitter; toolId: string; principalId: string; components: unknown[];
  },
  { rejectionGraceMs = DEFAULT_RENDER_REJECTION_GRACE_MS }: { rejectionGraceMs?: number } = {},
): Promise<RenderA2uiSurfaceOutcome> {
  const catalog = createLabCatalog({});
  const exchange = exchanges.open({ binding: { toolId, principalId, channel: 'a2ui' }, emit: emitSurface });
  const surfaceId = exchange.id;

  const emitA2ui = async (message: AgentToRendererMessage): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const validated = parseAgentToRendererMessage({ raw: message });
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
      createSurface: { surfaceId, catalogId: catalog.catalogId, surfaceProperties: { [A2UI_DISPLAY_ONLY_PROPERTY]: true }, dataModel: {} },
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
