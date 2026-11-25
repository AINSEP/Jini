// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AlwaysAllowPanel } from "../AlwaysAllowPanel.js";
import type { AlwaysAllowController } from "../hooks/use-always-allow.hooks.js";

/** @file The Always allow panel's markup, driven by a stub controller (the hook is injected, so no fetch anywhere). */
function controller(over: Partial<AlwaysAllowController> = {}): AlwaysAllowController {
  return {
    groups: [],
    loadError: null,
    revokeError: null,
    pendingKey: null,
    revoke: vi.fn(),
    rowKey: ({ serverId, toolName }) => `${serverId}/${toolName}`,
    formatDate: () => "Sep 28, 2026",
    t: (key) => key,
    ...over,
  };
}

describe("AlwaysAllowPanel", () => {
  it("says loading until the first load finishes and shows the load error instead of a list", () => {
    const { rerender } = render(<AlwaysAllowPanel useAlwaysAllowHook={() => controller({ groups: null })} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    rerender(<AlwaysAllowPanel useAlwaysAllowHook={() => controller({ groups: null, loadError: "Couldn't load this list." })} />);
    expect(screen.getByText("Couldn't load this list.")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows the empty state when nothing is set to Always allow", () => {
    render(<AlwaysAllowPanel useAlwaysAllowHook={() => controller()} />);
    expect(screen.getByText("Nothing is set to Always allow. Pick it on a tool's approval card in chat.")).toBeTruthy();
  });

  it("lists each server's tools and revokes one row, disabling only the pending row", () => {
    const revoke = vi.fn();
    const groups = [{
      serverId: "github", label: "GitHub", handle: "always-allow-github",
      tools: [
        { toolName: "get_file", grantedAt: "2026-09-28T10:00:00.000Z", revokeHandle: "revoke-get-file" },
        { toolName: "list_prs", grantedAt: "2026-09-28T10:00:00.000Z", revokeHandle: "revoke-list-prs" },
      ],
    }] as unknown as AlwaysAllowController["groups"];
    render(<AlwaysAllowPanel useAlwaysAllowHook={() => controller({ groups, revoke, pendingKey: "github/list_prs", revokeError: "Couldn't revoke. Try again." })} />);
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByText("Couldn't revoke. Try again.")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /Revoke Always allow/ });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[0] as HTMLButtonElement);
    expect(revoke).toHaveBeenCalledWith({ serverId: "github", toolName: "get_file" });
  });
});
