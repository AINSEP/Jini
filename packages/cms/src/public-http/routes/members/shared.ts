import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared shapes of the PUBLIC member routes (`/api/members/v1/workspaces/:workspaceId/*`):
 * the raw (web `Response`) spec shape they are mounted in, and the host's credential-refusal mapping.
 *
 * Every policy these routes carry is the host's and is injected: cookie names and attributes, the
 * credential error classes and their copy, the same-origin and body-size gates (which the host runs at
 * the mount, ahead of the spec), and the unexpected-failure 500.
 */

/** A public member route answered as a web `Response` (it sets or clears a cookie), in the exact shape
 *  `@jini-ai/http-kit`'s `RawRouteSpec` mounts. Kept structural so this domain package never imports the
 *  server toolkit: the host mounts it with its raw public mount, which supplies the ports. */
export interface PublicMemberRawRoute<Deps> {
  readonly method: "get" | "post";
  readonly path: string;
  /** Lower-cased request header names the handler reads from `raw.headers`. */
  readonly readHeaders?: readonly string[];
  /** Set when the handler reads `raw.facts` (client address, user agent). */
  readonly requestFacts?: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: Deps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** The host's answer for one of its own credential failures (status + flat body), or `undefined` for
 *  anything unexpected, which the host's 500 then answers. */
export type MemberAuthRefusalFor = (required: { readonly error: unknown }) => { readonly status: number; readonly body: unknown } | undefined;

/** Throw the host's refusal for a known credential failure; rethrow anything else unchanged.
 * @returns Never.
 * @complexity O(1) plus the host mapping.
 */
export function refuseMemberAuthError(
  { error, refusalFor }: { readonly error: unknown; readonly refusalFor: MemberAuthRefusalFor },
  _optional: Record<string, never> = {},
): never {
  const refusal = refusalFor({ error });
  if (refusal) throw new RouteRefusalError({ status: refusal.status, body: refusal.body });
  throw error;
}
