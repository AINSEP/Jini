// @vitest-environment jsdom
import { useState } from "react";
import { render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { OwnerRecoverySignIn } from "../OwnerRecoverySignIn.js";
import { useOwnerRecoverySignIn } from "../OwnerRecoverySignIn.hooks.js";
import type { AuthErrorNotice, AuthSecretInput, UseRecoveryCodeSignInHook } from "../auth-host-slots.js";

const SecretInput: AuthSecretInput = ({ label: _label, ...props }) => <input type="password" {...props} />;
const ErrorNotice: AuthErrorNotice = ({ failure, t }) => <p role="alert">{t(failure.message)}</p>;
const failure = {
  message: "Recovery was refused", action: "Request operator help", step: "owner-recovery-redeem",
  cause: "Invalid code", copyText: "Recovery was refused",
};

it("passes translated controller copy and both sensitive values to the host failure describer", () => {
  const recover = vi.fn(async () => ({}));
  const ownerRecoveryFailure = vi.fn(() => failure);
  const t = (key: string) => "translated: " + key;
  const controller: ReturnType<UseRecoveryCodeSignInHook> = {
    code: "  saved-code  ", password: "test-password", confirmation: "", busy: false, failure: null, message: "",
    setCode: vi.fn(), setPassword: vi.fn(), setConfirmation: vi.fn(), submit: vi.fn(async () => {}),
  };
  const useRecoveryCodeSignIn = vi.fn<UseRecoveryCodeSignInHook>(() => controller);
  const { result } = renderHook(() => useOwnerRecoverySignIn({ recover, t, useRecoveryCodeSignIn, ownerRecoveryFailure }));
  expect(result.current).toBe(controller);
  expect(useRecoveryCodeSignIn.mock.calls).toHaveLength(1);
  const [options, extras] = useRecoveryCodeSignIn.mock.calls[0]!;
  expect(extras).toEqual({});
  expect(options.recover).toBe(recover);
  expect(options.copy).toEqual({
    mismatch: "translated: The passwords do not match. Enter the same password in both fields. Details: owner-recovery-confirmation",
    recovered: "translated: Owner password reset. Sign in with your new password. Authenticators, passkeys, sessions and recovery codes were invalidated.",
    reset: "",
  });
  const error = new Error("request refused");
  expect(options.describeFailure({ error, scope: "recover" })).toBe(failure);
  expect(ownerRecoveryFailure.mock.calls).toEqual([[{
    error, message: "The owner account could not be recovered.",
    action: "Follow the server explanation. Ask the host operator for help if recovery is unavailable.",
    step: "owner-recovery-redeem", t, secrets: ["saved-code", "test-password"],
  }]]);
});

it("binds and hides all recovery inputs from agents, and shows the host notice after submission", async () => {
  const recover = vi.fn(async () => ({}));
  const submit = vi.fn();
  const user = userEvent.setup();
  render(<OwnerRecoverySignIn recover={recover} SecretInput={SecretInput} ErrorNotice={ErrorNotice}
    useOwnerRecoverySignInHook={() => {
      const [code, setCode] = useState("");
      const [password, setPassword] = useState("");
      const [confirmation, setConfirmation] = useState("");
      const [failed, setFailed] = useState(false);
      return {
        code, setCode, password, setPassword, confirmation, setConfirmation,
        busy: false, failure: failed ? failure : null, message: failed ? "Use a different code." : "",
        submit: async (event) => { event.preventDefault(); submit({ code, password, confirmation }); setFailed(true); },
      };
    }}
  />);
  await user.click(screen.getByText("Lost your owner password?"));
  const details = within(screen.getByText("Lost your owner password?").closest("details")!);
  const button = details.getByRole("button", { name: "Recover owner account" });
  expect(button).toBeDisabled();
  expect(details.queryByRole("alert")).toBeNull();
  for (const [label, input, maxLength] of [
    ["Recovery code", "saved-code", 64],
    ["New password", "test-password", 512],
    ["Confirm new password", "other-password", 512],
  ] as const) {
    const field = details.getByLabelText(label, { exact: true });
    expect(field).toHaveAttribute("data-agent-private", "");
    expect(field).toHaveAttribute("maxlength", String(maxLength));
    await user.type(field, input);
    expect(field).toHaveValue(input);
    if (label === "Recovery code") expect(button).toBeDisabled();
  }
  await user.click(button);
  expect(submit.mock.calls).toEqual([[{ code: "saved-code", password: "test-password", confirmation: "other-password" }]]);
  expect(details.getByRole("alert")).toHaveTextContent("Recovery was refused");
  expect(details.getByRole("status")).toHaveTextContent("Use a different code.");
});

it("does not allow another recovery submission while the controller is busy", async () => {
  const user = userEvent.setup();
  const submit = vi.fn(async () => {});
  render(<OwnerRecoverySignIn recover={vi.fn()} SecretInput={SecretInput} ErrorNotice={ErrorNotice}
    useOwnerRecoverySignInHook={() => ({
      code: "saved-code", password: "test-password", confirmation: "test-password",
      busy: true, failure: null, message: "", setCode: vi.fn(), setPassword: vi.fn(), setConfirmation: vi.fn(), submit,
    })}
  />);
  await user.click(screen.getByText("Lost your owner password?"));
  const button = screen.getByRole("button", { name: "Recover owner account" });
  expect(button).toBeDisabled();
  await user.click(button);
  expect(submit.mock.calls).toEqual([]);
});
