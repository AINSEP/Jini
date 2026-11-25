// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { closeLightboxDialog, openLightboxDialog } from "@jini-ai/ui/admin-widgets";
import { OverflowAwareMcpUiSurfaceCard } from "../OverflowAwareMcpUiSurfaceCard.js";

/**
 * @file `OverflowAwareMcpUiSurfaceCard`'s whole job: show Jini's own `McpUiSurfaceCard` unchanged,
 * plus a "Show in modal" button that appears only when the rendered surface overflows its box, and
 * that MOVES the card into `MessageOverflowModal` on click — never two live copies of the same
 * surface at once (see this component's own doc for the double-`data-agent-element`-handle /
 * double-live-session bug an earlier version had).
 *
 * The chat library's real `McpUiSurfaceCard` (the kit's `chat.McpUiSurfaceCard`) mounts a sandboxed `@mcp-ui/client` iframe and
 * drives a real handshake (see that component's own module doc) — mounting the real thing here
 * would test that library's iframe plumbing, not this wrapping decision. The fake kit's card is replaced
 * with a thin recorder, the same "recorder, not the real component" approach the host's
 * routed-a2ui card tests use.
 *
 * Overflow detection itself is `useOverflowDetection.hooks.unit.test.ts`'s job; this file drives
 * this component's `useOverflowDetectionHook` seam directly instead of faking `ResizeObserver`.
 */

const mcpUiSurfaceCardSpy = vi.hoisted(() => vi.fn());

// MessageOverflowModal reads its lightbox helpers from the admin kit: the real ones; the MCP-UI
// card is the recorder, the rest faked.
const kit = fakeAdminKit({
  values: { openLightboxDialog, closeLightboxDialog },
  chat: {
    McpUiSurfaceCard: (props: { events?: readonly unknown[] }) => {
      mcpUiSurfaceCardSpy(props);
      return <div className="fake-mcp-ui-surface-card" data-event-count={props.events?.length ?? 0} />;
    },
  },
});
const KitWrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: KitWrapper });
const useTHook = () => (key: string) => key;

const baseProps = {
  name: "mcp-ui",
  events: [{ resource: { uri: "ui://example/1" } }],
  runStreaming: false,
  runSucceeded: true,
  runId: "run-1",
  sandboxProxyUrl: new URL("https://example.test/sandbox-proxy.html"),
};

function useOverflowDetectionHook(isOverflowing: boolean) {
  return () => ({ containerRef: { current: null }, isOverflowing });
}

afterEach(() => {
  cleanup();
  mcpUiSurfaceCardSpy.mockReset();
});

describe("OverflowAwareMcpUiSurfaceCard", () => {
  it("always renders the real McpUiSurfaceCard inline, unchanged, regardless of overflow state", () => {
    const { container } = render(
      <OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(false)} />,
    );
    expect(container.querySelector(".fake-mcp-ui-surface-card")).toBeInTheDocument();
    expect(mcpUiSurfaceCardSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "mcp-ui", runId: "run-1" }));
    expect(mcpUiSurfaceCardSpy).toHaveBeenLastCalledWith(baseProps);
  });

  it("shows no 'Show in modal' button when the surface fits its own box", () => {
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(false)} />);
    expect(screen.queryByRole("button", { name: "Show in modal" })).not.toBeInTheDocument();
  });

  it("shows the 'Show in modal' button once the surface overflows its own box", () => {
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(true)} />);
    expect(screen.getByRole("button", { name: "Show in modal" })).toBeInTheDocument();
  });

  it("never spreads the injectable overflow-detection hook prop through to the real McpUiSurfaceCard", () => {
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(false)} />);
    const forwardedProps = mcpUiSurfaceCardSpy.mock.calls.at(-1)?.[0];
    expect(forwardedProps).not.toHaveProperty("useOverflowDetectionHook");
  });

  it("does not mount a second McpUiSurfaceCard instance until the modal is actually opened", () => {
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(true)} />);
    // One inline instance only — the modal's own copy is not mounted while closed.
    expect(mcpUiSurfaceCardSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".fake-mcp-ui-surface-card")).toHaveLength(1);
  });

  it("moves the surface into the modal on click, never mounting two live copies at once", () => {
    // Regression test: an earlier version mounted a SECOND, independent McpUiSurfaceCard inside the
    // modal while leaving the first one mounted inline. Both copies got identical props, so Jini's
    // own McpUiSurfaceCard published the exact same `data-agent-element` handle and `sessionKey`
    // twice in the DOM (handles are derived purely from the resource's `ui://` URI) — one live
    // session an agent-driven selector could resolve to either instance of, and two real,
    // independent `@mcp-ui/client` handshakes wired to the same `onToolCall`, so a pending
    // confirmation could be answered from either copy and genuinely double-execute its tool call.
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(true)} />);
    expect(document.querySelectorAll(".fake-mcp-ui-surface-card")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Show in modal" }));

    const dialog = document.querySelector("dialog.jini-message-overflow-modal")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector(".fake-mcp-ui-surface-card")).toBeInTheDocument();
    expect(mcpUiSurfaceCardSpy).toHaveBeenLastCalledWith(baseProps);
    // Exactly one instance exists — the inline copy unmounted the same commit the modal's mounted.
    expect(document.querySelectorAll(".fake-mcp-ui-surface-card")).toHaveLength(1);
  });

  it("closes the modal and remounts the surface inline, still never two at once", () => {
    render(<OverflowAwareMcpUiSurfaceCard {...baseProps} useTHook={useTHook} useOverflowDetectionHook={useOverflowDetectionHook(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show in modal" }));
    const dialog = document.querySelector("dialog.jini-message-overflow-modal")!;
    expect(dialog.hasAttribute("open")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.querySelector(".fake-mcp-ui-surface-card")).not.toBeInTheDocument();
    // The inline copy is remounted fresh (a new session, per this component's own doc on why that
    // tradeoff is accepted) rather than the original one having stayed alive underneath the modal.
    expect(document.querySelectorAll(".fake-mcp-ui-surface-card")).toHaveLength(1);
  });
});
