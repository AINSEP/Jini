import type { parseRendererToAgentMessage, RendererToAgentMessage } from '@jini-ai/protocol/a2ui';
import type { DeliverResult, SurfaceDeliveryRejectionReason, SurfaceExchangeStore } from '../surface-exchanges.js';
import type { DaemonRouteHost } from './route-host.js';
import { principalFirstJsonPost, type HostParsedRequest } from './principal-first-route.js';
import type { DaemonRoute } from './route-table.js';
import { readSurfacePrincipalId, surfaceReplyResponse, unauthenticatedReply } from './surface-callback-request.js';

/**
 * @file The A2UI (a2ui-project/a2ui v1.0) action endpoint — where a rendered surface's
 * `action`/`functionResponse`/`error` message re-enters the server: the decision helpers below, and
 * {@link a2uiActionsRoutes}, the JSON route a host mounts on whatever server it runs.
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
 * The parser is the host's to supply, so the daemon takes no value edge on the protocol package.
 *
 * @complexity O(size of the message) for the schema parse.
 */
export function readA2uiAction(
  { rawBody, parseRendererMessage }: { rawBody: unknown; parseRendererMessage: typeof parseRendererToAgentMessage },
  _options = {},
): ReadA2uiActionResult {
  const body = (rawBody ?? {}) as { exchangeId?: unknown; message?: unknown };
  const exchangeId = body.exchangeId;
  if (typeof exchangeId !== 'string' || exchangeId.length === 0) {
    return { ok: false, error: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' } };
  }

  // Real spec-conformance enforcement, not a rubber stamp — mirrors `daemon.ts`'s own `/a2ui-action`
  // relay in Jini's reference app: a malformed envelope is refused at the network boundary, before
  // it can ever reach a handler waiting on `exchange.receive()`.
  const parsed = parseRendererMessage({ raw: body.message });
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
 * MCP-UI callback gives for its own identical choice (`surfaceNotPendingBody`) — from the
 * browser's side, "no such exchange" and "already closed" both mean "this surface is no longer the
 * one waiting on you", which the human cannot act on differently.
 */
export function a2uiNotPendingBody({ reason }: { reason: SurfaceDeliveryRejectionReason }, _optional: Record<string, never> = {}) {
  return { error: 'that surface is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason } as const;
}

/** What {@link a2uiActionsRoutes} needs from the host. */
export interface A2uiActionsRouteDeps {
  /**
   * The SAME store the A2UI-opening tools' handlers park on. A different instance would leave every
   * A2UI exchange unreachable, answering 409 until the agent's call times out.
   */
  readonly surfaceExchanges: SurfaceExchangeStore;
  /** Name of the request header carrying the already-authenticated principal id. */
  readonly principalHeader: string;
  /** The protocol's renderer-to-agent parser (`parseRendererToAgentMessage`). */
  readonly parseRendererMessage: typeof parseRendererToAgentMessage;
}

/**
 * Answers one A2UI post whose body the host has already parsed: 401 with no principal (checked
 * before the body is touched), 400 for a malformed post, 409 when nothing is waiting or the exchange
 * is another caller's or another channel's, else 202 `{ delivered: true }`. Deliberately not the
 * tool's eventual result: the agent's own call returns that, to the model, where it belongs. Refusals
 * keep the endpoint's flat bodies. An exception from the host's parser propagates to the host.
 *
 * @complexity O(1) plus the schema parse; the delivery itself is a `Map` lookup.
 */
export function answerA2uiAction(
  { request, deps }: { readonly request: Pick<HostParsedRequest, 'headers' | 'body'>; readonly deps: A2uiActionsRouteDeps },
  _optional: Record<string, never> = {},
): Response {
  const principalId = readSurfacePrincipalId({ headers: request.headers, principalHeader: deps.principalHeader });
  if (!principalId) return surfaceReplyResponse({ reply: unauthenticatedReply({ principalHeader: deps.principalHeader }) });
  const action = readA2uiAction({ rawBody: request.body, parseRendererMessage: deps.parseRendererMessage });
  if (!action.ok) return surfaceReplyResponse({ reply: { status: 400, body: action.error } });
  const delivered = deliverA2uiAction({ store: deps.surfaceExchanges, exchangeId: action.exchangeId, principalId, message: action.message });
  if (!delivered.ok) return surfaceReplyResponse({ reply: { status: 409, body: a2uiNotPendingBody({ reason: delivered.reason }) } });
  return surfaceReplyResponse({ reply: { status: 202, body: { delivered: true } } });
}

/**
 * `POST {path}` — refuses a request with no principal before it reads the body, then reads the JSON
 * body and answers with {@link answerA2uiAction}. A host with its own body parser mounts
 * {@link answerA2uiAction} directly instead.
 */
export function a2uiActionsRoutes(
  { deps, host, path }: { readonly deps: A2uiActionsRouteDeps; readonly host: DaemonRouteHost; readonly path: string },
  _optional: Record<string, never> = {},
): DaemonRoute[] {
  return [principalFirstJsonPost({
    path, host, principalHeader: deps.principalHeader,
    answer: (request) => {
      const response = answerA2uiAction({ request, deps });
      // Kept from the JSON-route mount this replaced: a caller already gone gets 499 and no body.
      return request.signal.aborted ? new Response(null, { status: 499 }) : response;
    },
  })];
}
