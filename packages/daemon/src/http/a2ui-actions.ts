import { parseRendererToAgentMessage, type RendererToAgentMessage } from '@jini-ai/protocol/a2ui';
import type { DeliverResult, SurfaceDeliveryRejectionReason, SurfaceExchangeStore } from '../surface-exchanges.js';
import type { surfaceNotPendingBody } from './surface-callback-request.js';

/**
 * @file The Express-free decision half of an A2UI (a2ui-project/a2ui v1.0) action endpoint — where a
 * rendered surface's `action`/`functionResponse`/`error` message re-enters the server. A host keeps
 * the HTTP shell (principal header, status codes) and calls these.
 *
 * ## Why delivery never calls `toolExecutor.execute`
 *
 * The held-open tool call already passed the registry's authorization gate when the agent made it.
 * Re-running that gate on the human's *answer* would authorize it as though it were a fresh
 * invocation. Delivery therefore only ever reaches `SurfaceExchangeStore.deliver`; there is no
 * allowlist here because there is no execution surface to allowlist.
 *
 * ## Why `toolId` is not supplied to `deliver()`
 *
 * A2UI's `ActionMessage`/`FunctionResponseMessage`/`ErrorMessage` carry no field naming the tool
 * that opened the surface — only `surfaceId` (or, for a `functionResponse`, nothing at all; see
 * `extractDeclaredSurfaceId` below). The browser genuinely has no `toolId` to offer. See
 * `surface-exchanges.ts`'s `DeliverySpec` doc for why the store accommodates that by making the
 * caller's `toolId` optional rather than forcing the route to fabricate one.
 *
 * ## The surfaceId/exchangeId cross-check
 *
 * An A2UI-opening tool sets a surface's `surfaceId` FROM the exchange id it opened — the two are
 * the same string by construction, not by convention alone. When a validated message declares a
 * `surfaceId` that disagrees with the param naming the exchange to deliver into, that is evidence of
 * a confused client (a stale tab, a copy-pasted id) rather than a message this exchange should
 * accept — refused before it ever reaches `deliver()`.
 */

/**
 * The `surfaceId` a validated renderer→agent message declares, if it declares one at all.
 *
 * `action` and `error` (both its `VALIDATION_FAILED` and generic-with-`surfaceId` shapes) carry it;
 * `functionResponse` and a generic `error` keyed by `functionCallId` instead do not — A2UI's own
 * spec correlates those by `functionCallId`, not `surfaceId` (see `interpreter.ts`'s module doc,
 * decision 2: "`callFunction`/`actionResponse` are not surface-scoped on the wire"). `undefined` in
 * that case is not a validation failure; it means this particular message has nothing to cross-check
 * against the `exchangeId` param, and delivery proceeds on `exchangeId` + `principalId`
 * alone, same as it would for any channel with no `toolId` to offer.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function extractDeclaredSurfaceId(message: RendererToAgentMessage): string | undefined {
  if ('action' in message) return message.action.surfaceId;
  if ('error' in message && 'surfaceId' in message.error) return message.error.surfaceId;
  return undefined;
}

/** A validated A2UI post, or the 400 body that refuses it. */
export type ReadA2uiActionResult =
  | { ok: true; exchangeId: string; message: RendererToAgentMessage }
  | { ok: false; error: { error: string; code: 'VALIDATION_ERROR' } };

/**
 * Validates an A2UI post's body: a non-empty `exchangeId`, a schema-valid renderer message, and a
 * declared `surfaceId` (when the message has one) equal to `exchangeId`. Shared by every hop that
 * accepts the post (a daemon route, a host's local-first proxy), so all refuse the same malformed posts.
 *
 * @complexity O(size of the message) for the schema parse.
 */
export function readA2uiAction({ rawBody }: { rawBody: unknown }, _options = {}): ReadA2uiActionResult {
  const body = (rawBody ?? {}) as { exchangeId?: unknown; message?: unknown };
  const exchangeId = body.exchangeId;
  if (typeof exchangeId !== 'string' || exchangeId.length === 0) {
    return { ok: false, error: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' } };
  }

  // Real spec-conformance enforcement, not a rubber stamp — mirrors `daemon.ts`'s own `/a2ui-action`
  // relay in Jini's reference app: a malformed envelope is refused at the network boundary, before
  // it can ever reach a handler waiting on `exchange.receive()`.
  const parsed = parseRendererToAgentMessage({ raw: body.message });
  if (!parsed.ok) return { ok: false, error: { error: parsed.reason, code: 'VALIDATION_ERROR' } };

  const declaredSurfaceId = extractDeclaredSurfaceId(parsed.message);
  if (declaredSurfaceId !== undefined && declaredSurfaceId !== exchangeId) {
    return {
      ok: false,
      error: {
        error: `message declares surfaceId "${declaredSurfaceId}", which does not match exchangeId "${exchangeId}"`,
        code: 'VALIDATION_ERROR',
      },
    };
  }
  return { ok: true, exchangeId, message: parsed.message };
}

/**
 * Delivers a validated A2UI message into `store`. No `toolId` — see this module's doc for why A2UI
 * has none to offer. `channel: "a2ui"` is what keeps it out of an MCP-UI confirmation's exchange.
 *
 * @complexity O(1).
 */
export function deliverA2uiAction(
  { store, ...action }: { store: SurfaceExchangeStore } & { exchangeId: string; principalId: string; message: RendererToAgentMessage },
  _optional: Record<string, never> = {},
): DeliverResult {
  return store.deliver({ exchangeId: action.exchangeId, principalId: action.principalId, params: { message: action.message } }, { channel: 'a2ui' });
}

/**
 * The 409 body for an A2UI post whose surface is not waiting. 409, not 404: the same reasoning the
 * MCP-UI callback gives for its own identical choice ({@link surfaceNotPendingBody}) — from the
 * browser's side, "no such exchange" and "already closed" both mean "this surface is no longer the
 * one waiting on you", which the human cannot act on differently.
 */
export function a2uiNotPendingBody({ reason }: { reason: SurfaceDeliveryRejectionReason }, _optional: Record<string, never> = {}) {
  return { error: 'that surface is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason } as const;
}
