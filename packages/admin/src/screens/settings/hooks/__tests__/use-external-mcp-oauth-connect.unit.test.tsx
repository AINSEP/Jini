// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useExternalMcpOAuthConnect,
  type ExternalMcpOAuthConnectPort,
  type ExternalMcpOAuthConnectWindow,
} from "../use-external-mcp-oauth-connect.hooks";

/** Any host's callback `type`; the hook must listen for exactly the one it is given. */
const CALLBACK_TYPE = "host:external-mcp-connected";

/** A fake window: records opened URLs and lets a test fire `message`/`focus`. */
function fakeWindow() {
  const listeners = new Map<string, EventListener>();
  const popup = { location: { href: "about:blank" }, close: vi.fn() };
  const opened: string[] = [];
  const win: ExternalMcpOAuthConnectWindow = {
    open: ({ url }, _options = {}) => { opened.push(url); return popup; },
    addEventListener: ((type: string, fn: EventListener) => listeners.set(type, fn)) as Window["addEventListener"],
    removeEventListener: ((type: string) => listeners.delete(type)) as Window["removeEventListener"],
    origin: "https://localhost:3000",
  };
  return { win, popup, opened, listeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useExternalMcpOAuthConnect", () => {
  it("opens the popup before the request, points it at the provider, and reloads on the callback message", async () => {
    const { win, popup, opened, listeners } = fakeWindow();
    const onConnected = vi.fn();
    const port: ExternalMcpOAuthConnectPort = {
      connectExternalMcpOAuth: vi.fn(async () => ({ auth: { kind: "redirect_required" as const, authorizationUrl: "https://idp.example/auth", expiresAt: "z" } })),
      pollExternalMcpOAuthDevice: vi.fn(),
    };
    const { result } = renderHook(() => useExternalMcpOAuthConnect({ serverId: "higgsfield", grant: "authorization_code", onConnected, port, callbackMessageType: CALLBACK_TYPE }, { win: () => win }));

    await act(() => result.current.connect());
    expect(opened).toEqual(["about:blank"]);
    expect(port.connectExternalMcpOAuth).toHaveBeenCalledWith({ serverId: "higgsfield" });
    expect(popup.location.href).toBe("https://idp.example/auth");
    expect(result.current.state.phase).toBe("waiting");

    // A same-origin message of any other type is not the host's callback, so it is ignored.
    act(() => listeners.get("message")!({ origin: win.origin, data: { type: "other:external-mcp-connected" } } as unknown as Event));
    expect(onConnected).not.toHaveBeenCalled();

    // A message from another origin is ignored.
    act(() => listeners.get("message")!({ origin: "https://evil.example", data: { type: CALLBACK_TYPE } } as unknown as Event));
    expect(onConnected).not.toHaveBeenCalled();

    act(() => listeners.get("message")!({ origin: win.origin, data: { type: CALLBACK_TYPE } } as unknown as Event));
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ phase: "idle" });
    expect(listeners.size).toBe(0);
  });

  it("shows the device code and polls until connected", async () => {
    vi.useFakeTimers();
    const { win, opened } = fakeWindow();
    const onConnected = vi.fn();
    const poll = vi.fn()
      .mockResolvedValueOnce({ status: "pending", retryAfterSeconds: 2 })
      .mockResolvedValueOnce({ status: "connected" });
    const port: ExternalMcpOAuthConnectPort = {
      connectExternalMcpOAuth: vi.fn(async () => ({ auth: { kind: "device_code" as const, userCode: "ABCD-1234", verificationUri: "https://idp.example/device", verificationUriComplete: null, expiresAt: "z", intervalSeconds: 5 } })),
      pollExternalMcpOAuthDevice: poll,
    };
    const { result } = renderHook(() => useExternalMcpOAuthConnect({ serverId: "gh", grant: "device_code", onConnected, port, callbackMessageType: CALLBACK_TYPE }, { win: () => win }));

    await act(() => result.current.connect());
    expect(opened).toEqual(["https://idp.example/device"]);
    expect(result.current.state).toEqual({ phase: "device", userCode: "ABCD-1234", verificationUri: "https://idp.example/device" });

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(poll).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ phase: "idle" });
  });

  it("closes the blank popup and reports the error when connect fails", async () => {
    const { win, popup } = fakeWindow();
    const port: ExternalMcpOAuthConnectPort = {
      connectExternalMcpOAuth: vi.fn(async () => { throw new Error("boom"); }),
      pollExternalMcpOAuthDevice: vi.fn(),
    };
    const { result } = renderHook(() => useExternalMcpOAuthConnect({ serverId: "x", grant: "", onConnected: vi.fn(), port, callbackMessageType: CALLBACK_TYPE }, { win: () => win, fallbackError: "Sign-in could not start." }));

    await act(() => result.current.connect());
    expect(popup.close).toHaveBeenCalled();
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state).toHaveProperty("error");
  });
});
