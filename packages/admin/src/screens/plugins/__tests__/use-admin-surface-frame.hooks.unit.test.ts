// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSurfaceActionOutcome, AdminSurfaceBootstrap } from "@jini-ai/core/contracts/site/agent-plugins-admin-surfaces";
import { useAdminSurfaceFrame } from "../hooks/use-admin-surface-frame.hooks.js";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "../hooks/agent-plugin-surfaces-port.hooks.js";

// jsdom has no matchMedia; the host's own test setup stubs it, this package's does not.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
}


/**
 * @file The host page's message gate for one admin-surface mount, driven through the hook alone
 * with a frame element that stays attached. The component unmounts the iframe as soon as it
 * navigates or fails, which hides the hook's own guarantees; here the element outlives those
 * transitions, so each guarantee is shown by itself: nothing reaches a frame that loaded a second
 * time (bootstrap, link answer), and a mount whose bootstrap failed or that unmounted stops
 * forwarding the frame's requests. Typed fake port; acme-style ids; no network.
 */

const SURFACE: AgentPluginSurfaceSummary = {
  id: "connection-settings",
  title: "Manage connection",
  src: "/api/agent-plugin-surfaces/v1/acme-office/connection-settings/surface/index.html",
  actions: [{ name: "save-selection", input: { type: "object", properties: { resourceId: { type: "string" } }, required: ["resourceId"] } }],
  linkOrigins: ["https://accounts.acme.test"],
};
const BOOTSTRAP: AdminSurfaceBootstrap = { surfaceId: SURFACE.id, issuedAt: 1, expiresAt: 2, data: { publicConfig: "x" } };
/** The nonce a mount gets while `crypto.getRandomValues` is stubbed to leave its zero bytes. */
const ZERO_NONCE = "0".repeat(32);

function fakePort(overrides: Partial<AgentPluginSurfacesPort> = {}) {
  return {
    list: vi.fn<AgentPluginSurfacesPort["list"]>(async () => ({ surfaces: [SURFACE] })),
    bootstrap: vi.fn<AgentPluginSurfacesPort["bootstrap"]>(async () => BOOTSTRAP),
    action: vi.fn<AgentPluginSurfacesPort["action"]>(async (): Promise<AdminSurfaceActionOutcome> => ({ ok: true, result: { saved: true } })),
    ...overrides,
  };
}

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const frame of frames.splice(0)) frame.remove();
});

/** Mounts the hook with a predictable nonce and a frame element the test owns. */
function mountWithFrame(port: AgentPluginSurfacesPort, surface = SURFACE) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => array);
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  frames.push(iframe);
  const frameWindow = iframe.contentWindow!;
  const posted = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});
  const hook = renderHook(() => useAdminSurfaceFrame({ pluginId: "acme-office", surface, port }));
  hook.result.current.frameRef.current = iframe;
  return { hook, frameWindow, posted };
}

function fromFrame(frameWindow: Window, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: "null", source: frameWindow }));
}

const saveRequest = { protocol: "jini.admin-surface", version: 1, kind: "action-request", mountId: ZERO_NONCE, requestId: "req-1", action: "save-selection", payload: { resourceId: "r1" } };
const linkRequest = { protocol: "jini.admin-surface", version: 1, kind: "open-link", mountId: ZERO_NONCE, requestId: "link-1", url: "https://accounts.acme.test/connections" };

