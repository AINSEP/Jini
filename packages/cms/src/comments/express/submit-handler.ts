import { createHash } from "node:crypto";

import type { Request, RequestHandler } from "express";

import type { CommentIngressPolicy, CommentIngressResult } from "../ports.js";
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
export interface CommentSubmitRequired {
  ingressPolicy: CommentIngressPolicy;
  workspaceId: string;
  ipHashSalt: string;
  /** Host-owned HTTP request budget, separate from the ingress policy's submission budget. */
  rateLimiter: CommentRateLimiter;
  /** Host-selected trusted proxy policy; the raw address is hashed only at this boundary. */
  clientIp: (required: { request: Request }, optional?: Record<string, never>) => string;
}

/** Resolve with the host's trust policy and hash before the address leaves HTTP. @complexity O(IP length). */
function hashClientIp(req: Request, deps: CommentSubmitRequired): string {
  const ip = deps.clientIp({ request: req }, {});
  return createHash("sha256").update(`${ip}:${deps.ipHashSalt}`).digest("hex");
}

/** The per-request signal bag (honeypot value, IP hash) — split out of `buildCommentSubmission` so
 * that function's own field count stays clear of the complexity ceiling. @complexity O(1). */
function buildIngressContext(req: Request, deps: CommentSubmitRequired, body: Record<string, unknown>) {
  return {
    authorIpHash: hashClientIp(req, deps),
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

/** Builds the anonymous submission handler; the host owns route mounting and salt policy.
 * @throws {TypeError} When ingressPolicy, workspaceId, ipHashSalt, rateLimiter or clientIp is missing or invalid.
 * @returns An Express handler preserving the source route's normalization and HTTP responses.
 * @complexity O(body length) normalization and hashing plus the ingress port's work.
 */
export function createCommentSubmitHandler(deps: CommentSubmitRequired, _optional: Record<string, never> = {}): RequestHandler {
  if (!deps?.ingressPolicy || typeof deps.ingressPolicy.submit !== "function") {
    throw new TypeError("comments submit handler requires ingressPolicy");
  }
  if (typeof deps.workspaceId !== "string" || deps.workspaceId.length === 0) {
    throw new TypeError("comments submit handler requires workspaceId");
  }
  if (typeof deps.ipHashSalt !== "string" || deps.ipHashSalt.length === 0) {
    throw new TypeError("comments submit handler requires ipHashSalt");
  }
  if (!deps.rateLimiter || typeof deps.rateLimiter.check !== "function") {
    throw new TypeError("comments submit handler requires rateLimiter");
  }
  if (typeof deps.clientIp !== "function") {
    throw new TypeError("comments submit handler requires clientIp");
  }
  return async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const submission = buildCommentSubmission(req, body, deps);
      const rateLimit = await deps.rateLimiter.check({ key: String(submission.ingressContext.authorIpHash) });
      let result: CommentIngressResult;
      if (rateLimit.allowed) {
        result = await deps.ingressPolicy.submit(submission);
      } else {
        result = { ok: false, reason: "rate-limited" };
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
