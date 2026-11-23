import type { ServerRoute } from "@jini-ai/core/contracts/server";

import type { OAuthCallbackPageRenderer } from "@jini-ai/core/contracts/site/oauth-callback-page";
import { oauthCallbackPageResponse } from "@jini-ai/core/contracts/site/oauth-callback-page";

/**
 * @file Hosted sign-in start for a plugin-declared API connection. Mounted beneath the host's admin
 * session middleware. A provider link can be forwarded; the browser binding must only go to the
 * authenticated starter. Not JSON (a 302 plus a cookie), so a core `ServerRoute`, not a JSON spec.
 */

/** One stored sign-in handoff: the starting browser's binding and the provider URL to send it to. */
export interface ApiConnectionSignInHandoff {
  readonly browserBinding: string;
  readonly authorizationUrl: string;
}

/** The deps this route reads. Every field is the host's: path, workspace, credential reading, handoff store, cookie rule and copy. */
export interface ApiConnectionSignInRouteDeps {
  /** The host's sign-in path, with `:workspaceId` and `:handoffId`. */
  path: string;
  workspaceId: string;
  /** The kind of credential the host's session gate attached (`"session"` for a browser sign-in). */
  credentialKind: (required: { readonly locals: Readonly<Record<string, unknown>> }) => string | undefined;
  /** The signed-in principal's id; the host throws when there is none (a wiring bug, answered as its 500). */
  actorId: (required: { readonly locals: Readonly<Record<string, unknown>> }) => string;
  /** The 403 copy and the permission it names when a non-session credential opens the link. */
  forbidden: { readonly message: string; readonly permission: string };
  /** Consumes the handoff when it belongs to this actor; `null` for unknown, expired, foreign-actor or spent ones. */
  takeHandoff: (required: { readonly handoffId: string; readonly actorId: string }) => ApiConnectionSignInHandoff | null;
  /** The `Set-Cookie` value carrying the starting browser's binding. */
  bindingCookie: (required: { readonly browserBinding: string }) => string;
  /** The `postMessage` type of the failure page; the API-connection callback's. */
  messageType: string;
  renderPage: OAuthCallbackPageRenderer;
}

// Every answer: never cached, and never leaks the one-time link as a referrer.
const FIXED_HEADERS: [string, string][] = [["Cache-Control", "no-store"], ["Referrer-Policy", "no-referrer"]];

/** The host session gate's credential-kind refusal: same flat 403 body the JSON admin routes send. @complexity O(1). */
function credentialKindRefusal({ forbidden }: Pick<ApiConnectionSignInRouteDeps, "forbidden">, _optional: Record<string, never> = {}): Response {
  const body = { error: forbidden.message, code: "FORBIDDEN", details: { permission: forbidden.permission, reason: "credential_kind_not_permitted" } };
  return new Response(JSON.stringify(body), { status: 403, headers: [...FIXED_HEADERS, ["content-type", "application/json; charset=utf-8"]] });
}

/** A 302 with the plain-text body the host framework wrote for one. @complexity O(1). */
function redirectTo({ location, cookie }: { location: string; cookie: string }, _optional: Record<string, never> = {}): Response {
  return new Response(`Found. Redirecting to ${location}`, {
    status: 302,
    headers: [...FIXED_HEADERS, ["content-type", "text/plain; charset=utf-8"], ["location", location], ["set-cookie", cookie]],
  });
}

/**
 * `GET {deps.path}`: one handoff consume and redirect; no provider call. Wrong workspace, actor,
 * expiry and replay refuse.
 * @complexity O(1) time and space per request.
 */
export function apiConnectionSignInRoute(deps: ApiConnectionSignInRouteDeps, _optional: Record<string, never> = {}): ServerRoute {
  return {
    method: "GET",
    path: deps.path,
    handler: ({ params, locals = {} }) => {
      if (deps.credentialKind({ locals }) !== "session") return credentialKindRefusal(deps);
      // A foreign workspace never reaches the store, so it cannot consume the real handoff.
      const handoff = String(params.workspaceId) === deps.workspaceId
        ? deps.takeHandoff({ handoffId: String(params.handoffId), actorId: deps.actorId({ locals }) }) : null;
      if (!handoff) {
        return oauthCallbackPageResponse(
          { status: 400, render: deps.renderPage, page: { ok: false, reason: "state_expired", messageType: deps.messageType } },
          { headers: [["Referrer-Policy", "no-referrer"]] },
        );
      }
      return redirectTo({ location: handoff.authorizationUrl, cookie: deps.bindingCookie({ browserBinding: handoff.browserBinding }) });
    },
  };
}
