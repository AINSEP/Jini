import type { CommentsProviderAdapter, CommentsProviderRegistry } from "@jini-ai/core/contracts/site/comments-providers";
import { describe, expect, it, vi } from "vitest";

import { createCommentSubmitHandler } from "../../../../comments/express/index.js";
import type { CommentSubmission } from "../../../../comments/types.js";
import { commentFormReturnTo, commentProviderIngress, isSameOriginCommentPost } from "../comments-submit.js";

const SERVING = "https://www.example.test";
const CONFIGURED = "https://public.example.test";

function admit(origin: string | undefined, { json = false, configured = () => CONFIGURED }: { json?: boolean; configured?: () => string } = {}) {
  return isSameOriginCommentPost({ origin, isJson: () => json, servingOrigin: () => SERVING, configuredOrigin: configured });
}

describe("commentFormReturnTo", () => {
  it("keeps a local path with its query and drops the fragment", () => {
    expect(commentFormReturnTo({ value: "/blog/post?page=2#comments" })).toBe("/blog/post?page=2");
  });
  it.each([
    ["a network-path reference", "//evil.test/x"],
    ["an absolute URL", "https://evil.test/"],
    ["a backslash", "/\\evil.test"],
    ["a carriage return", "/a\rb"],
    ["a line feed", "/a\nb"],
    ["a non-string", 42],
    ["undefined", undefined],
  ])("falls back to the site root for %s", (_label, value) => {
    expect(commentFormReturnTo({ value })).toBe("/");
  });
});

describe("isSameOriginCommentPost", () => {
  it("admits only the serving or configured origin when an Origin header is present", () => {
    expect(admit(SERVING)).toBe(true);
    expect(admit(CONFIGURED)).toBe(true);
    expect(admit("https://evil.test")).toBe(false);
    expect(admit("null")).toBe(false);
    expect(admit("https://evil.test", { json: true })).toBe(false);
  });

  it("accepts a missing Origin only for a JSON body and never falls back to a referer", () => {
    expect(admit(undefined, { json: true })).toBe(true);
    expect(admit(undefined, { json: false })).toBe(false);
  });

  it("reads origins lazily: never when Origin is missing, the configured origin only after a serving-origin miss", () => {
    const serving = vi.fn(() => SERVING);
    const configured = vi.fn(() => CONFIGURED);
    isSameOriginCommentPost({ origin: undefined, isJson: () => true, servingOrigin: serving, configuredOrigin: configured });
    expect(serving).not.toHaveBeenCalled();
    expect(configured).not.toHaveBeenCalled();
    isSameOriginCommentPost({ origin: SERVING, isJson: () => false, servingOrigin: serving, configuredOrigin: configured });
    expect(configured).not.toHaveBeenCalled();
    isSameOriginCommentPost({ origin: CONFIGURED, isJson: () => false, servingOrigin: serving, configuredOrigin: configured });
    expect(configured).toHaveBeenCalledTimes(1);
  });

  it("propagates a configured-origin failure on the consulted branch only", () => {
    const boom = () => { throw new Error("bad public url"); };
    expect(() => admit("https://evil.test", { configured: boom })).toThrow("bad public url");
    expect(admit(SERVING, { configured: boom })).toBe(true);
    expect(admit(undefined, { json: true, configured: boom })).toBe(true);
  });

  it("accepts only the admitted origin and a local form return while resolving the active stored provider per call", async () => {
    // allow-originless-form: a form (non-JSON) post with no Origin must be refused.
    expect(admit(undefined, { json: false })).toBe(false);
    expect(admit(SERVING, { json: false })).toBe(true);
    expect(commentFormReturnTo({ value: "//evil.test" })).toBe("/");
    expect(commentFormReturnTo({ value: "/thanks" })).toBe("/thanks");

    const submitted: unknown[] = [];
    const stored: CommentsProviderAdapter = { kind: "stored", renderer: {} as never, moderation: {} as never,
      submission: { submit: async (input) => { submitted.push(input); return { ok: true, id: "c1", status: "pending" }; } } };
    let adapter: CommentsProviderAdapter | undefined = stored;
    const active = vi.fn(async ({ siteId }: { siteId: string }) => ({ providerId: siteId, revision: 1, adapter }));
    const ingress = commentProviderIngress({ providers: { active } as unknown as CommentsProviderRegistry, siteId: "site-1" });
    const submission: CommentSubmission = { workspaceId: "w", entryId: "e1", parentId: null, authorName: "A", authorEmail: null,
      authorUrl: null, bodyRaw: "hi", authorPrincipalId: null, ingressContext: { authorIpHash: "hash", honeypotValue: "" } };

    expect(await ingress.submit(submission)).toEqual({ ok: true, comment: { id: "c1", status: "pending" } });
    expect(submitted[0]).toEqual({ siteId: "site-1", entryId: "e1", parentId: null, authorName: "A", authorEmail: null,
      authorUrl: null, bodyRaw: "hi", authorIpHash: "hash", honeypotValue: "" });
    adapter = undefined;
    expect(await ingress.submit(submission)).toEqual({ ok: false, reason: "comments-disabled" });
    expect(active).toHaveBeenCalledTimes(2);
  });
});

