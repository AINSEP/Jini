import { act, renderHook, waitFor } from "../../__tests__/fetch-query-support.js";
import { describe, expect, it } from "vitest";
import type { AdminMember } from "../../models.js";
import type { IdentityRefreshPort, MembersPort } from "../../ports.js";
import { createFakeMembersPort } from "../../testing.js";
import { useMembers } from "../hooks/use-members.hooks.js";

// Characterization pins for `useMembers`, written against the pre-refactor hook: derived list/detail
// error strings, the detail spinner, per-row action guards and failures, and the scope reset.
const translate = (key: string) => key;
const MEMBER: AdminMember = {
  id: "m1", workspaceId: "w1", email: "alice@example.com", name: "Alice", status: "active",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1,
};
const OTHER: AdminMember = { ...MEMBER, id: "m2", email: "bob@example.com", name: "Bob" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function mounted(port: MembersPort, queryScope?: string) {
  const hook = renderHook(({ scope }: { scope?: string }) => useMembers(scope === undefined ? { port, translate } : { port, translate, queryScope: scope }),
    { initialProps: queryScope === undefined ? {} : { scope: queryScope } });
  await waitFor(() => expect(hook.result.current.members).not.toBeNull());
  return hook;
}

describe("useMembers pins — list", () => {
  it("is null with no error before the first read settles", () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.listMembers = () => new Promise(() => {});
    const { result } = renderHook(() => useMembers({ port, translate }));
    expect(result.current.members).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("describes a failed read with the Error's message", async () => {
    const port = createFakeMembersPort({}, {});
    port.listMembers = async () => { throw new Error("roster offline"); };
    const { result } = renderHook(() => useMembers({ port, translate }));
    await waitFor(() => expect(result.current.error).toBe("roster offline"));
    expect(result.current.members).toBeNull();
  });

  // The query layer wraps a non-Error rejection into an Error carrying its text, so only an
  // Error with an empty message reaches the fallback for reads.
  it("falls back to the translated load message for an Error with no message", async () => {
    const port = createFakeMembersPort({}, {});
    port.listMembers = () => Promise.reject(new Error(""));
    const { result } = renderHook(() => useMembers({ port, translate: key => `t:${key}` }));
    await waitFor(() => expect(result.current.error).toBe("t:failed to load members"));
  });

  it("maps a FORBIDDEN code to the permission message", async () => {
    const port = createFakeMembersPort({}, {});
    port.listMembers = () => Promise.reject(Object.assign(new Error("403"), { code: "FORBIDDEN" }));
    const { result } = renderHook(() => useMembers({ port, translate }));
    await waitFor(() => expect(result.current.error).toBe("You do not have permission to do that."));
  });

  it("exposes the injected translator as both t and translate", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = await mounted(port);
    expect(result.current.t).toBe(translate);
    expect(result.current.translate).toBe(translate);
  });
});

describe("useMembers pins — detail panel", () => {
  it("reports the expanded row as loading until its detail arrives, then caches it", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const read = deferred<{ member: AdminMember }>();
    port.getMember = () => read.promise;
    const { result } = await mounted(port);
    let toggle!: Promise<void>;
    act(() => { toggle = result.current.onToggleDetail(MEMBER); });
    expect(result.current.expandedId).toBe("m1");
    await waitFor(() => expect(result.current.detailLoadingId).toBe("m1"));
    await act(async () => { read.resolve({ member: { ...MEMBER, name: "Alice Detail" } }); await toggle; });
    expect(result.current.detailLoadingId).toBeNull();
    expect(result.current.detailById.m1?.name).toBe("Alice Detail");
    expect(result.current.detailError).toBeNull();
  });

  it("does not show the spinner while an already-loaded detail refetches after a refresh", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    let refetch: ReturnType<typeof deferred<{ member: AdminMember }>> | null = null;
    let refetching = false;
    port.getMember = async () => {
      if (!refetch) return { member: MEMBER };
      refetching = true;
      return refetch.promise;
    };
    let onRefresh = () => {};
    const refresh: IdentityRefreshPort = { subscribe: (required) => { onRefresh = required.onRefresh; return () => {}; } };
    const { result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).not.toBeNull());
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await waitFor(() => expect(result.current.detailById.m1).toEqual(MEMBER));
    refetch = deferred<{ member: AdminMember }>();
    act(() => onRefresh());
    await waitFor(() => expect(refetching).toBe(true));
    expect(result.current.detailLoadingId).toBeNull();
    await act(async () => { refetch!.resolve({ member: MEMBER }); });
  });

  it("is not loading and has no error while every row is collapsed", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = await mounted(port);
    expect(result.current.expandedId).toBeNull();
    expect(result.current.detailLoadingId).toBeNull();
    expect(result.current.detailError).toBeNull();
  });

  it("describes a failed detail read with the translated fallback for an Error with no message", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.getMember = () => Promise.reject(new Error(""));
    const { result } = await mounted(port);
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await waitFor(() => expect(result.current.detailError).toBe("Failed to load member detail."));
    expect(result.current.detailLoadingId).toBeNull();
  });

  it("collapses the row when the expanded row is toggled again", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = await mounted(port);
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    expect(result.current.expandedId).toBeNull();
    expect(result.current.detailById.m1).toEqual(MEMBER);
  });
});

