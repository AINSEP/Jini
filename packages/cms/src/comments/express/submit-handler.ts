import { createHash } from "node:crypto";

import type { Request, RequestHandler } from "express";

import type { CommentRateLimiter } from "../ingress.js";
import type { CommentSubmission } from "../types.js";

/**
 * @file ADR-031 §4 (SPEC-033) — the public, unauthenticated comment submission route. The ONLY
 * route a hostile visitor can reach into the Comments plugin; everything downstream of this file
 * is `CommentIngressPolicy` (rate-limit, honeypot, sanitize, spam-classify — see `comments/ingress.ts`).
 *
 * `authorIpHash` is computed HERE, at the HTTP boundary, from the raw request IP — the raw IP
 * itself is never passed into `ingressContext` or stored (mirrors `analytics/ingest.ts`'s
 * discard-raw-IP-at-the-boundary discipline). The host provides the salt at construction.
 */
/** The handler needs only the accepted id/status, so a host may dispatch to any stored provider. */
export type CommentSubmitResult = { ok: true; comment: { id: string; status: string } } | { ok: false; reason: string };

export interface CommentSubmitRequired {
  ingressPolicy: { submit: (submission: CommentSubmission) => Promise<CommentSubmitResult> };
  workspaceId: string;
  ipHashSalt: string;
  /** Host-owned HTTP request budget, separate from the ingress policy's submission budget. */
  rateLimiter: CommentRateLimiter;
  /** Host-selected trusted proxy policy; the raw address is hashed only at this boundary. */
  clientIp: (required: { request: Request }, optional?: Record<string, never>) => string;
}

/** The per-request signal bag (honeypot value, IP hash) — split out of `buildCommentSubmission` so
 * that function's own field count stays clear of the complexity ceiling. @complexity O(IP length). */
function buildIngressContext(req: Request, deps: CommentSubmitRequired, body: Record<string, unknown>) {
  // Resolve with the host's trust policy and hash before the address leaves HTTP.
  const ip = deps.clientIp({ request: req }, {});
  return {
    authorIpHash: createHash("sha256").update(`${ip}:${deps.ipHashSalt}`).digest("hex"),
    honeypotValue: typeof body.website === "string" ? body.website : "", // conventional honeypot field name
  };
}

/**
 * Normalizes the untyped request body into a `CommentSubmission`. Every field below defaults or
 * clamps independently (undefined-means-empty for required strings, falsy-means-null for optional
 * ones) — same behavior as before this was a named function, just no longer inline in the handler.
 *
 * @complexity O(1).
 */
function buildCommentSubmission(req: Request, body: Record<string, unknown>, deps: CommentSubmitRequired): CommentSubmission {
  return {
    workspaceId: deps.workspaceId,
    entryId: String(body.entryId ?? ""),
    parentId: body.parentId ? String(body.parentId) : null,
    authorName: String(body.authorName ?? "").slice(0, 200),
    authorEmail: body.authorEmail ? String(body.authorEmail).slice(0, 320) : null,
    authorUrl: body.authorUrl ? String(body.authorUrl).slice(0, 2000) : null,
    bodyRaw: String(body.body ?? ""),
    authorPrincipalId: null, // v1: anonymous-only public route; member-attributed submission is a named deferral
    ingressContext: buildIngressContext(req, deps, body),
  };
}

/** Refuses a missing or empty string dep by name. @throws {TypeError} When `value` is not a non-empty string. @complexity O(1). */
function requireNonEmptyString(required: { name: "workspaceId" | "ipHashSalt"; value: unknown }, _optional: Record<string, never>): void {
  if (typeof required.value !== "string" || required.value.length === 0) {
    throw new TypeError(`comments submit handler requires ${required.name}`);
  }
}

/** Construction-time refusal of a missing or invalid required port. @throws {TypeError} Naming the first bad dep. @complexity O(1). */
function assertSubmitDeps(deps: CommentSubmitRequired): void {
  if (typeof deps?.ingressPolicy?.submit !== "function") {
    throw new TypeError("comments submit handler requires ingressPolicy");
  }
  requireNonEmptyString({ name: "workspaceId", value: deps.workspaceId }, {});
  requireNonEmptyString({ name: "ipHashSalt", value: deps.ipHashSalt }, {});
  if (typeof deps.rateLimiter?.check !== "function") {
    throw new TypeError("comments submit handler requires rateLimiter");
  }
  if (typeof deps.clientIp !== "function") {
    throw new TypeError("comments submit handler requires clientIp");
  }
}

/** The no-JS landing fragment. A tripped honeypot lands exactly like an accepted (held) comment, so a bot
 * filling the hidden field learns nothing; a real visitor never fills it, so no human is misled.
 * @complexity O(1). */
function formOutcome(result: CommentSubmitResult): "comment-pending" | "comment-error" {
  return result.ok || result.reason === "honeypot-tripped" ? "comment-pending" : "comment-error";
}

/** Builds the anonymous submission handler; the host owns route mounting and salt policy.
 * @throws {TypeError} When ingressPolicy, workspaceId, ipHashSalt, rateLimiter or clientIp is missing or invalid.
 * @returns An Express handler preserving the source route's normalization and HTTP responses.
 * @complexity O(body length) normalization and hashing plus the ingress port's work.
 */
export function createCommentSubmitHandler(deps: CommentSubmitRequired, optional: {
  formRedirect?: (required: { request: Request }) => string | undefined;
  /** Best-effort notification after ingress accepts; failure cannot undo the committed comment. */
  onAccepted?: (required: { request: Request; submission: CommentSubmission; comment: { id: string; status: string } }) => void | Promise<void>;
} = {}): RequestHandler {
  assertSubmitDeps(deps);
  return async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const submission = buildCommentSubmission(req, body, deps);
      const rateLimit = await deps.rateLimiter.check({ key: String(submission.ingressContext.authorIpHash) });
      const result: CommentSubmitResult = rateLimit.allowed
        ? await deps.ingressPolicy.submit(submission)
        : { ok: false, reason: "rate-limited" };
      if (result.ok) {
        try { await optional.onAccepted?.({ request: req, submission, comment: result.comment }); }
        catch { /* A notification cannot turn an accepted comment into a failed submission. */ }
      }

      const redirect = optional.formRedirect?.({ request: req });
      if (redirect !== undefined) {
        res.redirect(303, `${redirect}#${formOutcome(result)}`);
        return;
      }
      if (!result.ok) {
        // No oracle: every rejection reason maps to the SAME generic 422, distinguishable only in
        // the response body's `reason` for legitimate client-side form UX, never a status-code tell.
        res.status(422).json({ error: "comment was not accepted", reason: result.reason });
        return;
      }

      res.status(201).json({ id: result.comment.id, status: result.comment.status });
    } catch (err) {
      // Public, unauthenticated route (this file's own header) — any visitor's malformed or
      // hostile submission must still get a fast, honest response, never a hang; an unguarded
      // failure here is reachable by anyone, not just an authenticated admin.
      console.error("[site/comments-submit] unexpected error", err);
      res.status(500).json({ error: "internal error", code: "INTERNAL_ERROR" });
    }
  };
}
