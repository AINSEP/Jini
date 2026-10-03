import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminMember } from "../../models.js";
import { createFakeMembersPort } from "../../testing.js";
import { useMembers } from "../hooks/use-members.hooks.js";
import type { IdentityRefreshPort } from "../../ports.js";
const translate = (key: string) => key;
const listeners = new Set<() => void>();
const refresh: IdentityRefreshPort = { subscribe: ({ onRefresh }) => { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
const publishContentRefresh = (resources?: readonly string[]) => {
  if (resources && !resources.includes("members")) return;
  for (const listener of listeners) listener();
};
const resetContentRefreshBus = () => listeners.clear();
const MEMBERS_RESOURCE = "members";
const MEMBER: AdminMember = {
  id: "m1",
  workspaceId: "w1",
  email: "alice@example.com",
  name: "Alice",
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

describe("useMembers — content refresh bus", () => {
  afterEach(() => resetContentRefreshBus());

  it("re-reads the list when a content refresh fires, so an assistant-disabled member appears without a reload", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    port.members[0] = { ...MEMBER, status: "disabled" };
    expect(result.current.members?.[0]?.status).toBe("active");

    act(() => publishContentRefresh());

    await waitFor(() => expect(result.current.members?.[0]?.status).toBe("disabled"));
  });

  it("refreshes on a notification that names members, and ignores one that names only other resources", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    port.members[0] = { ...MEMBER, status: "disabled" };

    act(() => publishContentRefresh(["taxonomy"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.members?.[0]?.status).toBe("active");

    act(() => publishContentRefresh([MEMBERS_RESOURCE]));
    await waitFor(() => expect(result.current.members?.[0]?.status).toBe("disabled"));
  });

  it("stops re-reading once unmounted", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const listSpy = vi.spyOn(port, "listMembers");
    const { result, unmount } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    const callsWhileMounted = listSpy.mock.calls.length;
    unmount();
    act(() => publishContentRefresh());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listSpy).toHaveBeenCalledTimes(callsWhileMounted);
  });

  it("does not let a slower, earlier-triggered refresh overwrite a newer one that already settled (out-of-order response race)", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    let resolveFirst!: (v: { members: AdminMember[] }) => void;
    let resolveSecond!: (v: { members: AdminMember[] }) => void;
    vi.spyOn(port, "listMembers")
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    act(() => {
      publishContentRefresh();
      publishContentRefresh();
    });

    const disabled: AdminMember = { ...MEMBER, status: "disabled" };
    await act(async () => {
      resolveSecond({ members: [disabled] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.members).toEqual([disabled]));

    await act(async () => {
      resolveFirst({ members: [MEMBER] });
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([disabled]);
  });
});

describe("useMembers — a slow row's detail settle does not blank or error another row's panel (C7)", () => {
  it("rejecting a slow-loading row's detail after a different row was expanded leaves the new row's panel alone", async () => {

    const MEMBER_A: AdminMember = { ...MEMBER, id: "mA" };
    const MEMBER_B: AdminMember = { ...MEMBER, id: "mB", email: "bob@example.com" };
    const port = createFakeMembersPort({}, { members: [MEMBER_A, MEMBER_B] });

    let rejectA!: (e: unknown) => void;
    vi.spyOn(port, "getMember")
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectA = reject)))

      .mockImplementationOnce(() => new Promise<{ member: AdminMember }>(() => {}));

    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER_A, MEMBER_B]));

    let pA!: Promise<void>;
    act(() => {
      pA = result.current.onToggleDetail(MEMBER_A);
    });
    act(() => {
      void result.current.onToggleDetail(MEMBER_B);
    });

    rejectA(new Error("boom-A"));
    await act(async () => {
      await pA;
    });

    expect(result.current.detailError).toBeNull();
    expect(result.current.detailLoadingId).toBe(MEMBER_B.id);
  });

  it("a row collapsed and clicked again reopens", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });

    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    await act(async () => {
      await result.current.onToggleDetail(MEMBER);
    });
    expect(result.current.expandedId).toBe(MEMBER.id);
    await act(async () => {
      await result.current.onToggleDetail(MEMBER);
    });
    expect(result.current.expandedId).toBeNull();
    await act(async () => {
      await result.current.onToggleDetail(MEMBER);
    });
    expect(result.current.expandedId).toBe(MEMBER.id);
  });

  it("the first load of a closed-and-reopened row failing late does not error or un-spin the reopened panel", async () => {

    const port = createFakeMembersPort({}, { members: [MEMBER] });

    let rejectFirst!: (e: unknown) => void;
    let resolveSecond!: (v: { member: AdminMember }) => void;
    vi.spyOn(port, "getMember")
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => new Promise<{ member: AdminMember }>((resolve) => (resolveSecond = resolve)));

    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER]));

    let first!: Promise<void>;
    act(() => {
      first = result.current.onToggleDetail(MEMBER);
    });
    act(() => {
      void result.current.onToggleDetail(MEMBER);
    });
    let second!: Promise<void>;
    act(() => {
      second = result.current.onToggleDetail(MEMBER);
    });
    expect(result.current.expandedId).toBe(MEMBER.id);

    rejectFirst(new Error("boom-first"));
    await act(async () => {
      await first;
    });
    expect(result.current.detailError).toBeNull();
    expect(result.current.detailLoadingId).toBe(MEMBER.id);

    await act(async () => {
      resolveSecond({ member: MEMBER });
      await second;
    });
    expect(result.current.detailError).toBeNull();
    expect(result.current.detailLoadingId).toBeNull();
    expect(result.current.detailById[MEMBER.id]).toEqual(MEMBER);
  });

  it("a slow row failing after the operator moved to an already-loaded row leaves that row's panel alone", async () => {

    const MEMBER_A: AdminMember = { ...MEMBER, id: "mA" };
    const MEMBER_B: AdminMember = { ...MEMBER, id: "mB", email: "bob@example.com" };
    const port = createFakeMembersPort({}, { members: [MEMBER_A, MEMBER_B] });

    let rejectA!: (e: unknown) => void;
    vi.spyOn(port, "getMember")
      .mockImplementationOnce(() => Promise.resolve({ member: MEMBER_B }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectA = reject)));

    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).toEqual([MEMBER_A, MEMBER_B]));

    await act(async () => {
      await result.current.onToggleDetail(MEMBER_B);
    });
    expect(result.current.detailById[MEMBER_B.id]).toEqual(MEMBER_B);

    let pA!: Promise<void>;
    act(() => {
      pA = result.current.onToggleDetail(MEMBER_A);
    });
    await act(async () => {
      await result.current.onToggleDetail(MEMBER_B);
    });
    expect(result.current.expandedId).toBe(MEMBER_B.id);

    rejectA(new Error("boom-A"));
    await act(async () => {
      await pA;
    });
    expect(result.current.detailError).toBeNull();
    expect(result.current.detailLoadingId).toBeNull();
  });
});
