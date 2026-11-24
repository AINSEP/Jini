/**
 * @file The MCP-UI surface-callback endpoint as a server-neutral handler plus the one `ServerRoute`
 * that wraps it. A callback is one of three shapes (see `surface-callback-request.ts`): an exchange
 * delivery (which may answer with a streamed restoration), a typed answer naming no exchange, or a
 * legacy two-call redemption. The handler takes a structural request port and returns a web
 * `Response`, so no server framework's request or response type reaches the daemon; the host writes
 * the `Response` (streamed answers included) with its own adapter.
 */
import type { SurfaceExchangeStore } from '@jini-ai/core';
import { readJsonBody, statusForError, jsonResponse, type SseSchedulerPort } from '@jini-ai/core/contracts/server';
import type { IdGenerator } from '@jini-ai/core/primitives';
import type { ToolExecutor } from '../tool-executor-types.js';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';
import { deliverSurfaceCallback } from './surface-callback.js';
import {
  executeSurfaceRedemption, isTypedSurfaceAnswer, parseSurfaceCallbackRequest, readSurfacePrincipalId, surfaceNotPendingBody,
  surfaceReplyResponse, unauthenticatedReply, type SurfaceCallbackRequest,
} from './surface-callback-request.js';

/** The slice of a request this handler reads — satisfiable by a web `Request` plus its parsed body, or any framework's request. */
export interface SurfaceCallbackHttpRequest {
  readonly headers: { get(name: string): string | null };
  /** The parsed JSON body, or whatever the host's parser produced when the body was absent. */
  readonly body: unknown;
  /** Aborts when the caller goes away; a streamed restoration is cancelled with it. */
  readonly signal: AbortSignal;
}

/** What {@link answerSurfaceCallback} needs from the host. */
export interface SurfaceCallbackRouteDeps {
  readonly toolExecutor: Pick<ToolExecutor, 'execute'>;
  /** The SAME store the parked tool calls wait in; a different instance leaves every exchange unreachable. */
  readonly surfaceExchanges: SurfaceExchangeStore;
  /** Keepalive timers for a restored card's stream. */
  readonly scheduler: SseSchedulerPort;
  /** Source of the single-use run id a legacy redemption executes under. */
  readonly idGenerator: IdGenerator;
  /** Name of the request header carrying the already-authenticated principal id. */
  readonly principalHeader: string;
  /**
   * The host's allowlist (tool membership and typed-answer policy) — the security-critical check
   * this endpoint exists to enforce. Checked here even when a proxy in front already did, because
   * this route, not the proxy, is the one call site that can reach `toolExecutor.execute`.
   */
  readonly admit: (required: { toolName: string; answersAnExchange: boolean; typedAnswer: boolean }) => boolean;
}

interface CallbackCall {
  readonly deps: SurfaceCallbackRouteDeps;
  readonly signal: AbortSignal;
  readonly principalId: string;
  readonly toolName: string;
  readonly params: Record<string, unknown>;
}

/** Shape 1 (and, with `restoreOnMiss` off, Shape 3's delivery): delivers into the exchange, or restores a late answer. */
function deliverIntoExchange(
  { call, exchangeId }: { readonly call: CallbackCall; readonly exchangeId: string },
  { restoreOnly = false, restoreOnMiss = false }: { readonly restoreOnly?: boolean; readonly restoreOnMiss?: boolean } = {},
): Promise<Response> {
  const { deps, signal, principalId, toolName, params } = call;
  return deliverSurfaceCallback({
    store: deps.surfaceExchanges, exchangeId, principalId, toolId: toolName, params, scheduler: deps.scheduler, signal,
    admit: ({ toolId, answersAnExchange, typedAnswer }) => deps.admit({ toolName: toolId, answersAnExchange, typedAnswer }),
  }, { restoreOnly, restoreOnMiss });
}

