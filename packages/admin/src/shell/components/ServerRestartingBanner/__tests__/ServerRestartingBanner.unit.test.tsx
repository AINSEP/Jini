// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServerRestartingBanner } from "../ServerRestartingBanner.js";
import { useServerConnectionBanner } from "../hooks/use-server-connection-status.hooks.js";
import type { ServerConnectionBannerText, ServerConnectionStatus, ServerConnectionStatusPort } from "../hooks/use-server-connection-status.hooks.js";

/** @file The restart banner follows the injected reconnect store: hidden online, shown while reconnecting. */

const TEXT: ServerConnectionBannerText = {
  online: null,
  reconnecting: "Server restarting… reconnecting.",
  unreachable: "Can't reach the server.",
};

/** A minimal host reconnect store: the status and its subscribers, nothing else. */
function fakeReconnect(): ServerConnectionStatusPort & { set(status: ServerConnectionStatus): void } {
  let status: ServerConnectionStatus = "online";
  const listeners = new Set<() => void>();
  return {
    getStatus: () => status,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next) => { status = next; for (const listener of listeners) listener(); },
  };
}

describe("ServerRestartingBanner", () => {
  it("shows the host's copy while the server is restarting and hides once it answers", () => {
    const reconnect = fakeReconnect();
    render(<ServerRestartingBanner reconnect={reconnect} text={TEXT} useServerConnectionBannerHook={useServerConnectionBanner} />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => reconnect.set("reconnecting"));
    const banner = screen.getByRole("status");
    expect(banner.textContent).toBe("Server restarting… reconnecting.");
    expect(banner.className).toBe("jini-server-restarting-banner jini-server-restarting-banner--reconnecting");

    act(() => reconnect.set("unreachable"));
    expect(screen.getByRole("status").textContent).toBe("Can't reach the server.");

    act(() => reconnect.set("online"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
