// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminRemoteToolSurfaceEntry } from "@jini-ai/core/contracts/hosted-mcp";
import { renderHook } from "../../../../__tests__/fetch-query-support.js";
import type { ExternalMcpProbeErrors } from "../../external-mcp-tool-picker-rules.js";
import { useExternalMcpToolPicker, type ExternalMcpToolPickerPort } from "../use-external-mcp-tool-picker.hooks.js";

/**
 * @file The pure picker transport/draft hook over a fake port and a fake error vocabulary (the host
 * binding's wired port and its real request-error class are covered in the host's own suite).
 */

/** A stand-in for the host's request-error class: a coded error the generic wording can recognise. */
class FakeApiError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
const errors: ExternalMcpProbeErrors = {
  isApiError: (error): error is FakeApiError => error instanceof FakeApiError,
  describeApiError: ({ e, fallback }) => (e instanceof Error ? e.message : fallback),
};

function tool(remoteName: string, overrides: Partial<AdminRemoteToolSurfaceEntry> = {}): AdminRemoteToolSurfaceEntry {
  return { remoteName, description: `${remoteName} description`, writeDeclared: false, destructiveDeclared: false, hintsAbsent: false, allowlisted: false, writeAllowed: false, admitted: false, refusalReason: null, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type Input = Omit<Parameters<typeof useExternalMcpToolPicker>[0], "port" | "t" | "errors">;
const initial: Input = { serverId: "atlas", active: true, allowedToolNames: "read, write", writeAllowedToolNames: "write" };
const tools = [tool("read"), tool("write", { writeDeclared: true }), tool("erase", { destructiveDeclared: true })];
const t = (key: string) => key;

function mount(port: ExternalMcpToolPickerPort, input: Input = initial) {
  return renderHook((props: Input) => useExternalMcpToolPicker({ ...props, port, t, errors }), { initialProps: input });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("MCP picker transport and draft lifecycle", () => {
  // Author Checklist: real query/effects, fresh cache, literal field expectations,
  // held promises, exact IDs. Mutations below are hypothetical: source edits are forbidden.
  it("waits for activation, reports the held first load, then seeds saved permissions", async () => {
    // F2.3/F6.2: replacing enabled: active with enabled: true must fail before activation.
    const pending = deferred<{ tools: AdminRemoteToolSurfaceEntry[] }>();
    const probe = vi.fn(({ serverId: id }: { serverId: string }, _options = {}) => { if (id !== "atlas") throw new Error(`wrong id ${id}`); return pending.promise; });
    const { result, rerender } = mount({ probe }, { ...initial, active: false });
    expect(probe).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    rerender(initial);
    await waitFor(() => expect(probe).toHaveBeenCalledExactlyOnceWith({ serverId: "atlas" }));
    expect(result.current.loading).toBe(true);
    expect(result.current.refreshing).toBe(true);
    await act(async () => { pending.resolve({ tools }); await pending.promise; });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    expect(result.current.loading).toBe(false);
    expect(result.current.unreachable).toBeNull();
    expect(result.current.enabledCount).toBe(2);
    expect(result.current.dirty).toBe(false);
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "write" });
  });

  it("edits one tool, clears its write grant on disable, and resets to saved values", async () => {
    // F2.5/F4.5: dropping setRows from reset or wiring setMayWrite to setEnabled fails.
    const { result } = mount({ probe: async ({ serverId: id }, _options = {}) => { if (id !== "atlas") throw new Error(id); return { tools }; } });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    act(() => result.current.setEnabled("write", false));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "" });
    expect(result.current.dirty).toBe(true);
    expect(result.current.enabledCount).toBe(1);
    act(() => result.current.setMayWrite("write", true));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "write" });
    act(() => result.current.setMayWrite("read", true));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "read, write" });
    act(() => result.current.setEnabled("erase", true));
    expect(result.current.rows.find((row) => row.remoteName === "erase")?.enabled).toBe(false);
    act(() => result.current.reset());
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "write" });
    expect(result.current.dirty).toBe(false);
  });

  it("keeps a dirty draft across an equal-surface refresh and tab close/reopen", async () => {
    // F7.1/F6.2: keying the seed effect on tools identity instead of signature clobbers this draft.
    const refresh = deferred<{ tools: AdminRemoteToolSurfaceEntry[] }>();
    let requests = 0;
    const probe = vi.fn(({ serverId: id }: { serverId: string }, _options = {}) => { if (id !== "atlas") throw new Error(id); return ++requests === 1 ? Promise.resolve({ tools }) : refresh.promise; });
    const { result, rerender } = mount({ probe });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    act(() => result.current.setEnabled("write", false));
    rerender({ ...initial, active: false });
    rerender(initial);
    expect(probe).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "" });
    await act(async () => { refresh.resolve({ tools: tools.map((entry) => ({ ...entry, description: "new description" })) }); await refresh.promise; });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.dirty).toBe(true);
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "" });
    expect(probe.mock.calls).toEqual([[{ serverId: "atlas" }], [{ serverId: "atlas" }]]);
  });

  it("re-seeds when saved grants change and preserves absent saved tool names", async () => {
    // F6.2: omitting saved field values from the signature leaves stale grants after roster refresh.
    const { result, rerender } = mount({ probe: async ({ serverId: id }, _options = {}) => { if (id !== "atlas") throw new Error(id); return { tools }; } });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    act(() => result.current.setEnabled("read", false));
    rerender({ ...initial, allowedToolNames: "write, legacy", writeAllowedToolNames: "legacy" });
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "write, legacy", writeAllowedToolNames: "legacy" });
    expect(result.current.rows.find((row) => row.remoteName === "legacy")).toEqual({ remoteName: "legacy", description: "", enabled: true, mayWrite: true, writeDeclared: false, destructiveDeclared: false, hintsAbsent: false, kind: "absent" });
    expect(result.current.dirty).toBe(false);
  });

  it("honors refreshed destructive annotations without discarding unrelated draft grants", async () => {
    // BUG / F6.2/F7.1: a vendor can change annotations without renaming a tool.
    // The signature currently ignores that change, leaving the old, editable row.
    // Author Checklist: real query/seed/setters, strict server identity, held
    // refresh, non-default draft, literal grant output; source remains unchanged.
    const refresh = deferred<{ tools: AdminRemoteToolSurfaceEntry[] }>();
    let requests = 0;
    const probe = vi.fn(({ serverId: id }: { serverId: string }, _options = {}) => {
      if (id !== "atlas") throw new Error(`wrong id ${id}`);
      return ++requests === 1 ? Promise.resolve({ tools }) : refresh.promise;
    });
    const { result } = mount({ probe }, { ...initial, allowedToolNames: "read", writeAllowedToolNames: "" });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    act(() => result.current.setMayWrite("read", true));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "read" });
    act(() => result.current.refresh());
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      refresh.resolve({ tools: tools.map((entry) => entry.remoteName === "write" ? { ...entry, destructiveDeclared: true } : entry) });
      await refresh.promise;
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    // A refresh must preserve the edit on read, but the newly destructive write
    // tool must refuse both setters, as INV-003/D-1 requires for destructive rows.
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "read" });
    act(() => result.current.setEnabled("write", true));
    act(() => result.current.setMayWrite("write", true));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read", writeAllowedToolNames: "read" });
    expect(probe.mock.calls).toEqual([[{ serverId: "atlas" }], [{ serverId: "atlas" }]]);
  });

  it("surfaces an unreachable probe, then clears the error after an explicit successful retry", async () => {
    // F6.2: leaving unreachable set after retry or never calling refetch fails.
    const retry = deferred<{ tools: AdminRemoteToolSurfaceEntry[] }>();
    let requests = 0;
    const probe = vi.fn(({ serverId: id }: { serverId: string }, _options = {}) => { if (id !== "atlas") throw new Error(id); return ++requests === 1 ? Promise.reject(new Error("wire failed")) : retry.promise; });
    const { result } = mount({ probe }, { ...initial, allowedToolNames: "", writeAllowedToolNames: "" });
    await waitFor(() => expect(result.current.unreachable).toBe("wire failed"));
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
    act(() => result.current.refresh());
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    await act(async () => { retry.resolve({ tools }); await retry.promise; });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    expect(result.current.unreachable).toBeNull();
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "", writeAllowedToolNames: "" });
    expect(result.current.refreshing).toBe(false);
  });

  it("routes a coded unsupported-transport error through the supplied translator and the injected error guard", async () => {
    // F2.4: failing to forward t leaves English workaround copy in a translated dialog.
    const translate = (key: string) => `translated:${key}`;
    const port = { probe: async ({ serverId: id }: { serverId: string }, _options = {}) => { if (id !== "atlas") throw new Error(id); throw new FakeApiError("server prose", "PROBE_UNSUPPORTED_TRANSPORT"); } };
    const { result } = renderHook(() => useExternalMcpToolPicker({ ...initial, port, t: translate, errors }));
    await waitFor(() => expect(result.current.unreachable).toBe("translated:This server runs as a local command and can't be probed yet — type its tool names into 'Allowed tools' on the server's own card instead."));
  });

  it("re-seeds a dirty draft when the advertised names actually change", async () => {
    // F6.2: never updating signature on advertised names would leave newly offered tools invisible.
    let requests = 0;
    const probe = vi.fn(async ({ serverId: id }: { serverId: string }, _options = {}) => {
      if (id !== "atlas") throw new Error(id);
      return { tools: ++requests === 1 ? tools : [...tools, tool("added")] };
    });
    const { result } = mount({ probe });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    act(() => result.current.setEnabled("write", false));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.advertisedCount).toBe(4));
    expect(result.current.rows.find((row) => row.remoteName === "added")?.enabled).toBe(false);
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "write" });
    expect(result.current.dirty).toBe(false);
  });

  it("keeps probes fresh for five minutes, then re-probes on reopening", async () => {
    // F7.1/F7.7: changing staleTime to the default 10 seconds must fail at 299999ms.
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const probe = vi.fn(async ({ serverId: id }: { serverId: string }, _options = {}) => { if (id !== "atlas") throw new Error(id); return { tools }; });
    const { result, rerender } = mount({ probe });
    await waitFor(() => expect(result.current.advertisedCount).toBe(3));
    now += 299_999;
    rerender({ ...initial, active: false });
    rerender(initial);
    expect(probe.mock.calls).toEqual([[{ serverId: "atlas" }]]);
    now += 2;
    rerender({ ...initial, active: false });
    rerender(initial);
    await waitFor(() => expect(probe.mock.calls).toEqual([[{ serverId: "atlas" }], [{ serverId: "atlas" }]]));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.fieldValues()).toEqual({ allowedToolNames: "read, write", writeAllowedToolNames: "write" });
  });

  it("does not let a late old-server probe replace the newly selected server's permissions", async () => {
    // F7.1: deleting serverId from the query key accepts Atlas's late result into Boreal's picker.
    const old = deferred<{ tools: AdminRemoteToolSurfaceEntry[] }>();
    const probe = vi.fn(({ serverId: id }: { serverId: string }, _options = {}) => {
      if (id === "atlas") return old.promise;
      if (id === "boreal") return Promise.resolve({ tools: [tool("boreal.read")] });
      throw new Error(`unexpected server ${id}`);
    });
    const { result, rerender } = mount({ probe });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(probe).toHaveBeenCalledExactlyOnceWith({ serverId: "atlas" }));
    rerender({ ...initial, serverId: "boreal", allowedToolNames: "boreal.read", writeAllowedToolNames: "" });
    await waitFor(() => expect(result.current.fieldValues()).toEqual({ allowedToolNames: "boreal.read", writeAllowedToolNames: "" }));
    await waitFor(() => expect(result.current.advertisedCount).toBe(1));
    await act(async () => { old.resolve({ tools }); await old.promise; });
    expect(result.current.rows.map((row) => row.remoteName)).toEqual(["boreal.read"]);
    expect(result.current.advertisedCount).toBe(1);
    expect(result.current.unreachable).toBeNull();
    expect(probe.mock.calls).toEqual([[{ serverId: "atlas" }], [{ serverId: "boreal" }]]);
  });

});

