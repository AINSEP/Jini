import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { test } from "vitest";
import { createCommentSubmitHandler, type CommentSubmitRequired } from "../express/index.js";

test("comment submit handler refuses every missing required port at construction", () => {
  const complete: CommentSubmitRequired = {
    ingressPolicy: { submit: async () => ({ ok: false, reason: "invalid" }) },
    workspaceId: "workspace-1",
    ipHashSalt: "host-owned-salt",
    rateLimiter: { check: async () => ({ allowed: true }) },
    clientIp: () => "203.0.113.1",
  };
  for (const key of ["ingressPolicy", "workspaceId", "ipHashSalt", "rateLimiter", "clientIp"] as const) {
    const missing: Partial<CommentSubmitRequired> = { ...complete };
    delete missing[key];
    assert.throws(() => createCommentSubmitHandler(missing as CommentSubmitRequired, {}), {
      name: "TypeError", message: `comments submit handler requires ${key}`,
    });
  }
  for (const invalid of [
    { ...complete, ingressPolicy: {} },
    { ...complete, ingressPolicy: null },
    { ...complete, workspaceId: "" },
    { ...complete, workspaceId: 0 },
    { ...complete, ipHashSalt: "" },
    { ...complete, ipHashSalt: 0 },
  ]) {
    assert.throws(() => createCommentSubmitHandler(invalid as CommentSubmitRequired, {}), TypeError);
  }
  for (const [key, value] of [
    ["rateLimiter", null], ["rateLimiter", {}], ["rateLimiter", { check: true }],
    ["clientIp", null], ["clientIp", {}],
  ] as const) {
    assert.throws(() => createCommentSubmitHandler({ ...complete, [key]: value } as CommentSubmitRequired, {}), {
      name: "TypeError", message: `comments submit handler requires ${key}`,
    });
  }
  assert.throws(() => createCommentSubmitHandler(undefined as never, {}), TypeError);
  assert.doesNotThrow(() => createCommentSubmitHandler(complete, {}));
});

test.each([true, false])("comment HTTP budget allowed=%s uses the host IP and gates ingress", async (allowed) => {
  const request = { body: { entryId: "entry-1", body: "hello" }, ip: "untrusted-request-ip" } as Request;
  const expectedHash = createHash("sha256").update("203.0.113.1:host-owned-salt").digest("hex");
  const calls: string[] = [];
  let status: number | undefined;
  let payload: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    json(body: unknown) { payload = body; return this; },
  };
  const handler = createCommentSubmitHandler({
    workspaceId: "workspace-1", ipHashSalt: "host-owned-salt",
    clientIp: ({ request: received }) => {
      assert.equal(received, request);
      calls.push("clientIp");
      return "203.0.113.1";
    },
    rateLimiter: { check: async ({ key }) => {
      assert.equal(key, expectedHash);
      calls.push("rateLimiter");
      return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    } },
    ingressPolicy: { submit: async (submission) => {
      assert.equal(submission.ingressContext.authorIpHash, expectedHash);
      calls.push("ingressPolicy");
      return { ok: false, reason: "invalid" };
    } },
  }, {});
  await handler(request, response as Response, () => assert.fail("unexpected next call"));
  assert.deepEqual(calls, allowed ? ["clientIp", "rateLimiter", "ingressPolicy"] : ["clientIp", "rateLimiter"]);
  assert.equal(status, 422);
  assert.deepEqual(payload, { error: "comment was not accepted", reason: allowed ? "invalid" : "rate-limited" });
});
