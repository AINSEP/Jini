import type { MemberOidcFlowCookieKind } from "./oidc-shared.js";
import { runMemberOidcPreflight, memberOidcLimitResponse } from "./oidc-shared.js";
import { memberClientAddress, memberRequestLimitReply, type MemberRequestLimiter, type PublicMemberRawRoute } from "./shared.js";
import type { MemberLoginRefusalFor } from "./unlink-identity.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/oidc/:providerId/verify-email` — the PUBLIC email-proof
 * leg of a federated member sign-in: the browser posts the sealed continuation and the emailed code.
 *
 * The host owns the strict body parser, the verification itself (its proof cookie, the sealed continuation,
 * the emailed challenge and the federated link), the flow and session cookies, the signed-in location, the
 * no-store headers, the failed-sign-in observer and the same-origin and body-size gates (run at the mount,
 * ahead of this spec), and the fail-closed refusal copy.
 */

/** The strict JSON DTO the host's parser answers; callers cannot inject claims, intent or proof booleans. */
export interface MemberOidcEmailProof {
  readonly continuation: string;
  readonly challengeId: string;
  readonly code: string;
}

/** What the host's verification answers: a signed-in member (its session cookie, its sign-in announcement and
 *  its public view, each computed only when the route reaches it), or any other outcome, which is refused. */
export type MemberOidcVerifyEmailOutcome =
  | { readonly kind: "signed_in"; readonly sessionCookie: () => string; readonly announce: () => void; readonly member: () => unknown }
  | { readonly kind: Exclude<string, "signed_in"> };

/** The deps this route reads. `verify` and `callbackUrl` are bound to the request by the host's mount. */
export interface MemberOidcVerifyEmailRouteDeps {
  /** The shared, app-boot-scoped per-IP counter. */
  ipLimiter: MemberRequestLimiter;
  /** The host's strict body parser; throws its refusal for any other shape. */
  parseProof: (required: { body: unknown }) => MemberOidcEmailProof;
  /** Verify `proof` against the request's proof cookie and the sealed continuation; throws the host's refusal. */
  verify: (required: { proof: MemberOidcEmailProof }) => Promise<MemberOidcVerifyEmailOutcome>;
  /** The configured callback URL that scopes the flow cookies. */
  callbackUrl: () => Promise<string>;
  /** The `Set-Cookie` value for the flow cookie of `kind`; with no `binding`, the cookie that clears it. */
  flowCookie: (required: { callbackUrl: string; kind: MemberOidcFlowCookieKind; binding?: string }) => string;
  /** Where the signed-in page script sends the member next. */
  signedInLocation: string;
  refusalFor: MemberLoginRefusalFor;
}

/** A verification that did not sign the member in: the host's mapping answers it with its fixed invalid outcome. */
class MemberOidcVerifyEmailInvalid extends Error {}

/** A JSON answer as Express's `res.json` wrote it after `cookies`: the same content type and serialized bytes. O(n). */
function jsonResponse({ status, body, cookies }: { status: number; body: unknown; cookies: readonly string[] }, _optional: Record<string, never> = {}): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** The proof steps in the hand-written order: counter, body, verification, proof clear, session, announcement.
 *  Every cookie decided is pushed onto `cookies`, so a later failure still answers it.
 * @complexity O(1) plus the host's sealed open and challenge/link calls.
 */
async function verifySteps({ raw, deps, cookies }: { raw: Parameters<PublicMemberRawRoute<MemberOidcVerifyEmailRouteDeps>["handle"]>[0]["raw"]; deps: MemberOidcVerifyEmailRouteDeps; cookies: string[] }, _optional: Record<string, never> = {}): Promise<Response> {
  const limited = await memberRequestLimitReply({ clientAddress: memberClientAddress({ raw }), ipLimiter: deps.ipLimiter });
  if (limited) return memberOidcLimitResponse({ limited, cookies });
  const proof = deps.parseProof({ body: raw.body });
  const outcome = await deps.verify({ proof });
  if (outcome.kind !== "signed_in" || !("sessionCookie" in outcome)) throw new MemberOidcVerifyEmailInvalid();
  cookies.push(deps.flowCookie({ callbackUrl: await deps.callbackUrl(), kind: "proof" }));
  cookies.push(outcome.sessionCookie());
  outcome.announce();
  return jsonResponse({ status: 200, body: { member: outcome.member(), returnPath: deps.signedInLocation }, cookies });
}

/** Browser-bound emailed-code continuation. A wrong code retains its challenge attempt budget
 * in S2, and keeps this cookie for a bounded retry; success clears it. No identity comes from JSON.
 * Every failure, an unexpected one included, is the host's fixed 401/503 (federated-login failures may carry
 * upstream credentials, so nothing passes through to a 500), keeping the cookies already decided, in order.
 * @complexity O(1) sealed open and challenge/link calls; body capped by the existing member guard.
 */
export const memberOidcVerifyEmailRoute: PublicMemberRawRoute<MemberOidcVerifyEmailRouteDeps> & { readonly requestFacts: true; readonly bufferedReply: true } = {
  method: "post",
  path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/verify-email",
  requestFacts: true,
  // Written as the hand-written `res.json` wrote it: a stated Content-Length and the app's ETag, not a chunked stream.
  bufferedReply: true,
  handle: async ({ raw, deps }) => {
    const cookies: string[] = [];
    try {
      return await verifySteps({ raw, deps, cookies });
    } catch (error) {
      const refusal = deps.refusalFor({ error });
      return jsonResponse({ status: refusal.status, body: refusal.body, cookies });
    }
  },
};

export async function verifyMemberOidcRouteOutcome<TContext, TResult>(required: {
  readContext: () => Promise<TContext>; readBrowserBinding: () => string;
  verify: (required: { context: TContext; browserBinding: string }) => Promise<{ kind: 'signed_in'; result: TResult } | { kind: 'email_verification_required' }>;
  sessionCookie: (result: TResult) => string; announce: (result: TResult) => void; member: (result: TResult) => unknown;
}, _optional = {}): Promise<MemberOidcVerifyEmailOutcome> {
  const context = await required.readContext();
  const browserBinding = required.readBrowserBinding();
  const linked = await required.verify({ context, browserBinding });
  if (linked.kind !== 'signed_in') return { kind: linked.kind };
  return { kind: 'signed_in', sessionCookie: () => required.sessionCookie(linked.result), announce: () => required.announce(linked.result), member: () => required.member(linked.result) };
}

export function bindMemberOidcVerifyEmailRoute<TRequest>(required: {
  deps: Omit<MemberOidcVerifyEmailRouteDeps, 'verify' | 'callbackUrl'>;
  requestDeps: (input: { request: TRequest; deps: MemberOidcVerifyEmailRouteDeps }) => MemberOidcVerifyEmailRouteDeps;
  writeHeaders: (request: TRequest) => void; observe: (request: TRequest) => void; check: (request: TRequest) => boolean;
}, _optional = {}) {
  const boundPerRequest = (): never => { throw new Error('bound per request by requestDeps'); };
  return { spec: memberOidcVerifyEmailRoute, deps: { ...required.deps, verify: boundPerRequest, callbackUrl: boundPerRequest }, requestDeps: required.requestDeps,
    preflight: (request: TRequest, run: () => unknown) => runMemberOidcPreflight({ writeHeaders: () => required.writeHeaders(request),
      observe: () => required.observe(request), check: () => required.check(request), run }),
  };
}
