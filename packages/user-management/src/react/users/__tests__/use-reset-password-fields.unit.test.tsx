import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminIdentityUser } from "../../models.js";
import { useResetPasswordFields, type ResetPasswordFieldsInput } from "../hooks/use-reset-password-fields.hooks.js";

function fakeUser(principalId: string): AdminIdentityUser {
  return {
    principalId,
    workspaceId: "w1",
    username: `user-${principalId}`,
    email: undefined,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    roleIds: [],
    policyIds: [],
  };
}

const USER_A = fakeUser("u1");
const USER_B = fakeUser("u2");

function renderFields(input: ResetPasswordFieldsInput) {
  return renderHook((props: ResetPasswordFieldsInput) => useResetPasswordFields(props), { initialProps: input });
}

describe("useResetPasswordFields", () => {
  it("starts hidden, with an empty confirm field", () => {
    const { result } = renderFields({ resetPasswordFor: USER_A, newPassword: "" });

    expect(result.current.confirmPassword).toBe("");
    expect(result.current.showNewPassword).toBe(false);
    expect(result.current.showConfirmPassword).toBe(false);
  });

  it("mismatch is false when both fields are empty, and true the moment they diverge", () => {
    const { result, rerender } = renderFields({ resetPasswordFor: USER_A, newPassword: "" });
    expect(result.current.mismatch).toBe(false);

    rerender({ resetPasswordFor: USER_A, newPassword: "correct-horse" });
    expect(result.current.mismatch).toBe(true);

    act(() => result.current.setConfirmPassword("correct-horse"));
    expect(result.current.mismatch).toBe(false);

    act(() => result.current.setConfirmPassword("correct-hors"));
    expect(result.current.mismatch).toBe(true);
  });

  it("toggleShowNewPassword and toggleShowConfirmPassword flip only their own flag", () => {
    const { result } = renderFields({ resetPasswordFor: USER_A, newPassword: "" });

    act(() => result.current.toggleShowNewPassword());
    expect(result.current.showNewPassword).toBe(true);
    expect(result.current.showConfirmPassword).toBe(false);

    act(() => result.current.toggleShowConfirmPassword());
    expect(result.current.showNewPassword).toBe(true);
    expect(result.current.showConfirmPassword).toBe(true);

    act(() => result.current.toggleShowNewPassword());
    expect(result.current.showNewPassword).toBe(false);
    expect(result.current.showConfirmPassword).toBe(true);
  });

  it("resets confirmPassword and both reveal flags when the dialog re-opens for a different user", () => {
    const { result, rerender } = renderFields({ resetPasswordFor: USER_A, newPassword: "typo1" });
    act(() => result.current.setConfirmPassword("typo2"));
    act(() => result.current.toggleShowNewPassword());
    act(() => result.current.toggleShowConfirmPassword());
    expect(result.current.confirmPassword).toBe("typo2");
    expect(result.current.showNewPassword).toBe(true);
    expect(result.current.showConfirmPassword).toBe(true);

    rerender({ resetPasswordFor: null, newPassword: "" });

    rerender({ resetPasswordFor: USER_B, newPassword: "" });

    expect(result.current.confirmPassword).toBe("");
    expect(result.current.showNewPassword).toBe(false);
    expect(result.current.showConfirmPassword).toBe(false);
  });

  it("resets on every reopen of the SAME user too, keyed on principalId rather than object identity", () => {
    const { result, rerender } = renderFields({ resetPasswordFor: USER_A, newPassword: "" });
    act(() => result.current.toggleShowNewPassword());
    expect(result.current.showNewPassword).toBe(true);

    rerender({ resetPasswordFor: null, newPassword: "" });

    rerender({ resetPasswordFor: fakeUser("u1"), newPassword: "" });

    expect(result.current.showNewPassword).toBe(false);
  });
});