/**
 * Shape 3: a typed answer that names no exchange. The route resolves which open exchange it is for
 * rather than the client: a human typing into a composer has never seen an exchange id, and an id
 * scraped out of the surface's own (model-influenced, sandboxed) HTML would be a correlation the
 * model wrote both ends of. The store's lookup is scoped to this request's server-verified
 * principal and to the named, already-allowlisted tool. An unmatched typed answer must not fall
 * through to Shape 2, which would EXECUTE the tool afresh and put a second, unasked-for form on
 * screen in reply to an answer meant for the first; a 409 is the honest outcome — nothing is
 * outstanding. Its body is the same one an unmatched exchange delivery gets, because from the
 * human's side "nothing outstanding", "expired" and "two open and named neither" are one situation.
 */
function deliverTypedAnswer({ call }: { readonly call: CallbackCall }): Promise<Response> {
  const exchangeId = call.deps.surfaceExchanges.findTypedAnswerTarget({ principalId: call.principalId, toolId: call.toolName });
  if (exchangeId === undefined) {
    return Promise.resolve(surfaceReplyResponse({ reply: { status: 409, body: surfaceNotPendingBody({ reason: 'unknown-or-closed' }) } }));
  }
  return deliverIntoExchange({ call, exchangeId });
}

/** Shape 2: legacy two-call redemption through the same `ToolExecutor.execute` a model-issued call uses. */
async function redeem({ call }: { readonly call: CallbackCall }): Promise<Response> {
  const reply = await executeSurfaceRedemption({
    toolExecutor: call.deps.toolExecutor, idGenerator: call.deps.idGenerator, toolName: call.toolName, params: call.params, principalId: call.principalId,
  });
  return surfaceReplyResponse({ reply });
}

function routeCallback({ call, callback, body }: { readonly call: CallbackCall; readonly callback: SurfaceCallbackRequest; readonly body: unknown }): Promise<Response> {
  if (callback.exchangeId !== undefined) {
    return deliverIntoExchange({ call, exchangeId: callback.exchangeId }, { restoreOnly: (body as { restore?: unknown }).restore === true, restoreOnMiss: true });
  }
  // Checked before Shape 2 because Shape 2 would execute the tool afresh.
  return isTypedSurfaceAnswer({ params: callback.params }) ? deliverTypedAnswer({ call }) : redeem({ call });
}

/**
 * Answers one surface callback: 401 with no principal (checked before the body is judged), the
 * 400/403 reply for the first invalid field or an allowlist refusal, then the shape the body names.
 * Every answer is a web `Response`; a restored card's answer is a stream.
 *
 * @complexity O(1) plus the delivery, restoration or invoked tool's own cost.
 */
export async function answerSurfaceCallback(
  { request, deps }: { readonly request: SurfaceCallbackHttpRequest; readonly deps: SurfaceCallbackRouteDeps },
  _optional: Record<string, never> = {},
): Promise<Response> {
  const principalId = readSurfacePrincipalId({ headers: request.headers, principalHeader: deps.principalHeader });
  if (!principalId) return surfaceReplyResponse({ reply: unauthenticatedReply({ principalHeader: deps.principalHeader }) });
  const parsed = parseSurfaceCallbackRequest({ body: request.body, admit: deps.admit });
  if (!parsed.ok) return surfaceReplyResponse({ reply: parsed.reply });
  const { toolName, params } = parsed.request;
  return routeCallback({ call: { deps, signal: request.signal, principalId, toolName, params }, callback: parsed.request, body: request.body });
}

/**
 * The callback endpoint as one `POST {path}` route: reads the JSON body (a host parser's result is
 * used as-is when one ran first) and answers with {@link answerSurfaceCallback}.
 */
export function surfaceCallbackRoutes(
  { deps, host, path }: { readonly deps: SurfaceCallbackRouteDeps; readonly host: DaemonRouteHost; readonly path: string },
  _optional: Record<string, never> = {},
): DaemonRoute[] {
  return [gated({
    route: {
      method: 'POST',
      path,
      handler: async ({ request }) => {
        const body = await readJsonBody({ request }, { maxBytes: host.jsonBodyMaxBytes });
        if (!body.ok) return jsonResponse({ status: statusForError({ error: body.error }), body: { error: body.error } });
        return answerSurfaceCallback({ request: { headers: request.headers, body: body.value, signal: request.signal }, deps });
      },
    },
    gates: [],
  })];
}