describe("useMembers pins — row actions", () => {
  it("returns the empty row state for a row with no action taken", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = await mounted(port);
    expect(result.current.stateFor({ id: "never" })).toEqual({ disabling: false, resending: false, error: null, notice: null });
  });

  it("records a failed disable on the row with the Error's message and clears disabling", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.disableMember = async () => { throw new Error("disable refused"); };
    const { result } = await mounted(port);
    act(() => result.current.setConfirmingDisable(MEMBER));
    await act(async () => { await result.current.confirmDisable(); });
    expect(result.current.stateFor({ id: "m1" })).toEqual({ disabling: false, resending: false, error: "disable refused", notice: null });
    expect(result.current.confirmingDisable).toBeNull();
  });

  it("falls back to the translated disable message for a non-Error failure", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.disableMember = () => Promise.reject("opaque");
    const { result } = await mounted(port);
    act(() => result.current.setConfirmingDisable(MEMBER));
    await act(async () => { await result.current.confirmDisable(); });
    expect(result.current.stateFor({ id: "m1" }).error).toBe("Failed to disable member.");
  });

  it("ignores a second disable of the same row while the first is in flight", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const write = deferred<{ member: AdminMember }>();
    let calls = 0;
    port.disableMember = () => { calls += 1; return write.promise; };
    const { result } = await mounted(port);
    act(() => result.current.setConfirmingDisable(MEMBER));
    let first!: Promise<void>;
    act(() => { first = result.current.confirmDisable(); });
    await waitFor(() => expect(result.current.stateFor({ id: "m1" }).disabling).toBe(true));
    act(() => result.current.setConfirmingDisable(MEMBER));
    await act(async () => { await result.current.confirmDisable(); });
    expect(calls).toBe(1);
    await act(async () => { write.resolve({ member: { ...MEMBER, status: "disabled" } }); await first; });
    expect(result.current.stateFor({ id: "m1" }).notice).toBe("Member disabled.");
  });

  it("leaves an uncached detail entry uncached after a disable", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER, OTHER] });
    const { result } = await mounted(port);
    act(() => result.current.setConfirmingDisable(OTHER));
    await act(async () => { await result.current.confirmDisable(); });
    expect(result.current.detailById).toEqual({});
  });

  it("confirmDisable with no pending confirmation calls nothing", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    let calls = 0;
    port.disableMember = async () => { calls += 1; return { member: MEMBER }; };
    const { result } = await mounted(port);
    await act(async () => { await result.current.confirmDisable(); });
    expect(calls).toBe(0);
  });

  it("sends a sign-in link to the member's email and records the notice", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result } = await mounted(port);
    await act(async () => { await result.current.onResendSignInLink(MEMBER); });
    expect(port.magicLinkRequests).toEqual(["alice@example.com"]);
    expect(result.current.stateFor({ id: "m1" })).toEqual({ disabling: false, resending: false, error: null, notice: "Sign-in link sent." });
  });

  it("records a failed resend on the row with the Error's message", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.requestMemberMagicLink = async () => { throw new Error("mailer down"); };
    const { result } = await mounted(port);
    await act(async () => { await result.current.onResendSignInLink(MEMBER); });
    expect(result.current.stateFor({ id: "m1" })).toEqual({ disabling: false, resending: false, error: "mailer down", notice: null });
  });

  it("falls back to the translated resend message for a non-Error failure", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.requestMemberMagicLink = () => Promise.reject("opaque");
    const { result } = await mounted(port);
    await act(async () => { await result.current.onResendSignInLink(MEMBER); });
    expect(result.current.stateFor({ id: "m1" }).error).toBe("Failed to send sign-in link.");
  });

  it("ignores a second resend for the same row while the first is in flight", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const send = deferred<{ delivered: true }>();
    let calls = 0;
    port.requestMemberMagicLink = () => { calls += 1; return send.promise; };
    const { result } = await mounted(port);
    let first!: Promise<void>;
    act(() => { first = result.current.onResendSignInLink(MEMBER); });
    await waitFor(() => expect(result.current.stateFor({ id: "m1" }).resending).toBe(true));
    await act(async () => { await result.current.onResendSignInLink(MEMBER); });
    expect(calls).toBe(1);
    await act(async () => { send.resolve({ delivered: true }); await first; });
    expect(result.current.stateFor({ id: "m1" }).notice).toBe("Sign-in link sent.");
  });
});

