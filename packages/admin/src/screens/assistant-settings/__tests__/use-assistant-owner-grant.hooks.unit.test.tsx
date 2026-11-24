// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { useConfirmRequest } from "../../../react/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssistantOwnerGrant, useAssistantOwnerGrantSettings, type OwnerGrantDependencies } from "../use-assistant-owner-grant.hooks.js";
import { publishSettingsRefresh, subscribeToSettingsRefresh } from "../../../shell/lib/settings-refresh-bus.js";

type TestGrant = { enabled: boolean; canEdit: boolean; scope: string };
type Write = Omit<TestGrant, "canEdit"> & { riskAcknowledged: boolean };
type Confirmation = ReturnType<typeof useConfirmRequest>;
type Presentation = Parameters<Confirmation["confirm"]>[0]["dialog"];
const NAMESPACE = "test.owner-grant";
const KEY = ["test", "owner-grant"] as const;

/** Typed fake site-grant port; reads can be failed after the first load to simulate a stale cache. */
function fakePort(initial: TestGrant = { enabled: false, canEdit: true, scope: "all" }) {
  let stored = initial, readFailure: Error | null = null, writeFailure: unknown = undefined, hold: Promise<void> | null = null;
  const writes: Write[] = [];
  let reads = 0;
  const port = {
    read: async (_required: Record<string, never>, _optional?: Record<string, never>) => { reads++; if (readFailure) throw readFailure; return stored; },
    write: async (input: Write, _optional?: Record<string, never>) => {
      writes.push(input);
      if (hold) await hold;
      if (writeFailure !== undefined) throw writeFailure;
      stored = { ...stored, enabled: input.enabled, scope: input.scope };
      return stored;
    },
  };
  return { port, writes, reads: () => reads,
    failRead: (message: string) => { readFailure = new Error(message); },
    failWrite: (error: unknown) => { writeFailure = error; },
    holdWrites: () => { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); return () => { hold = null; release(); }; } };
}

/** Typed fake for Jini's confirmation hook; answers are resolved by the test unless `declineAtOnce`
 * is set, so a test asserting "no consent asked" fails cleanly instead of hanging on the prompt. */
function fakeConfirmation(optional: { declineAtOnce?: boolean } = {}) {
  const asked: Presentation[] = [];
  const onCancel = vi.fn();
  let answer: (accepted: boolean) => void = () => {};
  const useConfirmation: typeof useConfirmRequest = () => ({
    confirm: async ({ dialog }) => { asked.push(dialog); return optional.declineAtOnce ? false : new Promise<boolean>(resolve => { answer = resolve; }); },
    dialog: { open: asked.length > 0, title: "", body: "", confirmLabel: "", onConfirm: () => {}, onCancel },
  });
  return { useConfirmation, asked, onCancel, answer: (accepted: boolean) => answer(accepted) };
}

/** The host's bindings as a host wires them: the real confirmation hook and refresh bus, and an
 * error rule that shows a thrown `Error`'s own words, else the grant's failure copy. */
const DEPENDENCIES: OwnerGrantDependencies = {
  useConfirmation: useConfirmRequest,
  refresh: { subscribe: subscribeToSettingsRefresh, publish: publishSettingsRefresh },
  describeError: ({ error, fallback }) => (error instanceof Error ? error.message || fallback : fallback),
};
type MountOptions = Parameters<typeof useAssistantOwnerGrant>[1] & { useConfirmation?: typeof useConfirmRequest };
function mount(port: ReturnType<typeof fakePort>["port"], options: MountOptions = {}, t?: (key: string) => string) {
  const { useConfirmation = DEPENDENCIES.useConfirmation, ...optional } = options;
  return renderHook(() => useAssistantOwnerGrant({ ...DEPENDENCIES, useConfirmation, port, namespace: NAMESPACE, key: KEY, title: "Enable it?",
    dangers: ["Danger one", "Danger two"], confirmLabel: "Enable", failure: "failed to save the test grant", ...(t ? { t } : {}) }, optional));
}
async function loaded(result: { current: { settings: TestGrant | null } }) {
  await waitFor(() => expect(result.current.settings).not.toBeNull());
}
const unsubscribers: (() => void)[] = [];
afterEach(() => { for (const stop of unsubscribers.splice(0)) stop(); });

