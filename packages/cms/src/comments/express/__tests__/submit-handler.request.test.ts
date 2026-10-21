import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { afterEach, test, vi } from "vitest";
import type { CommentIngressResult } from "../../ports.js";
import type { CommentRecord, CommentSubmission } from "../../types.js";
import { createCommentSubmitHandler, type CommentSubmitRequired } from "../index.js";

const SALT = "host-owned-salt";
const CLIENT_IP = "203.0.113.1";
const IP_HASH = createHash("sha256").update(`${CLIENT_IP}:${SALT}`).digest("hex");

const ACCEPTED: CommentRecord = {
  id: "comment-1", workspaceId: "workspace-1", entryId: "entry-1", parentId: null, threadRootId: "comment-1",
  depth: 0, status: "pending", authorPrincipalId: null, authorName: "Ada", authorEmail: null, authorUrl: null,
  authorIpHash: IP_HASH, bodyText: "hello", spamScore: null, spamProvider: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
};

interface Harness {
  deps: CommentSubmitRequired;
  submissions: CommentSubmission[];
}

function harness(optional: { submit?: () => Promise<CommentIngressResult>; overrides?: Partial<CommentSubmitRequired> } = {}): Harness {
  const submissions: CommentSubmission[] = [];
  const submit = optional.submit ?? (async () => ({ ok: true, comment: ACCEPTED, autoClassified: "pending" }) as const);
  const deps: CommentSubmitRequired = {
    workspaceId: "workspace-1", ipHashSalt: SALT,
    clientIp: () => CLIENT_IP,
    rateLimiter: { check: async () => ({ allowed: true }) },
    ingressPolicy: { submit: async (submission) => { submissions.push(submission); return submit(); } },
    ...optional.overrides,
  };
  return { deps, submissions };
}

async function send(deps: CommentSubmitRequired, body: unknown): Promise<{ status?: number; payload?: unknown }> {
  const out: { status?: number; payload?: unknown } = {};
  const response = {
    status(code: number) { out.status = code; return this; },
    json(payload: unknown) { out.payload = payload; return this; },
  };
  const request = { body, ip: "untrusted-request-ip" } as Request;
  await createCommentSubmitHandler(deps, {})(request, response as Response, () => assert.fail("unexpected next call"));
  return out;
}

afterEach(() => { vi.restoreAllMocks(); });

test("an accepted submission answers 201 with only the comment id and status", async () => {
  const { deps } = harness();
  const out = await send(deps, { entryId: "entry-1", body: "hello" });
  assert.equal(out.status, 201);
  assert.deepEqual(out.payload, { id: "comment-1", status: "pending" });
});

test("a full body is normalized into the submission with lengths clamped", async () => {
  const { deps, submissions } = harness();
  await send(deps, {
    entryId: "entry-1", parentId: "parent-1", body: "hello", website: "bot-filled",
    authorName: "n".repeat(250), authorEmail: "e".repeat(400), authorUrl: "u".repeat(2500),
  });
  assert.deepEqual(submissions, [{
    workspaceId: "workspace-1", entryId: "entry-1", parentId: "parent-1",
    authorName: "n".repeat(200), authorEmail: "e".repeat(320), authorUrl: "u".repeat(2000),
    bodyRaw: "hello", authorPrincipalId: null,
    ingressContext: { authorIpHash: IP_HASH, honeypotValue: "bot-filled" },
  }]);
});

test("an empty body defaults required strings to empty and optional ones to null", async () => {
  const { deps, submissions } = harness();
  await send(deps, {});
  assert.deepEqual(submissions, [{
    workspaceId: "workspace-1", entryId: "", parentId: null, authorName: "", authorEmail: null, authorUrl: null,
    bodyRaw: "", authorPrincipalId: null, ingressContext: { authorIpHash: IP_HASH, honeypotValue: "" },
  }]);
});

test("a non-string honeypot field is treated as empty", async () => {
  const { deps, submissions } = harness();
  await send(deps, { website: 42 });
  assert.equal(submissions[0]?.ingressContext.honeypotValue, "");
});