it("reopening after declining every recommended tool keeps them unticked", async () => {
  const port = { probe: vi.fn(async () => ({ tools: [tool("read_a")] })) };
  const absent: Input = { serverId: "atlas", active: true, allowedToolNames: undefined, writeAllowedToolNames: undefined };
  const first = mount(port, absent);
  await waitFor(() => expect(first.result.current.enabledCount).toBe(1));
  act(() => first.result.current.setEnabled("read_a", false));
  const saved = first.result.current.fieldValues();
  expect(saved).toEqual({ allowedToolNames: "", writeAllowedToolNames: "" });
  first.unmount();

  const reopened = mount(port, { ...absent, ...saved });
  await waitFor(() => expect(reopened.result.current.advertisedCount).toBe(1));
  expect(reopened.result.current.enabledCount).toBe(0);
  expect(reopened.result.current.fieldValues()).toEqual(saved);
  expect(reopened.result.current.dirty).toBe(false);
  reopened.unmount();

  const loadingSaved = mount(port, absent);
  await waitFor(() => expect(loadingSaved.result.current.enabledCount).toBe(1));
  loadingSaved.rerender({ ...absent, ...saved });
  expect(loadingSaved.result.current.enabledCount).toBe(0);
  expect(loadingSaved.result.current.fieldValues()).toEqual(saved);
  expect(loadingSaved.result.current.dirty).toBe(false);
});
