import type { RouteInputContext } from "@jini-ai/core/contracts/server";

/**
 * @file Shared shape of the public, unauthenticated SEO document routes (`sitemap.xml`, `robots.txt`,
 * `llms.txt`, `feed.xml`): a raw GET that answers one text document on the origin the request was served
 * from. The host owns the cache policy, the readiness gate and the failure copy: a thrown error reaches the
 * host's failure writer, so these specs never write an error body of their own.
 */

/** A public SEO raw route, in the exact shape `@jini-ai/http-kit`'s `RawRouteSpec` mounts, kept structural so
 *  this domain package never imports the server toolkit. It always opts into the host's request facts. */
export interface PublicSeoRawRoute<Deps> {
  readonly method: "get";
  readonly path: string;
  readonly requestFacts: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: Deps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** The serving origin the host resolved for this request, or `undefined` when none could be formed.
 * @throws When the host supplied no request facts at all: a wiring bug, answered by the host's failure writer.
 * @complexity O(1).
 */
export function servingOriginOf({ raw }: { readonly raw: RouteInputContext }, _optional: Record<string, never> = {}): string | undefined {
  if (raw.facts === undefined) throw new Error("public SEO route: the host supplied no request facts (servingOrigin) — mount it with the request facts port");
  return raw.facts.servingOrigin;
}

/** The SEO dependencies scoped to this request: `renderBaseUrl` is the serving origin when the host formed
 *  one, else the stored dependencies are returned untouched (the disclosed stored-origin fallback).
 * @throws As {@link servingOriginOf}.
 * @complexity O(1) plus one shallow copy.
 */
export function withServingOrigin<D extends { readonly renderBaseUrl?: string | undefined }>(
  { raw, seoDeps }: { readonly raw: RouteInputContext; readonly seoDeps: D },
  _optional: Record<string, never> = {},
): D {
  const origin = servingOriginOf({ raw });
  return origin === undefined ? seoDeps : { ...seoDeps, renderBaseUrl: origin };
}

/** One finished text document: `200`, UTF-8 `contentType`, and the host's cache policy.
 * @complexity O(1) beyond the body copy.
 */
export function textDocument({ body, contentType, cacheControl }: { readonly body: string; readonly contentType: string; readonly cacheControl: string }, _optional: Record<string, never> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": `${contentType}; charset=utf-8`, "cache-control": cacheControl } });
}
