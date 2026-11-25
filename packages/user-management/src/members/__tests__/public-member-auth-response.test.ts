import { expect, it, vi } from "vitest";
import { memberAuthRefusal, memberCookieExpiry, memberSignInRefusal } from "../public-member-auth-response.js";
import { MemberAuthError, MemberSignInUnavailableError, MemberValidationError } from "../types.js";

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
