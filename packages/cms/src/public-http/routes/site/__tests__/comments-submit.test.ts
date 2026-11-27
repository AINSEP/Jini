import type { CommentsProviderAdapter, CommentsProviderRegistry } from "@jini-ai/core/contracts/site/comments-providers";
import { describe, expect, it, vi } from "vitest";

import { createCommentSubmitHandler } from "../../../../comments/express/index.js";
import type { CommentSubmission } from "../../../../comments/types.js";
import { commentFormReturnTo, commentProviderIngress, isSameOriginCommentPost, registerCommentsSubmitRoute } from "../comments-submit.js";

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

type RouteDeps = Parameters<typeof registerCommentsSubmitRoute>[0]['deps'];

function submitRouteFixture() {
  const ingress = vi.fn<RouteDeps['ingressPolicy']['submit']>(async () => ({
    ok: true, comment: { id: 'comment-7', status: 'pending' },
  }));
  const onAccepted = vi.fn<RouteDeps['onAccepted']>();
  const formParser: RouteDeps['formParser'] = (_req, _res, next) => next();
  const mount = vi.fn<(path: string, parser: RouteDeps['formParser'], handler: RouteDeps['formParser']) => void>();
  const app = { post: mount } as unknown as Parameters<typeof registerCommentsSubmitRoute>[0]['app'];
  const deps: RouteDeps = {
    createCommentSubmitHandler, ingressPolicy: { submit: ingress }, workspaceId: 'site-west',
    rateLimiter: { check: async () => ({ allowed: true }) }, ipHashSalt: Promise.resolve('fixture-salt'),
    clientIp: () => '192.0.2.71', onAccepted, isSameOriginCommentPost: () => true, formParser,
  };
  function register(overrides: Partial<RouteDeps> = {}) {
    registerCommentsSubmitRoute({ app, deps: { ...deps, ...overrides } });
    const [path, parser, handler] = mount.mock.calls[0]!;
    expect(path).toBe('/api/site/comments');
    expect(parser).toBe(formParser);
    return handler;
  }
  return { app, deps, onAccepted, ingress, mount, register };
}

const commentBody = { entryId: 'entry-3', authorName: 'Reader', body: 'Thanks for the article',
  returnTo: '/articles/archive?page=2#old-anchor' };

it.each([
  ['application/x-www-form-urlencoded', null, [303, '/articles/archive?page=2#comment-pending']],
  ['application/json', [201, { id: 'comment-7', status: 'pending' }], null],
] as const)('uses the configured ingress and the correct reply protocol for %s', async (contentType, jsonReply, formReply) => {
  const { register, ingress } = submitRouteFixture();
  const submit = register();
  const request = {
    body: commentBody,
    is: (type: string) => type === contentType ? type : false,
  } as unknown as import('express').Request;
  const redirect = vi.fn();
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const next = vi.fn();
  await submit(request, { status, redirect } as unknown as import('express').Response, next);
  expect(next).not.toHaveBeenCalled();
  expect(ingress).toHaveBeenCalledExactlyOnceWith({
    workspaceId: 'site-west', entryId: 'entry-3', parentId: null,
    authorName: 'Reader', authorEmail: null, authorUrl: null, bodyRaw: 'Thanks for the article',
    authorPrincipalId: null, ingressContext: { authorIpHash: 'f184921e1f8934bc806c1cfb3cd5bd955263adfdbfab5350c7905cc21ddc5209', honeypotValue: '' },
  });
  expect(redirect.mock.calls).toEqual(formReply ? [formReply] : []);
  expect(status.mock.calls).toEqual(jsonReply ? [[jsonReply[0]]] : []);
  expect(json.mock.calls).toEqual(jsonReply ? [[jsonReply[1]]] : []);
});

it('dispatches a submitted comment to the active provider instead of the fallback ingress', async () => {
  const { register, ingress, onAccepted } = submitRouteFixture();
  const storedSubmit = vi.fn<Extract<CommentsProviderAdapter, { kind: 'stored' }>['submission']['submit']>(
    async () => ({ ok: true, id: 'stored-5', status: 'pending' }),
  );
  const adapter: CommentsProviderAdapter = { kind: 'stored', renderer: {} as never, moderation: {} as never,
    submission: { submit: storedSubmit } };
  const active = vi.fn(async () => ({ providerId: 'native', revision: 2, adapter }));
  const handler = register({ providers: { active } as unknown as CommentsProviderRegistry });
  const request = { body: commentBody, is: () => false } as unknown as import('express').Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  await handler(request, { status } as unknown as import('express').Response, vi.fn());
  expect(active).toHaveBeenCalledExactlyOnceWith({ siteId: 'site-west' });
  expect(ingress).not.toHaveBeenCalled();
  expect(storedSubmit).toHaveBeenCalledExactlyOnceWith({
    siteId: 'site-west', entryId: 'entry-3', parentId: null, authorName: 'Reader', authorEmail: null, authorUrl: null,
    bodyRaw: 'Thanks for the article', authorIpHash: 'f184921e1f8934bc806c1cfb3cd5bd955263adfdbfab5350c7905cc21ddc5209', honeypotValue: '',
  });
  expect(status).toHaveBeenCalledExactlyOnceWith(201);
  expect(json).toHaveBeenCalledExactlyOnceWith({ id: 'stored-5', status: 'pending' });
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith({
    request, submission: { workspaceId: 'site-west', entryId: 'entry-3', parentId: null, authorName: 'Reader', authorEmail: null,
      authorUrl: null, bodyRaw: 'Thanks for the article', authorPrincipalId: null,
      ingressContext: { authorIpHash: 'f184921e1f8934bc806c1cfb3cd5bd955263adfdbfab5350c7905cc21ddc5209', honeypotValue: '' } },
    comment: { id: 'stored-5', status: 'pending' },
  });
});

it('rejects a missing salt promise before mounting the POST', () => {
  const { app, deps, mount } = submitRouteFixture();
  expect(() => registerCommentsSubmitRoute({ app, deps: { ...deps, ipHashSalt: undefined as unknown as Promise<string> } }))
    .toThrow(new TypeError('registerCommentsSubmitRoute requires deps.ipHashSalt (a Promise<string> from resolveCommentsIpHashSalt at the composition root)'));
  expect(mount).not.toHaveBeenCalled();
});

it('forwards handler preparation failure to Express without writing a response', async () => {
  const { register, ingress } = submitRouteFixture();
  const error = new TypeError('comment handler could not be built');
  const create = vi.fn<RouteDeps['createCommentSubmitHandler']>(() => { throw error; });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const handler = register({ createCommentSubmitHandler: create });
    const next = vi.fn();
    const status = vi.fn();
    const redirect = vi.fn();
    await handler({} as import('express').Request, { status, redirect } as unknown as import('express').Response, next);
    expect(create).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledExactlyOnceWith(error);
    expect(status).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(ingress).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