describe("owner grant save gate", () => {
  it("writes nothing before the grant has loaded", async () => {
    const f = fakePort();
    const port = { ...f.port, read: () => new Promise<TestGrant>(() => {}) };
    const { result } = mount(port);
    await act(async () => { await result.current.save({ settings: { enabled: true, scope: "all" } }); });
    expect(f.writes).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it("writes nothing for a non-owner", async () => {
    const f = fakePort({ enabled: false, canEdit: false, scope: "all" });
    const { result } = mount(f.port);
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "none" } }); });
    expect(f.writes).toEqual([]);
  });

  it("writes nothing while the last refresh failed, even with a cached owner grant", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    const { result } = mount(f.port);
    await loaded(result);
    f.failRead("grant read is unavailable");
    act(() => publishSettingsRefresh([NAMESPACE]));
    await waitFor(() => expect(result.current.loadError).toBe("grant read is unavailable"));
    expect(result.current.settings?.canEdit).toBe(true);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    expect(f.writes).toEqual([]);
  });

  it("denies an overlapping save while the first write is in flight", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    const { result } = mount(f.port);
    await loaded(result);
    const release = f.holdWrites();
    let first!: Promise<void>;
    act(() => { first = result.current.save({ settings: { enabled: false, scope: "all" } }); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "other" } }); });
    await act(async () => { release(); await first; });
    expect(f.writes).toEqual([{ enabled: false, scope: "all", riskAcknowledged: false }]);
    expect(result.current.busy).toBe(false);
  });
});

describe("owner grant consent", () => {
  it("asks for consent with the translated copy before enabling", async () => {
    const f = fakePort(), c = fakeConfirmation();
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation }, key => `es:${key}`);
    await loaded(result);
    act(() => { void result.current.save({ settings: { enabled: true, scope: "all" } }); });
    await waitFor(() => expect(c.asked).toHaveLength(1));
    expect(c.asked[0]).toEqual({ title: "es:Enable it?", body: "es:Danger one\nes:Danger two", confirmLabel: "es:Enable", cancelLabel: "es:Cancel", tone: "danger" });
    expect(f.writes).toEqual([]);
  });

  it("uses the untranslated copy when no translator is given", async () => {
    const f = fakePort(), c = fakeConfirmation();
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    act(() => { void result.current.save({ settings: { enabled: true, scope: "all" } }); });
    await waitFor(() => expect(c.asked).toHaveLength(1));
    expect(c.asked[0]).toEqual({ title: "Enable it?", body: "Danger one\nDanger two", confirmLabel: "Enable", cancelLabel: "Cancel", tone: "danger" });
  });

  it("an accepted consent writes with riskAcknowledged true and replaces the shared grant", async () => {
    const f = fakePort(), c = fakeConfirmation();
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    let saving!: Promise<void>;
    act(() => { saving = result.current.save({ settings: { enabled: true, scope: "all" } }); });
    await waitFor(() => expect(c.asked).toHaveLength(1));
    await act(async () => { c.answer(true); await saving; });
    expect(f.writes).toEqual([{ enabled: true, scope: "all", riskAcknowledged: true }]);
    expect(result.current.settings).toEqual({ enabled: true, canEdit: true, scope: "all" });
  });

  it("a declined consent writes nothing and releases the lock", async () => {
    const f = fakePort(), c = fakeConfirmation();
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    let saving!: Promise<void>;
    act(() => { saving = result.current.save({ settings: { enabled: true, scope: "all" } }); });
    await waitFor(() => expect(c.asked).toHaveLength(1));
    await act(async () => { c.answer(false); await saving; });
    expect(f.writes).toEqual([]);
    expect(result.current.busy).toBe(false);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "none" } }); });
    expect(f.writes).toEqual([{ enabled: false, scope: "none", riskAcknowledged: false }]);
  });

  it("skips consent when the host turns enable confirmation off", async () => {
    const f = fakePort(), c = fakeConfirmation({ declineAtOnce: true });
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation, confirmEnable: false });
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: true, scope: "all" } }); });
    expect(c.asked).toEqual([]);
    expect(f.writes).toEqual([{ enabled: true, scope: "all", riskAcknowledged: false }]);
  });

  it("skips consent when disabling", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" }), c = fakeConfirmation({ declineAtOnce: true });
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    expect(c.asked).toEqual([]);
    expect(f.writes).toEqual([{ enabled: false, scope: "all", riskAcknowledged: false }]);
  });

  it("skips consent when the grant is already on", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" }), c = fakeConfirmation({ declineAtOnce: true });
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: true, scope: "none" } }); });
    expect(c.asked).toEqual([]);
    expect(f.writes).toEqual([{ enabled: true, scope: "none", riskAcknowledged: false }]);
  });

  it("cancel releases the busy state at once but keeps the lock until the consent settles", async () => {
    const f = fakePort(), c = fakeConfirmation();
    const { result } = mount(f.port, { useConfirmation: c.useConfirmation });
    await loaded(result);
    let saving!: Promise<void>;
    act(() => { saving = result.current.save({ settings: { enabled: true, scope: "all" } }); });
    await waitFor(() => expect(c.asked).toHaveLength(1));
    expect(result.current.busy).toBe(true);
    act(() => result.current.dialog.onCancel());
    expect(result.current.busy).toBe(false);
    expect(c.onCancel).toHaveBeenCalledOnce();
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "none" } }); });
    expect(f.writes).toEqual([]);
    await act(async () => { c.answer(false); await saving; });
    expect(f.writes).toEqual([]);
  });
});

