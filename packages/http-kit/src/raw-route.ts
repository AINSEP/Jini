/**
 * Non-JSON routes (HTML, streams, uploads, downloads, a redirect that sets cookies) on the same gates
 * and host ports as `mountJsonRoute`: the handler answers with a web `Response`, which is written back
 * through the node bridge's writer. Mounted with `app[method](path, handler)`, never `app.use`, so a
 * host's route-table inventory sees exactly one route per spec, as it does for a JSON spec.
 */
import type { Express, Request, Response } from 'express';
import type { RouteHostContext } from '@jini-ai/core/contracts/server';
import { allowRouteBody, allowRouteOrigin, applyResponseHeaders, assertRequestFactsPort, routeAuthorize, routeRequestInput, sendRouteException } from './adapter.js';
import { sendWebResponse } from './node-bridge.js';
import type { RawRouteSpec } from './types.js';

/** The optional fields of a raw spec, settable in `defineRawRoute`'s second argument. */
type RawRouteOptionalKey = 'requireSameOrigin' | 'maxBodyBytes' | 'ports' | 'readHeaders' | 'requestFacts' | 'responseHeaders';

/**
 * Combines required route fields and optional settings into a fresh raw spec, pinning its generic
 * parameters at the definition site. Optional settings take precedence; neither argument is mutated.
 * @complexity O(1).
 */
export function defineRawRoute<Deps, Context = undefined>(requiredArgs: Omit<RawRouteSpec<Deps, Context>, RawRouteOptionalKey>, optionalArgs: Pick<RawRouteSpec<Deps, Context>, RawRouteOptionalKey> = {}): RawRouteSpec<Deps, Context> {
  return { ...requiredArgs, ...optionalArgs };
}

/**
 * Mounts one raw spec. Gates run in `mountJsonRoute`'s order — static response headers, body cap,
 * workspace, same-origin, authenticate — then `handle`; a thrown error takes the same `onError` /
 * SEC-005 path. The returned `Response` is written with its status, every header (each `Set-Cookie`
 * on its own line) and its body: none ends the answer, a stream is piped and cancelled when the
 * client leaves, and `handle`'s `signal` aborts on that same disconnect.
 * @throws At mount, when the spec opts into `requestFacts` without the host's resolver port.
 * @complexity O(1) setup; per request, the gates, the host ports, `handle` and the body copy.
 */
export function mountRawRoute<Deps, Context = undefined>({ app, spec, deps, adapter }: { readonly app: Express; readonly spec: RawRouteSpec<Deps, Context>; readonly deps: Deps; readonly adapter?: RouteHostContext }, _optional: Record<string, never> = {}): void {
  assertRequestFactsPort({ spec });
  app[spec.method](spec.path, async (req: Request, res: Response) => {
    // Observed on `res`, not `req`, for the reason `mountJsonRoute` documents: a parsed request
    // body has already ended the request stream, so `req`'s `close` is not a disconnect.
    const abortController = new AbortController();
    const onResponseClose = () => abortController.abort();
    res.on('close', onResponseClose);
    try {
      await answerRawRoute({ req, res, spec, deps, adapter, signal: abortController.signal });
    } catch (e) {
      // A body that fails after the head went out cannot be answered any more: cut the connection.
      if (res.headersSent) res.destroy();
      else sendRouteException({ res, spec, adapter, error: e });
    } finally {
      res.off('close', onResponseClose);
    }
  });
}

/** The gates, `handle`, and the write-back of its `Response`; returns early when a gate answered. */
async function answerRawRoute<Deps, Context>({ req, res, spec, deps, adapter, signal }: {
  readonly req: Request; readonly res: Response; readonly spec: RawRouteSpec<Deps, Context>;
  readonly deps: Deps; readonly adapter: RouteHostContext | undefined; readonly signal: AbortSignal;
}): Promise<void> {
  applyResponseHeaders({ res, headers: spec.responseHeaders });
  const raw = routeRequestInput({ req, spec, deps });
  if (!allowRouteBody({ req, res, spec })) return;
  if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
  if (!allowRouteOrigin({ req, res, spec, adapter })) return;
  const context = spec.ports?.authenticate ? await spec.ports.authenticate({ raw, res, deps }) : undefined;
  const authorize = routeAuthorize({ ports: spec.ports, deps, context });
  const response = await spec.handle({ raw, deps, context, authorize }, { signal });
  // The client left while `handle` ran: release the body's producer instead of writing to a closed socket.
  if (signal.aborted) {
    await response.body?.cancel();
    return;
  }
  await sendWebResponse({ response, res }, { headOnly: req.method === 'HEAD' });
}
