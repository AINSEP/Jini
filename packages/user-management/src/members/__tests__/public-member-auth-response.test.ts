import { describe, expect, it, vi } from "vitest";
import { memberAuthRefusal, memberCookieExpiry, memberSignInRefusal, sendMemberAuthError } from "../public-member-auth-response.js";
import { MemberAuthError, MemberReauthenticationRequiredError, MemberSignInUnavailableError, MemberValidationError } from "../types.js";

it("only reset requests expose the typed validation refusal, never unknown exceptions", () => {
  expect(memberAuthRefusal({ error: new MemberValidationError("safe validation") })).toBeUndefined();
  expect(memberAuthRefusal({ error: new MemberValidationError("safe validation") }, { reset: true })).toEqual({ status: 400, body: { error: "safe validation" } });
  expect(memberAuthRefusal({ error: new Error("private") }, { reset: true })).toBeUndefined();
  expect(memberAuthRefusal({ error: new MemberAuthError("private") })).toEqual({ status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } });
  const isSenderNotConfigured = vi.fn(() => false);
  const unavailable = memberSignInRefusal({ error: new MemberSignInUnavailableError("safe unavailable"), isSenderNotConfigured, senderNotConfiguredMessage: "safe sender setup" });
  expect(unavailable).toEqual({ status: 503, body: { error: "safe unavailable", code: "MEMBER_SIGN_IN_UNAVAILABLE" } });
  expect(isSenderNotConfigured).not.toHaveBeenCalled();
  expect(memberSignInRefusal({ error: new Error("private provider"), isSenderNotConfigured: () => true, senderNotConfiguredMessage: "safe sender setup" })).toEqual({ status: 503, body: { error: "safe sender setup", code: "MEMBER_SIGN_IN_UNAVAILABLE" } });
});

it("expired cookies clamp Max-Age and retain the injected clock behavior", () => {
  const nowMs = vi.fn().mockReturnValueOnce(2000).mockReturnValueOnce(2300);
  expect(memberCookieExpiry({ expiresAtIso: new Date(1000).toISOString(), nowMs })).toEqual({ expires: new Date(2300), maxAge: 0 });
  expect(nowMs).toHaveBeenCalledTimes(2);
  const advancing = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1200);
  expect(memberCookieExpiry({ expiresAtIso: new Date(3501).toISOString(), nowMs: advancing })).toEqual({ expires: new Date(3701), maxAge: 2 });
});

it("a reauthentication demand answers its own 401 code although it is also a credential failure", () => {
  expect(memberAuthRefusal({ error: new MemberReauthenticationRequiredError("private") })).toEqual({ status: 401, body: { error: "sign in again to set a password", code: "REAUTHENTICATION_REQUIRED" } });
});

it("sign-in refusals map credential, validation and unknown failures without leaking exception text", () => {
  const isSenderNotConfigured = vi.fn(() => false);
  const refuse = (error: unknown) => memberSignInRefusal({ error, isSenderNotConfigured, senderNotConfiguredMessage: "safe sender setup" });
  expect(refuse(new MemberAuthError("private"))).toEqual({ status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } });
  expect(refuse(new MemberValidationError("safe validation"))).toEqual({ status: 400, body: { error: "safe validation" } });
  expect(refuse(new Error("private provider"))).toBeUndefined();
  expect(isSenderNotConfigured.mock.calls).toEqual([[{ error: expect.any(MemberValidationError) }], [{ error: expect.any(Error) }]]);
});

describe("sendMemberAuthError", () => {
  function harness(refusal: ReturnType<typeof memberAuthRefusal>) {
    const written: [unknown, number][] = [];
    const reported: unknown[] = [];
    const refusalCalls: unknown[] = [];
    const deps = {
      refusal: (required: { error: unknown }, options: { reset?: boolean }) => { refusalCalls.push([required, options]); return refusal; },
      report: (required: { error: unknown; operation: string }) => { reported.push(required); return { errorId: "err-7" }; },
      json: (body: unknown, status: number) => { written.push([body, status]); },
      copy: { operation: "member.sign-in", visitorError: "Something went wrong" },
    };
    return { deps, written, reported, refusalCalls };
  }

  it("writes a known refusal as-is, forwarding the reset option, and reports nothing", () => {
    const h = harness({ status: 400, body: { error: "safe validation" } });
    const error = new MemberValidationError("safe validation");
    sendMemberAuthError({ error, deps: h.deps }, { reset: true });
    expect(h.refusalCalls).toEqual([[{ error }, { reset: true }]]);
    expect(h.written).toEqual([[{ error: "safe validation" }, 400]]);
    expect(h.reported).toEqual([]);
  });

  it("reports an unexpected failure and answers the redacted 500 with its error id", () => {
    const h = harness(undefined);
    const error = new Error("private stack detail");
    sendMemberAuthError({ error, deps: h.deps });
    expect(h.refusalCalls).toEqual([[{ error }, {}]]);
    expect(h.reported).toEqual([{ error, operation: "member.sign-in" }]);
    expect(h.written).toEqual([[{ error: "Something went wrong", errorId: "err-7" }, 500]]);
  });
});
