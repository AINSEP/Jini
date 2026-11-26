import { memberClientAddress, memberRequestLimitReply, type PublicMemberRawRoute } from "./shared.js";
import { runMemberOidcPreflight, memberOidcFailure, memberOidcLimitResponse, memberOidcRedirect, type MemberOidcRedirectDeps } from "./oidc-shared.js";

/**
 * @file `GET /api/members/v1/workspaces/:workspaceId/oidc/:providerId/callback` — the PUBLIC top-level
 * callback of member sign-in with an OpenID Connect provider.
 *
 * The host owns the protocol (`complete`: the query parser, the browser binding, state/nonce/PKCE verification,
 * the one-time code exchange and the federated-identity link), the cookie names and attributes, the signed-in
 * and error locations and the analytics; it runs the no-store headers and the workspace gate at the mount.
 */

/** What the host's `complete` answers: a signed-in member (its session cookie, read only once the proof cookie
 *  is cleared, and its signed-in event), or a mailbox that must be proved first (sealed, browser-bound). */
export type MemberOidcCallbackOutcome =
  | { readonly kind: "signed_in"; readonly sessionCookie: () => string; readonly announce: () => void }
  | { readonly kind: "email_verification_required"; readonly continueByEmail: () => Promise<{ readonly browserBinding: string; readonly location: string }> };

/** The deps this route reads. */
export interface MemberOidcCallbackRouteDeps extends MemberOidcRedirectDeps {
  /** The callback address that scopes the flow cookies, computed independently of member authentication so even
   *  a stale connect clears them. Throws the host's refusal for a bad provider. */
  callbackUrl: () => Promise<string>;
  /** Complete the provider login for this request; throws the host's refusal for a denied, cancelled, malformed,
   *  forged, expired or mismatched callback. */
  complete: () => Promise<MemberOidcCallbackOutcome>;
  /** Where a signed-in member is sent. */
  signedInLocation: string;
}

/** The callback steps in the hand-written order; `cookies` collects every `Set-Cookie` so far, for the error path.
 * @complexity O(1) protocol/transaction calls; the host owns bounded exchange and indexed persistence.
 */
async function callbackSteps({ raw, deps, cookies }: Parameters<PublicMemberRawRoute<MemberOidcCallbackRouteDeps>["handle"]>[0] & { cookies: string[] }, _optional: Record<string, never> = {}): Promise<Response> {
  // Clear before reading the untrusted cookie/query, including duplicate-cookie refusal.
  const callbackUrl = await deps.callbackUrl();
  cookies.push(deps.flowCookie({ callbackUrl, kind: "callback" }));
  const limited = await memberRequestLimitReply({ clientAddress: memberClientAddress({ raw }), ipLimiter: deps.ipLimiter });
  if (limited) return memberOidcLimitResponse({ limited, cookies });
  const outcome = await deps.complete();
  if (outcome.kind === "email_verification_required") {
    const { browserBinding, location } = await outcome.continueByEmail();
    cookies.push(deps.flowCookie({ callbackUrl, kind: "proof", binding: browserBinding }));
    return memberOidcRedirect({ location, cookies });
  }
  cookies.push(deps.flowCookie({ callbackUrl, kind: "proof" }));
  cookies.push(outcome.sessionCookie());
  outcome.announce();
  return memberOidcRedirect({ location: deps.signedInLocation, cookies });
}

/** Top-level callback clears proof on success, denial and malformed input, then calls the protocol only.
 * Returns the fixed signed-in redirect, the sealed email continuation or the fixed error redirect;
 * logs no request material.
 * @complexity O(1) protocol/transaction calls; the host owns bounded exchange and indexed persistence.
 */
export const memberOidcCallbackRoute: PublicMemberRawRoute<MemberOidcCallbackRouteDeps> & { readonly requestFacts: true; readonly bufferedReply: "redirect" } = {
  method: "get",
  path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/callback",
  requestFacts: true,
  // Written as the hand-written `res.redirect(303, …)` wrote it: Express's Accept-negotiated body and `Vary: Accept`.
  bufferedReply: "redirect",
  handle: async ({ raw, deps }) => {
    const cookies: string[] = [];
    try {
      return await callbackSteps({ raw, deps, cookies });
    } catch (error) {
      return memberOidcFailure({ deps, error, cookies });
    }
  },
};

export async function completeMemberOidcRouteOutcome<TContext, TResult>(required: {
  readContext: () => Promise<TContext>; readBrowserBinding: () => string;
  complete: (required: { context: TContext; browserBinding: string }) => Promise<{ kind: 'signed_in'; result: TResult } | Extract<MemberOidcCallbackOutcome, { kind: 'email_verification_required' }>>;
  sessionCookie: (result: TResult) => string; announce: (result: TResult) => void;
}, _optional = {}): Promise<MemberOidcCallbackOutcome> {
  const context = await required.readContext();
  const browserBinding = required.readBrowserBinding();
  const linked = await required.complete({ context, browserBinding });
  if (linked.kind === 'email_verification_required') return linked;
  return { kind: 'signed_in', sessionCookie: () => required.sessionCookie(linked.result), announce: () => required.announce(linked.result) };
}

export function bindMemberOidcCallbackRoute<TRequest>(required: {
  deps: Omit<MemberOidcCallbackRouteDeps, 'callbackUrl' | 'complete' | 'onFailed'>;
  requestDeps: (input: { request: TRequest; deps: MemberOidcCallbackRouteDeps }) => MemberOidcCallbackRouteDeps;
  writeHeaders: (request: TRequest) => void; observe: (request: TRequest) => void; check: (request: TRequest) => boolean;
}, _optional = {}) {
  const boundPerRequest = (): never => { throw new Error('bound per request by requestDeps'); };
  return { spec: memberOidcCallbackRoute, deps: { ...required.deps, callbackUrl: boundPerRequest, complete: boundPerRequest, onFailed: boundPerRequest },
    requestDeps: required.requestDeps,
    preflight: (request: TRequest, run: () => unknown) => runMemberOidcPreflight({ writeHeaders: () => required.writeHeaders(request),
      observe: () => required.observe(request), check: () => required.check(request), run }),
  };
}