describe("useAdminSurfaceFrame with a frame element that outlives navigation", () => {
  it("passes form choices through the declared destination action and refuses a separate undeclared forms action", async () => {
    const result = { destinations: [], picked: [], forms: [{ slug: "contact", title: "Contact us" }] };
    const port = fakePort({ action: vi.fn<AgentPluginSurfacesPort["action"]>(async () => ({ ok: true, result })) });
    const surface = { ...SURFACE, id: "form-destinations", actions: [{ name: "list-destinations", input: { type: "object" as const, properties: {}, additionalProperties: false as const } }] };
    const { hook, frameWindow, posted } = mountWithFrame(port, surface);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    const request = { ...saveRequest, action: "list-destinations", payload: {} };
    act(() => { fromFrame(frameWindow, request); });
    await waitFor(() => expect(port.action).toHaveBeenCalledWith({ pluginId: "acme-office", surfaceId: "form-destinations", action: "list-destinations", payload: {} }));
    await waitFor(() => expect(posted).toHaveBeenCalledWith(expect.objectContaining({ kind: "action-response", ok: true, result }), "*"));
    act(() => { fromFrame(frameWindow, { ...request, requestId: "req-2", action: "list-forms" }); });
    expect(port.action).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "action-undeclared" }) }), "*");
  });

  it("posts no bootstrap into a frame that loaded again while the bootstrap was pending", async () => {
    let resolve: (value: AdminSurfaceBootstrap) => void = () => {};
    const port = fakePort({ bootstrap: vi.fn<AgentPluginSurfacesPort["bootstrap"]>(() => new Promise((done) => { resolve = done; })) });
    const { hook, posted } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    act(() => { hook.result.current.onLoad(); });
    await act(async () => { resolve(BOOTSTRAP); });
    expect(hook.result.current.status).toBe("navigated");
    expect(posted).not.toHaveBeenCalled();
  });

  it("posts no open-link answer into a frame that loaded again before the link was answered", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const { hook, frameWindow, posted } = mountWithFrame(fakePort());
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    act(() => {
      fromFrame(frameWindow, linkRequest);
      hook.result.current.onLoad();
    });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it("stops forwarding the frame's requests once its bootstrap failed", async () => {
    const port = fakePort({ bootstrap: vi.fn<AgentPluginSurfacesPort["bootstrap"]>(async () => { throw new Error("401"); }) });
    const { hook, frameWindow } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(hook.result.current.status).toBe("failed"));
    act(() => { fromFrame(frameWindow, saveRequest); });
    await act(async () => { await Promise.resolve(); });
    expect(port.action).not.toHaveBeenCalled();
  });

  it("stops forwarding the frame's requests once unmounted", async () => {
    const port = fakePort();
    const { hook, frameWindow, posted } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    hook.unmount();
    fromFrame(frameWindow, saveRequest);
    await act(async () => { await Promise.resolve(); });
    expect(port.action).not.toHaveBeenCalled();
  });

  it("forwards this mount's request while the frame still shows its first document", async () => {
    // The positive control for the refusals above: the same request is forwarded on a live mount.
    const port = fakePort();
    const { hook, frameWindow, posted } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    act(() => { fromFrame(frameWindow, saveRequest); });
    await waitFor(() => expect(port.action).toHaveBeenCalledWith({ pluginId: "acme-office", surfaceId: SURFACE.id, action: "save-selection", payload: { resourceId: "r1" } }));
  });
});

describe("useAdminSurfaceFrame after the surface is open", () => {
  it("re-sends the admin theme to the open surface when it changes", async () => {
    // Run each scheduled frame immediately so the watcher's re-read is synchronous.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const port = fakePort();
    const { hook, posted } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    document.body.style.setProperty("--primary", "#0a0b0c");
    try {
      await waitFor(() => expect(posted.mock.calls.some(([message]) => JSON.stringify(message).includes("#0a0b0c"))).toBe(true));
    } finally {
      document.body.style.removeProperty("--primary");
    }
  });

  it("ignores frame messages once its frame element is gone", async () => {
    const port = fakePort();
    const { hook, frameWindow, posted } = mountWithFrame(port);
    act(() => { hook.result.current.onLoad(); });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    hook.result.current.frameRef.current = null;
    act(() => { fromFrame(frameWindow, saveRequest); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.action).not.toHaveBeenCalled();
    expect(posted).toHaveBeenCalledTimes(1);
  });
});
