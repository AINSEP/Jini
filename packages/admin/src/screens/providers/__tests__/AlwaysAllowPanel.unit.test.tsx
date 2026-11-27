// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExternalMcpToolApprovalDto } from "@jini-ai/core/contracts/site/cms-external-mcp";
import { FetchQueryProvider, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { describe, expect, it, vi } from "vitest";

import { AlwaysAllowPanel } from "../AlwaysAllowPanel.js";
import { useAlwaysAllow, type AlwaysAllowController } from "../hooks/use-always-allow.hooks.js";
import type { AlwaysAllowPort } from "../always-allow-ports.js";

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

const grant = (serverId: string, toolName: string) => ({
  serverId, toolName, grantedByPrincipalId: "owner", grantedAt: "2026-09-28T12:00:00.000Z",
});
const gitRead = grant("git", "get_file");
const gitList = grant("git", "list_files");
const diskRead = grant("disk", "get_file");
const roster = [{ serverId: "git", label: "Repository" }, { serverId: "disk", label: "Disk" }];
const t = (key: string) => key;

function mountAlwaysAllow(port: AlwaysAllowPort) {
  function Panel() {
    return <AlwaysAllowPanel useAlwaysAllowHook={() => useAlwaysAllow({ port, t, locale: "en-US", useFetchQuery, useFetchMutation })} />;
  }
  return render(<Panel />, { wrapper: FetchQueryProvider });
}
function toolRow(label: string, tool: string) {
  const table = within(screen.getByRole("heading", { name: label }).closest("section")!).getByRole("table");
  return within(table).getByRole("cell", { name: tool, exact: true }).closest("tr")!;
}

it.each(["removed", "already absent"] as const)("hides just the accepted revoke (%s) while waiting for the refreshed approvals", async (outcome) => {
  const user = userEvent.setup();
  let finishRevoke!: (result: { removed: boolean }) => void;
  let refuseRevoke!: (error: unknown) => void;
  const pending = new Promise<{ removed: boolean }>((resolve, reject) => { finishRevoke = resolve; refuseRevoke = reject; });
  let finishRead!: (result: { approvals: ExternalMcpToolApprovalDto[] }) => void;
  const refresh = new Promise<{ approvals: ExternalMcpToolApprovalDto[] }>(resolve => { finishRead = resolve; });
  const listExternalMcpToolApprovals = vi.fn<AlwaysAllowPort["listExternalMcpToolApprovals"]>()
    .mockResolvedValueOnce({ approvals: [gitRead, gitList, diskRead] }).mockImplementationOnce(() => refresh)
    .mockResolvedValue({ approvals: [gitList, diskRead, gitRead] });
  const revokeExternalMcpToolApproval = vi.fn<AlwaysAllowPort["revokeExternalMcpToolApproval"]>(() => pending);
  mountAlwaysAllow({ listExternalMcpToolApprovals, listExternalMcpServers: async () => ({ servers: roster }), revokeExternalMcpToolApproval });
  expect(screen.getByText("Loading…")).toBeInTheDocument();
  await screen.findByRole("heading", { name: "Repository" });
  const revokedRow = toolRow("Repository", "get_file");
  expect(within(revokedRow).getByRole("cell", { name: "Sep 28, 2026" })).toBeInTheDocument();
  const revoke = within(revokedRow).getByRole("button", { name: "Revoke" });
  await user.click(revoke);
  expect(revokeExternalMcpToolApproval).toHaveBeenCalledExactlyOnceWith({ serverId: "git", toolName: "get_file" });
  expect(revoke).toBeDisabled();
  expect(within(toolRow("Disk", "get_file")).getByRole("button", { name: "Revoke" })).toBeEnabled();
  await act(async () => {
    if (outcome === "removed") finishRevoke({ removed: true }); else refuseRevoke({ status: 404 });
  });
  expect(revokedRow).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't revoke. Try again.")).toBeNull();
  expect(listExternalMcpToolApprovals).toHaveBeenCalledTimes(2);
  expect(toolRow("Repository", "list_files")).toBeInTheDocument();
  await act(async () => { finishRead({ approvals: [gitList, diskRead] }); });
  expect(toolRow("Disk", "get_file")).toBeInTheDocument();
  const repo = screen.getByRole("heading", { name: "Repository" }).closest("section")!;
  expect(within(repo).queryByRole("cell", { name: "get_file", exact: true })).toBeNull();
  await act(async () => { window.dispatchEvent(new Event("focus")); }); // Another client grants the same tool again.
  expect(toolRow("Repository", "get_file")).toBeInTheDocument();
});

it.each([new Error("transport offline"), null, "network refused", { status: 403 }])("keeps the permission visible on a real revoke failure (%#) and clears the error on retry", async (failure) => {
  const user = userEvent.setup();
  let approvals = [gitList];
  const revokeExternalMcpToolApproval = vi.fn<AlwaysAllowPort["revokeExternalMcpToolApproval"]>()
    .mockRejectedValueOnce(failure).mockImplementationOnce(async () => { approvals = []; return { removed: true }; });
  mountAlwaysAllow({
    listExternalMcpToolApprovals: async () => ({ approvals }), listExternalMcpServers: async () => ({ servers: roster }),
    revokeExternalMcpToolApproval,
  });
  const revoke = await screen.findByRole("button", { name: "Revoke" });
  await user.click(revoke);
  expect(await screen.findByText("Couldn't revoke. Try again.")).toBeInTheDocument();
  await waitFor(() => expect(revoke).toBeEnabled());
  expect(toolRow("Repository", "list_files")).toBeInTheDocument();
  await user.click(revoke);
  expect(await screen.findByText("Nothing is set to Always allow. Pick it on a tool's approval card in chat.")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't revoke. Try again.")).toBeNull();
  expect(revokeExternalMcpToolApproval.mock.calls).toEqual([
    [{ serverId: "git", toolName: "list_files" }], [{ serverId: "git", toolName: "list_files" }],
  ]);
});

it("recovers its first read on window focus and leaves visible approvals alone on a later refresh failure", async () => {
  const listExternalMcpToolApprovals = vi.fn<AlwaysAllowPort["listExternalMcpToolApprovals"]>()
    .mockRejectedValueOnce(new Error("initial offline")).mockResolvedValueOnce({ approvals: [diskRead] })
    .mockRejectedValueOnce(new Error("refresh offline")).mockResolvedValueOnce({ approvals: [] });
  mountAlwaysAllow({
    listExternalMcpToolApprovals, listExternalMcpServers: async () => ({ servers: roster }),
    revokeExternalMcpToolApproval: async () => { throw new Error("unexpected revoke"); },
  });
  expect(await screen.findByText("Couldn't load this list.")).toBeInTheDocument();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(await screen.findByRole("heading", { name: "Disk" })).toBeInTheDocument();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(listExternalMcpToolApprovals).toHaveBeenCalledTimes(3);
  expect(toolRow("Disk", "get_file")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load this list.")).toBeNull();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(await screen.findByText("Nothing is set to Always allow. Pick it on a tool's approval card in chat.")).toBeInTheDocument();
});

it("uses unambiguous revoke row keys even for names containing a separator", () => {
  const port: AlwaysAllowPort = {
    listExternalMcpToolApprovals: async () => ({ approvals: [] }), listExternalMcpServers: async () => ({ servers: roster }),
    revokeExternalMcpToolApproval: async () => { throw new Error("unexpected revoke"); },
  };
  const { result } = renderHook(() => useAlwaysAllow({ port, t, locale: "en-US", useFetchQuery, useFetchMutation }), { wrapper: FetchQueryProvider });
  expect(result.current.rowKey({ serverId: "a/b", toolName: "c" })).toBe('["a/b","c"]');
  expect(result.current.rowKey({ serverId: "a", toolName: "b/c" })).toBe('["a","b/c"]');
});