describe("commentProviderIngress", () => {
  const submission: CommentSubmission = { workspaceId: "w", entryId: "e1", parentId: "p", authorName: "A", authorEmail: "a@x.test",
    authorUrl: "https://a.test", bodyRaw: "hi", authorPrincipalId: null, ingressContext: { authorIpHash: "h", honeypotValue: "trap" } };

  it("refuses an embedded provider without touching a submission port", async () => {
    const adapter: CommentsProviderAdapter = { kind: "embedded", renderer: {} as never, dashboardUrl: "https://vendor.test" };
    const providers = { active: async () => ({ providerId: "disqus", revision: 1, adapter }) } as unknown as CommentsProviderRegistry;
    expect(await commentProviderIngress({ providers, siteId: "s" }).submit(submission)).toEqual({ ok: false, reason: "comments-disabled" });
  });

  it("passes a stored provider's rejection through unchanged", async () => {
    const adapter: CommentsProviderAdapter = { kind: "stored", renderer: {} as never, moderation: {} as never,
      submission: { submit: async () => ({ ok: false, reason: "rate-limited" }) } };
    const providers = { active: async () => ({ providerId: "native", revision: 1, adapter }) } as unknown as CommentsProviderRegistry;
    expect(await commentProviderIngress({ providers, siteId: "s" }).submit(submission)).toEqual({ ok: false, reason: "rate-limited" });
  });
});

it('refuses foreign-origin requests before enumerating the comment provider', async () => {
  const { registerCommentsSubmitRoute } = await import('../comments-submit.js');
  const active = vi.fn();
  let submit!: import('express').RequestHandler;
  const app = { post: (_path: string, _parser: unknown, handler: import('express').RequestHandler) => { submit = handler; } } as unknown as import('express').Express;
  registerCommentsSubmitRoute({ app, deps: { createCommentSubmitHandler, ingressPolicy: { submit: async () => ({ ok: false, reason: 'disabled' }) }, workspaceId: 'w', rateLimiter: { check: async () => ({ allowed: true }) }, ipHashSalt: Promise.resolve('salt'), providers: { active } as unknown as CommentsProviderRegistry,
    clientIp: () => '127.0.0.1', onAccepted: () => {}, isSameOriginCommentPost: () => false, formParser: (_req, _res, next) => next(),
  } });
  const json = vi.fn();
  const response = { status: vi.fn(() => ({ json })) } as unknown as import('express').Response;
  await submit({} as import('express').Request, response, vi.fn());
  expect(response.status).toHaveBeenCalledWith(403);
  expect(active).not.toHaveBeenCalled();
});
