// @vitest-environment jsdom
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminKitProvider, type AdminKit } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import type { AdminSurfaceMessageEvent, AdminSurfaceThemeToken } from "../../../react/kit-admin-surfaces.js";
import { AgentPluginSurfaceFrame } from "../AgentPluginSurfaceFrame.js";
import type { AgentPluginSurfaceActionAnswer, AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "../hooks/agent-plugin-surfaces-port.hooks.js";
import { useAdminSurfaceFrame, type AdminSurfaceFrameController } from "../hooks/use-admin-surface-frame.hooks.js";

const t = (key: string) => key;
const surface: AgentPluginSurfaceSummary = { id: "connections", title: "Connect workspace", src: "about:blank", actions: [{ name: "connect", input: { type: "object" } }] };
const pluginId = "mail-suite";
const target = { pluginId, surfaceId: "connections" };
const mountId = "fake-mount-connections";
const sources: Partial<Record<AdminSurfaceThemeToken, string>> = { "--jini-primary": "--host-primary" };
const bootstrapData = { surfaceId: "connections", issuedAt: 1, expiresAt: 100, data: { account: "example" } };
const signIn = { authorizationUrl: "https://accounts.example.test/continue", expiresAt: "2026-11-27T09:00:00Z" };
const cleanups: (() => void)[] = [];
let previousTheme: string;
beforeEach(() => {
  previousTheme = document.documentElement.style.colorScheme;
  document.documentElement.style.colorScheme = "light";
  vi.stubGlobal("matchMedia", vi.fn(() => new EventTarget()));
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-27T08:00:00Z"));
});
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((dispose) => dispose());
  document.documentElement.style.colorScheme = previousTheme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function unusedPort(overrides: Partial<AgentPluginSurfacesPort> = {}): AgentPluginSurfacesPort {
  return {
    list: async () => { throw new Error("unexpected surface list"); },
    bootstrap: async () => { throw new Error("unexpected bootstrap"); },
    action: async () => { throw new Error("unexpected action"); },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the hook's window listener and message routing. The protocol kit owns validation
// and envelopes, so the fake accepts only the declared frame identity and local fixture values.
function protocolKit() {
  const belongs = (event: AdminSurfaceMessageEvent, frame: unknown) => event.origin === "null" && event.source === frame;
  return fakeAdminKit({
    values: {
      readAdminSurfaceResize: ({ event, mount }) => belongs(event, mount.frame) && event.data === "resize" ? 413 : null,
      openAdminSurfaceLink: async ({ event, mount, openLink }) => {
        if (!belongs(event, mount.frame) || event.data !== "external") return { ok: false, ignored: "other message" };
        const url = "https://docs.example.test/connect";
        await openLink({ url });
        return { ok: true, url, response: { mountId: mount.mountId, requestId: "link-1" } };
      },
      validateAdminSurfaceMessage: ({ event, mount }) => {
        if (!belongs(event, mount.frame)) return { ok: false, ignored: "other source" };
        if (event.data === "refused") return { ok: false, refused: "not declared", response: { mountId: mount.mountId, requestId: "refused-1" } };
        if (event.data === "request-1" || event.data === "request-2" || event.data === "request-3") {
          if (mount.descriptor.actions[0]?.name !== "connect") return { ok: false, ignored: "no declared action" };
          return { ok: true, request: { mountId: mount.mountId, requestId: event.data, action: "connect", payload: { account: event.data } } };
        }
        return { ok: false, ignored: "other message" };
      },
    },
  });
}

function mountHook(port: AgentPluginSurfacesPort, kit: AdminKit = protocolKit()) {
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  const view = renderHook(() => useAdminSurfaceFrame({ pluginId, surface, port, themeSources: sources }), { wrapper });
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  cleanups.push(() => iframe.remove());
  view.result.current.frameRef.current = iframe;
  const frame = iframe.contentWindow!;
  const post = vi.spyOn(frame, "postMessage").mockImplementation(() => {});
  const message = (data: string, source: Window | null = frame) =>
    act(async () => { window.dispatchEvent(new MessageEvent("message", { origin: "null", source, data })); });
  return { ...view, frame, post, message };
}

it("initializes once, sends updated theme after init, and drops a pending bootstrap if the frame leaves", async () => {
  const requested = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrame++;
    requested.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { requested.delete(id); });
  const bootstrap = vi.fn<AgentPluginSurfacesPort["bootstrap"]>(async () => bootstrapData);
  const started = mountHook(unusedPort({ bootstrap }));
  expect(started.result.current.status).toBe("open");
  expect(started.result.current.attributes).toEqual({ src: "about:blank", title: "Connect workspace", sandbox: "allow-scripts", referrerPolicy: "no-referrer" });
  expect(started.post).not.toHaveBeenCalled();
  await act(async () => started.result.current.onLoad());
  expect(bootstrap).toHaveBeenCalledExactlyOnceWith(target);
  expect(started.post).toHaveBeenCalledExactlyOnceWith({ kind: "init", mountId, bootstrap: bootstrapData, theme: { scheme: "light", tokens: {} } }, "*");
  document.documentElement.style.colorScheme = "dark";
  await waitFor(() => expect(requested.size).toBe(1));
  act(() => {
    const callbacks = [...requested.values()];
    requested.clear();
    callbacks.forEach((callback) => callback(0));
  });
  expect(started.post).toHaveBeenLastCalledWith({ kind: "theme", mountId, theme: { scheme: "dark", tokens: {} } }, "*");
  act(() => started.result.current.onLoad());
  expect(started.result.current.status).toBe("navigated");
  expect(bootstrap).toHaveBeenCalledTimes(1);
  started.unmount();

  const pending = deferred<typeof bootstrapData>();
  const delayed = mountHook(unusedPort({ bootstrap: () => pending.promise }));
  act(() => delayed.result.current.onLoad());
  act(() => delayed.result.current.onLoad());
  await act(async () => pending.resolve(bootstrapData));
  expect(delayed.result.current.status).toBe("navigated");
  expect(delayed.post).not.toHaveBeenCalled();
});

it("reports bootstrap failure without posting and never answers messages before a frame is live", async () => {
  const action = vi.fn<AgentPluginSurfacesPort["action"]>();
  const failure = vi.fn<AgentPluginSurfacesPort["bootstrap"]>(async () => { throw new Error("Unauthorized"); });
  const mounted = mountHook(unusedPort({ bootstrap: failure, action }));
  await mounted.message("request-1", null);
  expect(action).not.toHaveBeenCalled();
  expect(mounted.post).not.toHaveBeenCalled();
  await act(async () => mounted.result.current.onLoad());
  expect(mounted.result.current.status).toBe("failed");
  expect(failure).toHaveBeenCalledExactlyOnceWith(target);
  await mounted.message("request-1");
  expect(action).not.toHaveBeenCalled();
  expect(mounted.post).not.toHaveBeenCalled();
});

it("routes resize and checked links separately and passes only action outcomes back to the frame", async () => {
  const action = vi.fn<AgentPluginSurfacesPort["action"]>()
    .mockResolvedValueOnce({ ok: true, result: { ready: true }, hostSignIns: [
      signIn,
      { authorizationUrl: "http://bad.example.test", expiresAt: signIn.expiresAt },
      { authorizationUrl: "not-a-url", expiresAt: signIn.expiresAt },
      { authorizationUrl: "https://expired.example.test", expiresAt: "2026-11-27T07:00:00Z" },
    ] })
    .mockRejectedValueOnce(new Error("private server message"));
  const mounted = mountHook(unusedPort({ bootstrap: async () => bootstrapData, action }));
  await act(async () => mounted.result.current.onLoad());
  mounted.post.mockClear(); // Startup was checked separately. All messages below are post-init.
  await mounted.message("resize");
  expect(mounted.result.current.height).toBe(413);
  expect(mounted.post).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  await mounted.message("request-1", window);
  expect(mounted.post).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  await mounted.message("refused");
  expect(mounted.post).toHaveBeenLastCalledWith({ mountId, requestId: "refused-1" }, "*");
  expect(action).not.toHaveBeenCalled();

  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await mounted.message("external");
  expect(open).toHaveBeenCalledExactlyOnceWith("https://docs.example.test/connect", "_blank", "noopener,noreferrer");
  expect(mounted.post).toHaveBeenLastCalledWith({ mountId, requestId: "link-1" }, "*");
  expect(action).not.toHaveBeenCalled();

  await mounted.message("request-1");
  expect(action).toHaveBeenCalledExactlyOnceWith({ ...target, action: "connect", payload: { account: "request-1" } });
  expect(mounted.post).toHaveBeenLastCalledWith({ kind: "action-response", mountId, requestId: "request-1", ok: true, result: { ready: true } }, "*");
  expect(mounted.result.current.signIns).toEqual([signIn]);
  act(() => mounted.result.current.onSignInOpened(signIn));
  expect(mounted.result.current.signIns).toEqual([]);

  await mounted.message("request-2");
  expect(mounted.post).toHaveBeenLastCalledWith({
    kind: "action-response", mountId, requestId: "request-2", ok: false,
    error: { code: "host-unavailable", message: "The admin page could not reach the server. Try again.", retryable: true },
  }, "*");
});

it("never posts a late action result once the frame navigates or accepts another message", async () => {
  const pending = deferred<AgentPluginSurfaceActionAnswer>();
  const action = vi.fn<AgentPluginSurfacesPort["action"]>(() => pending.promise);
  const mounted = mountHook(unusedPort({ bootstrap: async () => bootstrapData, action }));
  await act(async () => mounted.result.current.onLoad());
  await mounted.message("request-1");
  expect(action).toHaveBeenCalledExactlyOnceWith({ ...target, action: "connect", payload: { account: "request-1" } });
  act(() => mounted.result.current.onLoad());
  await act(async () => pending.resolve({ ok: true, result: "old document" }));
  expect(mounted.result.current.status).toBe("navigated");
  expect(mounted.post).toHaveBeenCalledTimes(1); // only init
  await mounted.message("request-3");
  expect(action).toHaveBeenCalledTimes(1);
});

it("displays a sandboxed frame with sizing and a single-use sign-in handoff, then reports closed or failed views", async () => {
  const onSignInOpened = vi.fn();
  const frameRef = createRef<HTMLIFrameElement>();
  const attributes = { src: "about:blank", title: "Connect workspace", sandbox: "allow-scripts", referrerPolicy: "no-referrer" as const };
  let state: AdminSurfaceFrameController = { attributes, frameRef, status: "open", onLoad: vi.fn(), height: null, signIns: [], onSignInOpened };
  const port = unusedPort();
  const frameHook = ({ pluginId: id, surface: screenDef, port: boundPort }: Parameters<Parameters<typeof AgentPluginSurfaceFrame>[0]["useAdminSurfaceFrame"]>[0]) => {
    if (id !== pluginId || screenDef !== surface || boundPort !== port) throw new Error("wrong frame binding");
    return state;
  };
  const panel = () => <AgentPluginSurfaceFrame pluginId={pluginId} surface={surface} port={port} t={t} useAdminSurfaceFrame={frameHook} />;
  const view = renderWithAdminKit(panel());
  const iframe = screen.getByTitle("Connect workspace");
  expect(iframe).toBe(frameRef.current);
  expect(iframe).toHaveAttribute("src", "about:blank");
  expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(iframe).toHaveStyle({ height: "28rem" });
  expect(screen.queryByRole("link", { name: "Continue to sign-in" })).toBeNull();

  state = { ...state, height: 413, signIns: [signIn] };
  view.rerender(panel());
  expect(iframe).toHaveStyle({ height: "413px" });
  const link = screen.getByRole("link", { name: "Continue to sign-in" });
  expect(link).toHaveAttribute("href", signIn.authorizationUrl);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await userEvent.setup().click(link);
  expect(onSignInOpened).toHaveBeenCalledExactlyOnceWith(signIn);
  state = { ...state, status: "navigated" };
  view.rerender(panel());
  expect(screen.getByRole("status")).toHaveTextContent("This view left its page and was closed.");
  expect(screen.queryByTitle("Connect workspace")).toBeNull();
  state = { ...state, status: "failed" };
  view.rerender(panel());
  expect(screen.getByRole("alert")).toHaveTextContent("Could not open this view.");
  expect(screen.queryByRole("link", { name: "Continue to sign-in" })).toBeNull();
});
