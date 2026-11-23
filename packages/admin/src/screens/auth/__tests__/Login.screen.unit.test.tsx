// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatUserFacingError } from "@jini-ai/core";

import { Login, type LoginProps } from "../Login.js";
import type { LoginController } from "../hooks/use-login.hooks.js";
import type { AuthErrorNoticeProps, AuthPasskeySignInProps, AuthSecretInputProps } from "../auth-host-slots.js";

/**
 * @file `Login` — markup only, with every host collaborator injected: the product heading (K3),
 * the secret input, the error notice, the passkey button and the owner-recovery slot.
 */

function controller(overrides: Partial<LoginController> = {}): LoginController {
  return { username: "admin", setUsername: vi.fn(), password: "", setPassword: vi.fn(), error: null, busy: false,
    submit: vi.fn(async e => { e.preventDefault(); }), ...overrides };
}

function props(overrides: Partial<LoginProps> = {}, state: Partial<LoginController> = {}): LoginProps {
  return {
    onLogin: vi.fn(), productName: "Fixture Product",
    useLoginHook: () => controller(state), useAdminLocaleHook: () => "en",
    SecretInput: ({ id, label, value, onChange }: AuthSecretInputProps) => <input id={id} aria-label={label} type="password" value={value} onChange={onChange} />,
    ErrorNotice: ({ failure, className }: AuthErrorNoticeProps) => <div role="alert" className={className}>{failure.message}</div>,
    PasskeySignIn: ({ onComplete }: AuthPasskeySignInProps) => <button type="button" onClick={() => void onComplete()}>Use a passkey</button>,
    OwnerRecoverySignIn: () => <p>recovery slot</p>,
    loadCurrentUser: async () => ({ user: { id: "u-fixture", username: "fixture" } as never }),
    ...overrides,
  };
}

describe("Login (injected host collaborators)", () => {
  it("renders the host's product name as the heading, not a built-in brand", () => {
    render(<Login {...props()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fixture Product");
    expect(document.querySelector(".jini-login-card")).not.toBeNull();
    expect(screen.getByText("recovery slot")).toBeTruthy();
  });

  it("routes a failure through the injected ErrorNotice with the jini class", () => {
    const failure = formatUserFacingError({ message: "Sign-in could not finish.", action: "Retry.", step: "auth-login", cause: "x" }, { errorId: "err-fixture" });
    render(<Login {...props({}, { failure })} />);
    expect(screen.getByRole("alert").className).toBe("jini-login-error");
  });

  it("after a passkey completes, loads the current user through the injected call and signs in", async () => {
    const onLogin = vi.fn();
    const mfa = { pendingToken: "pending-fixture", code: "", setCode: vi.fn(), cancel: vi.fn() };
    render(<Login {...props({ onLogin }, { mfa })} />);
    fireEvent.click(screen.getByText("Use a passkey"));
    await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith({ id: "u-fixture", username: "fixture" }));
  });
});
