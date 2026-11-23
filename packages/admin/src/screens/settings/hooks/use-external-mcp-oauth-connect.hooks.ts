import { useCallback, useEffect, useRef, useState } from "react";

import { describeApiError } from "@jini-ai/core/admin-runtime";
import type { ExternalMcpConnectStart } from "@jini-ai/core/contracts/hosted-mcp";

/**
 * @file The row-level "Connect" button behind Settings → External MCP (2026-10-23): starts the
 * OAuth sign-in for one saved server and tells the panel when to re-read the roster.
 *
 * `POST .../oauth/connect` answers one of two ways. `redirect_required`: the provider URL opens in
 * a popup, and the public callback page posts the host's callback message type back to this tab
 * (the host's `routes/oauth/callback-page.ts`). That message can be lost (no opener, a system browser), so
 * regaining focus also counts as "go look" — the same fallback that page's header asks every
 * bridge for. `device_code`: the operator types `userCode` at the provider; this hook polls
 * `.../oauth/device/poll` on the server's own interval until it says `connected`.
 *
 * The popup is opened BEFORE the connect request resolves (as `about:blank`, then pointed at the
 * provider), because a window opened after an `await` has lost the click's user activation and a
 * popup blocker may eat it. A device-code grant never needs it, so the panel says which grant the
 * row uses and the blank window is skipped for that one.
 */

/**
 * The two sign-in routes, bound by the host over its own request client. A rejection must be an
 * `AdminApiError` (`@jini-ai/core/admin-runtime`) for its message to show; anything else shows
 * `fallbackError`.
 */
export interface ExternalMcpOAuthConnectPort {
  connectExternalMcpOAuth: (input: { serverId: string }, options?: { destination?: "shared" }) => Promise<{ auth: ExternalMcpConnectStart }>;
  pollExternalMcpOAuthDevice: (input: { serverId: string }) => Promise<{ status: "pending"; retryAfterSeconds: number } | { status: "connected" }>;
}

export type ExternalMcpOAuthConnectState =
  | { phase: "idle"; error?: string }
  | { phase: "starting" }
  | { phase: "waiting" }
  | { phase: "device"; userCode: string; verificationUri: string };

/** Browser seams, so a test drives the flow without a real window. */
export interface ExternalMcpOAuthConnectWindow {
  open: (input: { url: string }, options?: Record<string, never>) => { location: { href: string }; close: () => void } | null;
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  origin: string;
}

const browserWindow = (): ExternalMcpOAuthConnectWindow => ({
  open: ({ url }, _options = {}) => window.open(url, "_blank", "popup,width=520,height=720"),
  addEventListener: window.addEventListener.bind(window),
  removeEventListener: window.removeEventListener.bind(window),
  origin: window.location.origin,
});

/**
 * Drives one server's sign-in.
 *
 * @param input.serverId - The saved row to sign in.
 * @param input.grant - The row's saved grant; `device_code` skips the up-front popup.
 * @param input.onConnected - Re-reads the roster; called once sign-in lands, and on focus/close.
 * @param input.port - The host's binding of the two sign-in routes.
 * @param input.callbackMessageType - The `type` the host's public callback page posts back; it must
 *   match that page's own constant, so the host owns both (product copy, K3).
 * @returns The current state plus `connect()` and `cancel()`.
 * @complexity O(1) per call; device polling is one request per server-given interval.
 */
export function useExternalMcpOAuthConnect(
  { serverId, grant, onConnected, port, callbackMessageType }: { serverId: string; grant: string; onConnected: () => void; port: ExternalMcpOAuthConnectPort; callbackMessageType: string },
  { win = browserWindow, fallbackError = "Sign-in could not start." }: { win?: () => ExternalMcpOAuthConnectWindow; fallbackError?: string } = {},
) {
  const [state, setState] = useState<ExternalMcpOAuthConnectState>({ phase: "idle" });
  // Everything that must stop on cancel/unmount: a poll timer, the message/focus listeners.
  const cleanup = useRef<(() => void) | null>(null);
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const finish = useCallback((error?: string) => {
    stop();
    setState(error ? { phase: "idle", error } : { phase: "idle" });
    onConnectedRef.current();
  }, [stop]);

  const awaitRedirect = useCallback((w: ExternalMcpOAuthConnectWindow) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== w.origin || event.data?.type !== callbackMessageType) return;
      finish(event.data.reason ? fallbackError : undefined);
    };
    const onFocus = () => finish();
    w.addEventListener("message", onMessage as EventListener);
    w.addEventListener("focus", onFocus);
    cleanup.current = () => {
      w.removeEventListener("message", onMessage as EventListener);
      w.removeEventListener("focus", onFocus);
    };
    setState({ phase: "waiting" });
  }, [finish, fallbackError, callbackMessageType]);

  const pollDevice = useCallback((intervalSeconds: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const result = await port.pollExternalMcpOAuthDevice({ serverId });
        if (stopped) return;
        if (result.status === "connected") {
          finish();
          return;
        }
        timer = setTimeout(() => void tick(), result.retryAfterSeconds * 1000);
      } catch (error) {
        if (!stopped) finish(describeApiError({ e: error, fallback: fallbackError }));
      }
    };
    timer = setTimeout(() => void tick(), intervalSeconds * 1000);
    cleanup.current = () => { stopped = true; clearTimeout(timer); };
  }, [port, serverId, finish, fallbackError]);

  const connect = useCallback(async (options: { destination?: "shared" } = {}) => {
    stop();
    const w = win();
    const popup = grant === "device_code" ? null : w.open({ url: "about:blank" });
    setState({ phase: "starting" });
    try {
      const { auth } = await startConnection({ port, serverId, options });
      if (auth.kind === "redirect_required") {
        if (popup) popup.location.href = auth.authorizationUrl;
        else w.open({ url: auth.authorizationUrl });
        awaitRedirect(w);
        return;
      }
      popup?.close();
      const verificationUri = auth.verificationUriComplete ?? auth.verificationUri;
      w.open({ url: verificationUri });
      setState({ phase: "device", userCode: auth.userCode, verificationUri });
      pollDevice(auth.intervalSeconds);
    } catch (error) {
      popup?.close();
      setState({ phase: "idle", error: describeApiError({ e: error, fallback: fallbackError }) });
    }
  }, [stop, win, grant, port, serverId, awaitRedirect, pollDevice, fallbackError]);

  const cancel = useCallback(() => {
    stop();
    setState({ phase: "idle" });
  }, [stop]);

  return { state, connect, cancel };
}

/** Preserve the existing one-argument local port call while making shared saving explicit. */
function startConnection({ port, serverId, options }: { port: ExternalMcpOAuthConnectPort; serverId: string; options: { destination?: "shared" } }) {
  return options.destination ? port.connectExternalMcpOAuth({ serverId }, options) : port.connectExternalMcpOAuth({ serverId });
}