test("an ingress failure answers a generic 500 and logs the cause", async () => {
  const cause = new Error("store down");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps } = harness({ submit: async () => { throw cause; } });
  const out = await send(deps, { entryId: "entry-1" });
  assert.equal(out.status, 500);
  assert.deepEqual(out.payload, { error: "internal error", code: "INTERNAL_ERROR" });
  assert.deepEqual(log.mock.calls, [["[site/comments-submit] unexpected error", cause]]);
});

test("a rate-limiter failure answers a generic 500", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps } = harness({ overrides: { rateLimiter: { check: async () => { throw new Error("redis down"); } } } });
  const out = await send(deps, { entryId: "entry-1" });
  assert.deepEqual([out.status, out.payload], [500, { error: "internal error", code: "INTERNAL_ERROR" }]);
});

test("a clientIp policy failure answers a generic 500", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps } = harness({ overrides: { clientIp: () => { throw new Error("no trusted proxy"); } } });
  const out = await send(deps, { entryId: "entry-1" });
  assert.deepEqual([out.status, out.payload], [500, { error: "internal error", code: "INTERNAL_ERROR" }]);
});

// A request with no parsed body (host forgot a JSON body parser, or a non-JSON content type) is a
// client/host error, yet it surfaces as a 500 rather than a 4xx.
test("a request with no parsed body answers 500, not a 4xx (reported, not fixed)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps, submissions } = harness();
  const out = await send(deps, undefined);
  assert.deepEqual([out.status, out.payload], [500, { error: "internal error", code: "INTERNAL_ERROR" }]);
  assert.equal(submissions.length, 0);
});

test('host-selected form redirects use 303 and keep pending/rejected records private', async () => {
  for (const accepted of [true, false]) {
    const { deps } = harness({ submit: async () => accepted
      ? { ok: true, comment: ACCEPTED, autoClassified: 'pending' }
      : { ok: false, reason: 'entry-not-found' } });
    let redirect: unknown;
    const response = { redirect: (status: number, location: string) => { redirect = { status, location }; } };
    await createCommentSubmitHandler(deps, { formRedirect: () => '/entry' })(
      { body: {} } as Request, response as unknown as Response, () => undefined);
    assert.deepEqual(redirect, { status: 303, location: `/entry#${accepted ? 'comment-pending' : 'comment-error'}` });
  }
  const { deps: trapped } = harness({ submit: async () => ({ ok: false, reason: 'honeypot-tripped' }) });
  let trappedRedirect: unknown;
  await createCommentSubmitHandler(trapped, { formRedirect: () => '/entry' })({ body: {} } as Request,
    { redirect: (status: number, location: string) => { trappedRedirect = { status, location }; } } as unknown as Response, () => undefined);
  assert.deepEqual(trappedRedirect, { status: 303, location: '/entry#comment-pending' }, 'a bot cannot tell it was trapped');
  const { deps } = harness();
  let payload: unknown;
  const response = { status() { return response; }, json(value: unknown) { payload = value; } };
  await createCommentSubmitHandler(deps, { formRedirect: () => undefined })({ body: {} } as Request, response as unknown as Response, () => undefined);
  assert.deepEqual(payload, { id: ACCEPTED.id, status: 'pending' });
});

test('trusted-proxy client resolution produces independent salted visitor rate-limit keys', async () => {
  const keys: string[] = [];
  const { deps } = harness({ overrides: { clientIp: ({ request }) => request.ip!, rateLimiter: { check: async ({ key }) => { keys.push(key); return { allowed: true }; } } } });
  const response = { status() { return response; }, json() { return response; } };
  for (const ip of ['203.0.113.1', '203.0.113.2']) await createCommentSubmitHandler(deps)({ body: {}, ip } as Request, response as unknown as Response, () => undefined);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.every(key => /^[a-f0-9]{64}$/.test(key)));
});