describe("owner grant persistence", () => {
  it("publishes a refresh for its own namespace after a successful write", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    const scopes: (readonly string[] | null)[] = [];
    unsubscribers.push(subscribeToSettingsRefresh(scope => { scopes.push(scope); }));
    const { result } = mount(f.port);
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    expect(scopes).toEqual([[NAMESPACE]]);
  });

  it("a failed write keeps server truth and exposes the API error message", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    f.failWrite(new Error("principal is not the site owner"));
    const scopes: (readonly string[] | null)[] = [];
    unsubscribers.push(subscribeToSettingsRefresh(scope => { scopes.push(scope); }));
    const { result } = mount(f.port);
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    expect(result.current.saveError).toBe("principal is not the site owner");
    expect(result.current.settings).toEqual({ enabled: true, canEdit: true, scope: "all" });
    expect(result.current.busy).toBe(false);
    expect(scopes).toEqual([]);
  });

  it("a failed write without a message falls back to the host failure copy", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    f.failWrite(null);
    const { result } = mount(f.port);
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    expect(result.current.saveError).toBe("failed to save the test grant");
  });

  it("a new save clears the previous save error", async () => {
    const f = fakePort({ enabled: true, canEdit: true, scope: "all" });
    f.failWrite(new Error("principal is not the site owner"));
    const { result } = mount(f.port);
    await loaded(result);
    await act(async () => { await result.current.save({ settings: { enabled: false, scope: "all" } }); });
    f.failWrite(undefined);
    const release = f.holdWrites();
    let saving!: Promise<void>;
    act(() => { saving = result.current.save({ settings: { enabled: false, scope: "all" } }); });
    await waitFor(() => expect(result.current.saveError).toBeNull());
    await act(async () => { release(); await saving; });
  });
});

describe("owner grant settings query", () => {
  function mountSettings(port: ReturnType<typeof fakePort>["port"]) {
    return renderHook(() => useAssistantOwnerGrantSettings({ port, namespace: NAMESPACE, key: KEY, refresh: DEPENDENCIES.refresh }));
  }

  it("re-reads on a refresh naming its namespace", async () => {
    const f = fakePort();
    const { result } = mountSettings(f.port);
    await loaded(result);
    const before = f.reads();
    act(() => publishSettingsRefresh([NAMESPACE]));
    await waitFor(() => expect(f.reads()).toBe(before + 1));
  });

  it("re-reads on an unscoped refresh", async () => {
    const f = fakePort();
    const { result } = mountSettings(f.port);
    await loaded(result);
    const before = f.reads();
    act(() => publishSettingsRefresh());
    await waitFor(() => expect(f.reads()).toBe(before + 1));
  });

  it("ignores a refresh for another namespace", async () => {
    const f = fakePort();
    const { result } = mountSettings(f.port);
    await loaded(result);
    const before = f.reads();
    act(() => publishSettingsRefresh(["test.unrelated"]));
    await act(async () => { await Promise.resolve(); });
    expect(f.reads()).toBe(before);
  });
});
