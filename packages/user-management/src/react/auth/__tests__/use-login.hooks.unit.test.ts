const translate = (key: string) => key;
const port = { login: async () => ({ user: { id: "u", username: "operator" } }) };
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLogin } from "../hooks/use-login.hooks.js";
import { createFakeLoginPort } from "../../testing.js";
import type { LoginPort } from "../../ports.js";

function fakeSubmitEvent(): React.FormEvent {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

describe("useLogin — initial state", () => {
  it("uses the caller-provided initial username and an empty password", () => {
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port: createFakeLoginPort({}), translate }, { initialUsername: "admin" }));
    expect(result.current.username).toBe("admin");
    expect(result.current.password).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("setUsername/setPassword update their own field independently", () => {
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port: createFakeLoginPort({}), translate }, { initialUsername: "admin" }));
    act(() => result.current.setUsername("alice"));
    act(() => result.current.setPassword("hunter2"));
    expect(result.current.username).toBe("alice");
    expect(result.current.password).toBe("hunter2");
  });
});

describe("useLogin — submit", () => {
  it("prevents the form's default submission", async () => {
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port: createFakeLoginPort({}), translate }, { initialUsername: "admin" }));
    const event = fakeSubmitEvent();
    await act(async () => result.current.submit(event));
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("on success, calls onLogin with the returned user and clears busy", async () => {
    const user = { id: "u1", username: "admin" };
    const onLogin = vi.fn();
    const login = vi.fn().mockResolvedValue({ user });
    const { result } = renderHook(() => useLogin({ onLogin, port: { login }, translate }));
    act(() => {
      result.current.setUsername("alice.operator");
      result.current.setPassword("distinct-password-123");
    });

    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(onLogin).toHaveBeenCalledWith(user);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ username: "alice.operator", password: "distinct-password-123" });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("is busy for the duration of an in-flight submit", async () => {
    let resolveLogin!: (value: { user: { id: string; username: string } }) => void;
    const port: LoginPort = { login: () => new Promise((resolve) => (resolveLogin = resolve)) };
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port, translate }));

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit(fakeSubmitEvent());
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveLogin({ user: { id: "u1", username: "admin" } });
      await submitPromise;
    });
    expect(result.current.busy).toBe(false);
  });

  it("surfaces the port's rejection message verbatim and does not call onLogin", async () => {
    const port = createFakeLoginPort({}, { loginError: new Error("invalid credentials") });
    const onLogin = vi.fn();
    const { result } = renderHook(() => useLogin({ onLogin, port, translate }));

    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("invalid credentials");
    expect(result.current.busy).toBe(false);
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("falls back to the exact string 'login failed' when the rejection is not an Error", async () => {
    const port: LoginPort = { login: () => Promise.reject("network exploded") };
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port, translate }));

    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("login failed");
  });

  it("clears a previous error at the start of a new submit attempt", async () => {
    let resolveLogin!: (value: { user: { id: string; username: string } }) => void;
    const login = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLogin = resolve; }));
    const port: LoginPort = { login };
    const { result } = renderHook(() => useLogin({ onLogin: vi.fn(), port, translate }));

    await act(async () => result.current.submit(fakeSubmitEvent()));
    expect(result.current.error).toBe("first failure");

    let retryPromise!: Promise<void>;
    act(() => { retryPromise = result.current.submit(fakeSubmitEvent()); });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveLogin({ user: { id: "u1", username: "admin" } });
      await retryPromise;
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.busy).toBe(false);
  });
});