describe("useMembers pins — scope and refresh", () => {
  it("resets expansion, cached detail, row state and the pending confirmation when the scope changes", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const { result, rerender } = await mounted(port, "ws-a");
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await act(async () => { await result.current.onResendSignInLink(MEMBER); });
    act(() => result.current.setConfirmingDisable(MEMBER));
    rerender({ scope: "ws-b" });
    await waitFor(() => expect(result.current.expandedId).toBeNull());
    expect(result.current.detailById).toEqual({});
    expect(result.current.stateFor({ id: "m1" }).notice).toBeNull();
    expect(result.current.confirmingDisable).toBeNull();
  });

  it("unsubscribes from the refresh port on unmount", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    let subscribed = 0;
    let unsubscribed = 0;
    const refresh: IdentityRefreshPort = { subscribe: () => { subscribed += 1; return () => { unsubscribed += 1; }; } };
    const { unmount, result } = renderHook(() => useMembers({ port, translate }, { refresh }));
    await waitFor(() => expect(result.current.members).not.toBeNull());
    expect(subscribed).toBe(1);
    unmount();
    expect(unsubscribed).toBe(1);
  });
});

describe("useMembers pins — cached detail across scopes", () => {
  it("reopening a row whose detail came back from the cache after a scope round trip reuses it", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    let reads = 0;
    port.getMember = async ({ id }) => { reads += 1; return { member: { ...MEMBER, id } }; };
    const { result, rerender } = await mounted(port, "ws-a");
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    rerender({ scope: "ws-b" });
    await waitFor(() => expect(result.current.expandedId).toBeNull());
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    rerender({ scope: "ws-a" });
    await waitFor(() => expect(result.current.expandedId).toBeNull());
    const readsBeforeReopen = reads;
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    expect(result.current.expandedId).toBe("m1");
    expect(result.current.detailById.m1).toEqual(MEMBER);
    expect(reads).toBe(readsBeforeReopen);
  });

  it("reopening a row whose detail is already cached does not read it again", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    let reads = 0;
    port.getMember = async () => { reads += 1; return { member: MEMBER }; };
    const { result } = await mounted(port);
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    await act(async () => { await result.current.onToggleDetail(MEMBER); });
    expect(result.current.expandedId).toBe("m1");
    expect(reads).toBe(1);
  });
});

