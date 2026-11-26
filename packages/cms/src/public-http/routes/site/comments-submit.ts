import type { Express, Request, RequestHandler } from 'express';
import { describeErrorForLog } from '@jini-ai/core/model-facing-tool-errors';
import type { createCommentSubmitHandler } from '../../../comments/express/index.js';
import type { CommentsProviderRegistry } from "@jini-ai/core/contracts/site/comments-providers";

import type { CommentSubmission } from "../../../comments/types.js";

/**
 * @file ADR-031 §4 (SPEC-033) — the neutral admission decisions of the public, unauthenticated comment
 * submission route: which no-JS return target is trusted, whether a POST is same-origin, and which
 * provider receives a submission. The Express transport, request limiter, salt and IP hashing stay with
 * the host / `comments/express`; none of them are re-decided here.
 */

/** The ingress result shape the submit handler consumes, typed structurally so this module never imports
 * the Express entry that declares the same shape. */
export type CommentIngressSubmitResult =
  | { ok: true; comment: { id: string; status: string } }
  | { ok: false; reason: string };

/** Only local paths can be used for the no-JS PRG response; never trust a Referer redirect. */
export function commentFormReturnTo({ value }: { value: unknown }, _optional = {}): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  const url = new URL(value, "https://comments.invalid");
  return url.origin === "https://comments.invalid" ? url.pathname + url.search : "/";
}

/** CSRF gate. A browser always sends `Origin` on a POST, so a cross-site page (including a no-JS form
 * on another origin, or an opaque `null` origin) is refused. A missing `Origin` is allowed ONLY for a
 * JSON body: a cross-site page cannot send `application/json` without a CORS preflight this route never
 * answers, so that request is a non-browser client, which no Origin check could stop anyway (the
 * honeypot, spam check and both rate limits are what bound those). The serving origin and the configured
 * public origin are read lazily, only on the branch that consults them, so a misconfigured public origin
 * throws (a 500), loudly, exactly where the host's own binding did. There is no Referer fallback.
 * @complexity O(1). */
export function isSameOriginCommentPost({ origin, isJson, servingOrigin, configuredOrigin }: {
  origin: string | undefined;
  isJson: (required: Record<string, never>) => boolean;
  servingOrigin: (required: Record<string, never>) => string;
  configuredOrigin: (required: Record<string, never>) => string;
}, _optional = {}): boolean {
  if (origin === undefined) return isJson({});
  // The configured public origin also counts, for proxies that rewrite Host.
  return origin === servingOrigin({}) || origin === configuredOrigin({});
}

/** Dispatches a public submission to the site's ACTIVE stored provider, resolved per call. No provider, or
 * an embedded one (the vendor owns its own form), is the same generic refusal as any other ingress rejection.
 * @complexity O(1) plus the provider's ingress work. */
export function commentProviderIngress({ providers, siteId }: { providers: CommentsProviderRegistry; siteId: string }, _optional = {}): {
  submit: (submission: CommentSubmission) => Promise<CommentIngressSubmitResult>;
} {
  return { submit: async submission => {
    const { adapter } = await providers.active({ siteId });
    if (!adapter || adapter.kind !== "stored") return { ok: false, reason: "comments-disabled" };
    const result = await adapter.submission.submit({ siteId, entryId: submission.entryId, parentId: submission.parentId,
      authorName: submission.authorName, authorEmail: submission.authorEmail, authorUrl: submission.authorUrl, bodyRaw: submission.bodyRaw,
      authorIpHash: String(submission.ingressContext.authorIpHash), honeypotValue: String(submission.ingressContext.honeypotValue) });
    return result.ok ? { ok: true, comment: { id: result.id, status: result.status } } : result;
  } };
}

/** Mounts Jini's handler with the site's ingress, request budget, salt and proxy policy.
 * @throws TypeError at registration when `deps.ipHashSalt` is missing; any other missing/invalid
 *   handler dependency (Jini's TypeError) surfaces as a 500 through `next(error)` on the first
 *   request, once the salt promise has settled.
 * @complexity O(1) route setup; request work belongs to the Jini handler.
 */
export function registerCommentsSubmitRoute({ app, deps }: { app: Express; deps: {
  createCommentSubmitHandler: typeof createCommentSubmitHandler;
  ingressPolicy: Parameters<typeof createCommentSubmitHandler>[0]['ingressPolicy'];
  workspaceId: string;
  rateLimiter: Parameters<typeof createCommentSubmitHandler>[0]['rateLimiter'];
  ipHashSalt: Promise<string>;
  providers?: CommentsProviderRegistry;
  clientIp: Parameters<typeof createCommentSubmitHandler>[0]['clientIp'];
  onAccepted: NonNullable<NonNullable<Parameters<typeof createCommentSubmitHandler>[1]>['onAccepted']>;
  isSameOriginCommentPost: (required: { request: Request }) => boolean;
  formParser: RequestHandler;
} }, _optional: Record<string, never> = {}): void {
  // Named refusal rather than "Cannot read properties of undefined (reading 'then')", which is
  // what a caller missing this dependency produced on 2026-10-08.
  if (typeof deps.ipHashSalt?.then !== "function") {
    throw new TypeError("registerCommentsSubmitRoute requires deps.ipHashSalt (a Promise<string> from resolveCommentsIpHashSalt at the composition root)");
  }
  const handler = deps.ipHashSalt.then((ipHashSalt) => deps.createCommentSubmitHandler({
    ingressPolicy: { submit: async submission => {
      const owner = deps.providers ? commentProviderIngress({ providers: deps.providers, siteId: deps.workspaceId }) : deps.ingressPolicy;
      return owner.submit(submission);
    } },
    workspaceId: deps.workspaceId,
    ipHashSalt,
    rateLimiter: deps.rateLimiter,
    clientIp: deps.clientIp,
  }, { onAccepted: deps.onAccepted, formRedirect: ({ request }) => request.is('application/x-www-form-urlencoded')
    ? commentFormReturnTo({ value: request.body?.returnTo }) : undefined }));
  // Observed here so a construction failure is not an unhandled rejection at boot; each request
  // below re-awaits the same promise and hands that failure to Express's error path instead.
  handler.catch((error: unknown) => {
    console.error("[comments] Could not prepare the comment submission handler:",
      describeErrorForLog({ err: error }));
  });
  const submit: RequestHandler = async (request, response, next) => {
    if (!deps.isSameOriginCommentPost({ request })) {
      response.status(403).json({ error: 'A same-origin comment submission is required' });
      return undefined;
    }
    let built: RequestHandler;
    try {
      built = await handler;
    } catch (error) {
      next(error);
      return undefined;
    }
    return built(request, response, next);
  };
  app.post("/api/site/comments", deps.formParser, submit);
}
