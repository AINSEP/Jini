// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LoginApiErrorPort, UseBaseLoginHook } from "../auth-host-slots.js";
import type { LoginPort } from "../hooks/login-port.hooks.js";
import { useLogin } from "../hooks/use-login.hooks.js";

class HttpFailure extends Error {
  constructor(readonly status: number, readonly body: { errorId?: unknown } | null = null) {
    super("Private server diagnosis, not for the signed-out screen");
  }
}

const errors: LoginApiErrorPort = { isApiError: (error): error is HttpFailure => error instanceof HttpFailure };
const credentials = { username: "operator", password: "fixture-private-passphrase" };
const user = { id: "user-65", username: "operator" };

function setup(port: LoginPort) {
  const onLogin = vi.fn();
  const useBase = vi.fn<UseBaseLoginHook>((_props, options) => ({
    username: options.initialUsername ?? "", password: "", error: null, busy: false,
    setUsername: () => {}, setPassword: () => {}, submit: async () => {},
  }));
  const hook = renderHook(() => useLogin({ onLogin }, { port, errors, useJiniLogin: useBase }));
  return { ...hook, onLogin, base: useBase.mock.calls[0]![0] };
}

describe("useLogin", () => {
  it("passes credentials unchanged and removes diagnostic details when a retry succeeds", async () => {
    const upstream = new HttpFailure(503, { errorId: "ERR-123A-234B-345C-456D" });
    const login = vi.fn<LoginPort["login"]>().mockRejectedValueOnce(upstream).mockResolvedValueOnce({ user });
    const { base, result, onLogin } = setup({ login });

    expect(result.current.username).toBe("admin");
    expect(base.onLogin).toBe(onLogin);
    expect(base.translate("Explicit sign-in copy")).toBe("Explicit sign-in copy");
    expect(base.port.completeMfa).toBeUndefined();
    await act(async () => { await expect(base.port.login(credentials)).rejects.toBe(upstream); });
    expect(result.current.failure).toMatchObject({
      message: "Sign-in could not finish.", step: "auth-login", errorId: "ERR-123A-234B-345C-456D",
    });
    const copy = result.current.failure!.copyText;
    expect(copy).toContain("Error ID: ERR-123A-234B-345C-456D");
    expect(copy).not.toContain(upstream.message);
    expect(copy).not.toContain(credentials.password);

    await act(async () => { await expect(base.port.login(credentials)).resolves.toEqual({ user }); });
    expect(result.current.failure).toBeNull();
    expect(login.mock.calls).toEqual([[credentials], [credentials]]);
  });

  it.each([400, 401, 429])("leaves HTTP %i refusal wording to the base controller", async (status) => {
    const refusal = new HttpFailure(status, { errorId: "refusal-reference" });
    const { base, result } = setup({ login: async () => { throw refusal; } });
    await act(async () => { await expect(base.port.login(credentials)).rejects.toBe(refusal); });
    expect(result.current.failure).toBeNull();
  });

  it.each([null, { errorId: 912 }])("omits a correlation ID when the error body is %j", async (body) => {
    const refusal = new HttpFailure(500, body);
    const { base, result } = setup({ login: async () => { throw refusal; } });
    await act(async () => { await expect(base.port.login(credentials)).rejects.toBe(refusal); });
    expect(result.current.failure?.message).toBe("Sign-in could not finish.");
    expect(result.current.failure?.copyText).not.toContain("Error ID:");
  });

  it("preserves the MFA port receiver and credentials, and wraps a non-Error rejection safely", async () => {
    const proof = { pendingToken: "pending-proof", code: "763589" };
    const inputSeen: typeof proof[] = [];
    const port: LoginPort = {
      login: async () => ({ mfaRequired: true, pendingToken: proof.pendingToken }),
      async completeMfa(input) {
        expect(this).toBe(port);
        inputSeen.push(input);
        if (inputSeen.length === 1) throw `Private diagnosis: ${input.pendingToken}/${input.code}`;
        return { user };
      },
    };
    const { base, result } = setup(port);
    await act(async () => {
      await expect(base.port.login(credentials)).resolves.toEqual({ mfaRequired: true, pendingToken: "pending-proof" });
      await expect(base.port.completeMfa!(proof)).rejects.toThrow(new Error("Sign-in could not finish. Try signing in again."));
    });
    expect(result.current.failure?.message).toBe("Sign-in could not finish.");
    expect(result.current.failure?.copyText).not.toContain(proof.pendingToken);
    expect(result.current.failure?.copyText).not.toContain(proof.code);
    await act(async () => { await expect(base.port.completeMfa!(proof)).resolves.toEqual({ user }); });
    expect(inputSeen).toEqual([proof, proof]);
    expect(result.current.failure).toBeNull();
  });
});
