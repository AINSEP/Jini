import { memberClientAddress, memberRequestLimitReply, type PublicMemberRawRoute } from "./shared.js";
import { memberOidcFailure, memberOidcLimitResponse, memberOidcRedirect, type MemberOidcRedirectDeps } from "./oidc-shared.js";

/**
 * @file `GET /api/members/v1/workspaces/:workspaceId/oidc/:providerId/start` — the PUBLIC plain-link entry
 * point of member sign-in with an OpenID Connect provider.
 *
 * The host owns the protocol (`begin`: server-controlled workspace, live member intent, sealed state, nonce and
 * PKCE), the flow-cookie names and attributes, the error location and the analytics; it runs the no-store
 * headers and the workspace gate at the mount, ahead of this spec.
 */

/** What the host's `begin` answers: where to send the browser, the callback address that scopes the flow
 *  cookie, and the browser binding that cookie carries. */
export interface MemberOidcStartResult {
  readonly authorizationUrl: string;
  readonly callbackUrl: string;
  readonly browserBinding: string;
}

/** The deps this route reads. */
export interface MemberOidcStartRouteDeps extends MemberOidcRedirectDeps {
  /** The host's refusal for a cross-site start (answered, like any failure, as the error redirect). */
  crossSiteRefusal: () => unknown;
  /** Begin the provider login for this request. Independent browser proof stays out of the authorization URL.
   *  Throws the host's refusal (provider unavailable, a bad provider, a disabled member). */
  begin: () => Promise<MemberOidcStartResult>;
  /** Records the requested sign-in (bound by the host to this request). */
  onRequested: () => void;
}

/** The start steps in the hand-written order: IP counter, cross-site gate, protocol start, binding cookie.
 * @complexity O(1) limited protocol start; protocol owner bounds all external work.
 */
async function startSteps({ raw, deps }: Parameters<PublicMemberRawRoute<MemberOidcStartRouteDeps>["handle"]>[0], _optional: Record<string, never> = {}): Promise<Response> {
  const limited = await memberRequestLimitReply({ clientAddress: memberClientAddress({ raw }), ipLimiter: deps.ipLimiter });
  if (limited) return memberOidcLimitResponse({ limited, cookies: [] });
  // A GET start reads the Lax member cookie as connect intent, and Google redirects silently
  // once consent exists: a cross-site page could otherwise relink an unlinked account or
  // create a member. Same-origin links and typed URLs still pass; old browsers omit the header.
  if (raw.headers?.["sec-fetch-site"] === "cross-site") throw deps.crossSiteRefusal();
  const result = await deps.begin();
  const cookie = deps.flowCookie({ callbackUrl: result.callbackUrl, kind: "callback", binding: result.browserBinding });
  deps.onRequested();
  return memberOidcRedirect({ location: result.authorizationUrl, cookies: [cookie] });
}

/** Plain-link entry point. A refusal (cross-site, provider unavailable) sends the person back to the host's
 *  sign-in page with its code; a limiter refusal is the shared 429 JSON.
 * @complexity O(1) limited protocol start; protocol owner bounds all external work.
 */
export const memberOidcStartRoute: PublicMemberRawRoute<MemberOidcStartRouteDeps> & { readonly readHeaders: readonly string[]; readonly requestFacts: true; readonly bufferedReply: "redirect" } = {
  method: "get",
  path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/start",
  readHeaders: ["sec-fetch-site"],
  requestFacts: true,
  // Written as the hand-written `res.redirect(303, …)` wrote it: Express's Accept-negotiated body and `Vary: Accept`.
  bufferedReply: "redirect",
  handle: async ({ raw, deps }) => {
    try {
      return await startSteps({ raw, deps });
    } catch (error) {
      return memberOidcFailure({ deps, error, cookies: [] });
    }
  },
};
