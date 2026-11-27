import { describe, expect, it } from "vitest";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberRequestMagicLinkRoute, type MemberRequestSignInLinkFn, type MemberRequestMagicLinkRouteDeps } from "../request-magic-link.js";
import type { MemberErrorClassifier } from "../shared.js";
import { classifyMemberError, FakeMemberValidationError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** The host's members library and mailer own these classes; the spec only sees them through the classifier. */
class FakeSignInUnavailableError extends Error {}
class FakeSenderNotConfiguredError extends Error {}
const classify: MemberErrorClassifier = ({ err }) => {
  if (err instanceof FakeSignInUnavailableError) return "sign-in-unavailable";
  if (err instanceof FakeSenderNotConfiguredError) return "sender-not-configured";
  return classifyMemberError({ err });
};

const SENDER_COPY = "host sender copy";
const PATH = "/api/admin/v1/workspaces/:workspaceId/members/request-magic-link";
type Limit = Awaited<ReturnType<MemberRequestMagicLinkRouteDeps["magicLinkPerEmailLimiter"]["check"]>>;

/** Deps that record every collaborator call, in order, on one shared log. */
function fixture({ send, limit = { allowed: true } }: { send?: MemberRequestSignInLinkFn; limit?: Limit } = {}) {
  const order: unknown[] = [];
  const deps: MemberRequestMagicLinkRouteDeps = {
    workspaceId: WORKSPACE_ID, classifyMemberError: classify, senderNotConfiguredMessage: SENDER_COPY,
    magicLinkPerEmailLimiter: { check: async (input) => { order.push(input); return limit; } },
    requestSignInLink: async (input) => { order.push(input); return send ? send(input) : { delivered: true, challengeId: "ch-1" }; },
  };
  return { deps, order };
}

describe("memberRequestMagicLinkRoute", () => {
  it("keeps the method and path, no success status or body cap, and reads the two body fields", () => {
    expect(memberRequestMagicLinkRoute.method).toBe("post");
    expect(memberRequestMagicLinkRoute.path).toBe(PATH);
    expect(memberRequestMagicLinkRoute.successStatus).toBeUndefined();
    expect(memberRequestMagicLinkRoute.maxBodyBytes).toBeUndefined();
    expect(memberRequestMagicLinkRoute.parse(raw({}, {}, { email: " A@B.co ", redirectPath: "/account" }))).toEqual({ ok: true, value: { body: { email: " A@B.co ", redirectPath: "/account" } } });
    expect(memberRequestMagicLinkRoute.parse(raw({}, {}, undefined))).toEqual({ ok: true, value: { body: {} } });
  });

  it("authorizes member.manage on `member` with no entity id, then checks the trimmed lower-cased email, then sends the raw email", async () => {
    const { deps, order } = fixture();
    const { authorize, calls } = recordingAuthorize();
    const result = await memberRequestMagicLinkRoute.handle({ input: { body: { email: " Person@Example.com ", redirectPath: "/account" } }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "member.manage", entityType: "member" }]);
    expect(order).toEqual([{ key: "person@example.com" }, { workspaceId: WORKSPACE_ID, email: " Person@Example.com ", redirectPath: "/account" }]);
    expect(result).toEqual({ ok: true, value: { delivered: true, challengeId: "ch-1" } });
  });

  it("refuses an unauthorized caller before the limiter or the mailer (INV-NEW-03)", async () => {
    const { deps, order } = fixture();
    const { authorize } = recordingAuthorize(["member.manage"]);
    await expect(memberRequestMagicLinkRoute.handle({ input: { body: { email: "" } }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied member.manage");
    expect(order).toEqual([]);
  });

  it("string-coerces the two body fields after authorizing, as the hand-written route read them", async () => {
    const { deps, order } = fixture();
    const { authorize } = recordingAuthorize();
    await memberRequestMagicLinkRoute.handle({ input: { body: { email: 7, redirectPath: "" } }, deps, context: PRINCIPAL, authorize });
    expect(order).toEqual([{ key: "7" }, { workspaceId: WORKSPACE_ID, email: "7", redirectPath: undefined }]);
  });

  it("answers a denied caller the legacy 403 even when field coercion would throw (mutation: coerce-magic-link-before-authorize)", async () => {
    const { deps, order } = fixture();
    const denyWith403 = async () => rejectRoute({ status: 403, error: "forbidden" });
    const hostile = { toString: () => { throw new TypeError("coercion ran before authorize"); } };
    const body = memberRequestMagicLinkRoute.parse(raw({}, {}, { email: hostile, redirectPath: hostile }));
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(await refusalOf(() => memberRequestMagicLinkRoute.handle({ input: body.value, deps, context: PRINCIPAL, authorize: denyWith403 }))).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(order).toEqual([]);
  });

  it("answers an empty email with a code-less 400 without consuming the limiter", async () => {
    const { deps, order } = fixture();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => memberRequestMagicLinkRoute.handle({ input: { body: { email: "  " } }, deps, context: PRINCIPAL, authorize }))).toEqual({ status: 400, body: { error: "'  ' is not a valid email address" } });
    expect(order).toEqual([]);
  });

  it("answers a spent budget with 429, Retry-After and the retry details, without sending", async () => {
    const { deps, order } = fixture({ limit: { allowed: false, retryAfterSeconds: 23 } });
    const { authorize } = recordingAuthorize();
    const result = await memberRequestMagicLinkRoute.handle({ input: { body: { email: "a@b.co" } }, deps, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { status: 429, body: { error: "too many sign-in requests for this email", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 23 } }, headers: { "Retry-After": "23" } } });
    expect(order).toEqual([{ key: "a@b.co" }]);
  });

  for (const [error, status, body] of [
    [new FakeSignInUnavailableError("Site mail is disabled"), 503, { error: "Site mail is disabled", code: "MEMBER_SIGN_IN_UNAVAILABLE" }],
    [new FakeSenderNotConfiguredError("smtp sender missing"), 503, { error: SENDER_COPY, code: "MEMBER_SIGN_IN_UNAVAILABLE" }],
    [new FakeMemberValidationError("invalid address"), 400, { error: "invalid address" }],
  ] as const) {
    it(`maps ${error.constructor.name} to ${status}`, async () => {
      const { deps } = fixture({ send: async () => { throw error; } });
      const { authorize } = recordingAuthorize();
      expect(await refusalOf(() => memberRequestMagicLinkRoute.handle({ input: { body: { email: "a@b.co" } }, deps, context: PRINCIPAL, authorize }))).toEqual({ status, body });
    });
  }

  it("rethrows an unclassified failure (and a not-found, which this route never mapped) for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    for (const error of [new Error("private mailer detail"), Object.assign(new Error("gone"), { kind: "x" })]) {
      const { deps } = fixture({ send: async () => { throw error; } });
      const notFound: MemberErrorClassifier = ({ err }) => (err === error && error.message === "gone" ? "not-found" : classify({ err }));
      await expect(memberRequestMagicLinkRoute.handle({ input: { body: { email: "a@b.co" } }, deps: { ...deps, classifyMemberError: notFound }, context: PRINCIPAL, authorize })).rejects.toBe(error);
    }
  });

  it("fails closed without an authorizer (a wiring bug)", async () => {
    const { deps, order } = fixture();
    await expect(memberRequestMagicLinkRoute.handle({ input: { body: { email: "a@b.co" } }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(order).toEqual([]);
  });
});

it("returns the classified mailer failure if it is delivered as a string", async () => {
  const failure = "Sign-in mail is temporarily disabled";
  const { deps, order } = fixture({ send: async () => { throw failure; } });
  const classifyMemberError: MemberErrorClassifier = ({ err }) => err === failure ? "sign-in-unavailable" : undefined;
  expect(await refusalOf(() => memberRequestMagicLinkRoute.handle({
    input: { body: { email: "maria@example.test" } }, deps: { ...deps, classifyMemberError },
    context: PRINCIPAL, authorize: recordingAuthorize().authorize,
  }))).toStrictEqual({ status: 503, body: { error: "Sign-in mail is temporarily disabled", code: "MEMBER_SIGN_IN_UNAVAILABLE" } });
  expect(order[0]).toStrictEqual({ key: "maria@example.test" });
});
