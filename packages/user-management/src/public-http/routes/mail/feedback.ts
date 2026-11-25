import type { RouteInputContext } from "@jini-ai/core/contracts/server";

/**
 * @file `POST /hooks/mail/:providerId` — a mail provider's bounce/complaint webhook. Unauthenticated:
 * the provider's signature is the credential, and it is over the exact request bytes, so the host
 * mounts a raw body parser (any content type, capped at the ingest's own limit) on this route ahead
 * of any JSON parser, and this spec hands those bytes to the ingest untouched.
 */

/** Node-style request headers: lower-case keys, repeated headers as arrays. */
export type MailFeedbackHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/** What the host injects. */
export interface MailFeedbackRouteDeps {
  /** The provider-feedback ingest: provider lookup, signature over the exact bytes, rate limit, replay dedup, record. */
  readonly ingest: {
    handle(required: { providerId: string; rawBody: Uint8Array; headers: MailFeedbackHeaders }): Promise<{ readonly status: number; readonly body: unknown }>;
  };
  /** This request's headers, bound per request by the host: which of them a provider signs is the provider's business. */
  readonly requestHeaders: MailFeedbackHeaders;
}

/** The provider webhook as a structural raw spec (kept structural so this package never imports the server toolkit). */
export interface MailFeedbackPublicRawRoute {
  readonly method: "post";
  readonly path: string;
  readonly bufferedReply: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: MailFeedbackRouteDeps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/**
 * Forwards the raw bytes, provider id and headers to the ingest and answers its status and JSON body.
 * An ingest failure propagates: the host writes the redacted 500, since the caller is unauthenticated.
 * @complexity O(n) in the body size (one copy) plus the ingest.
 */
export const mailFeedbackRoute: MailFeedbackPublicRawRoute = {
  method: "post",
  path: "/hooks/mail/:providerId",
  bufferedReply: true,
  async handle({ raw, deps }) {
    // No body at all leaves `req.body` as `{}`; an empty buffer is what the signature saw.
    const body = raw.body instanceof Uint8Array ? raw.body : new Uint8Array(0);
    const result = await deps.ingest.handle({ providerId: raw.params.providerId ?? "", rawBody: new Uint8Array(body), headers: deps.requestHeaders });
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json; charset=utf-8" } });
  },
};
