// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useExternalEntryRefresh } from "../use-external-entry-refresh.hooks.js";
import { AdminKitProvider, useSettlementGeneration } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";

/**
 * @file `useExternalEntryRefresh` — the stateful half of the shared "did the row change while the
 * editor is open" mechanism (see `lib/external-entry-refresh.ts`'s header). Driven with hand-rolled
 * deferred promises rather than fake timers, so each test controls exactly when a fetch settles
 * relative to the others.
 */

/** The hook reads `useSettlementGeneration` from the admin kit, so every render sits under the fake kit. */
const kit = fakeAdminKit();
function wrapper({ children }: { children: ReactNode }) {
  return createElement(AdminKitProvider, { kit, children });
}

interface TestRow {
  id: string;
  version: number;
}

/** A promise plus its own externally-callable resolve/reject, for controlling settlement order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides?: {
  loaded?: TestRow | null;
  dirty?: boolean;
  saving?: boolean;
  fetchLatest?: (input: { id: string }) => Promise<TestRow>;
}) {
  const callLog: string[] = [];
  const applyLatest = vi.fn((row: TestRow) => {
    callLog.push(`apply ${row.version}`);
  });
  const discardStandingDraft = vi.fn().mockResolvedValue(undefined);
  const supersedeStandingDraftBasis = vi.fn((version: number) => {
    callLog.push(`supersede ${version}`);
  });
  const onLoadLatestFailed = vi.fn();
  let dirty = overrides?.dirty ?? false;
  let saving = overrides?.saving ?? false;
  let loaded: TestRow | null = overrides?.loaded ?? { id: "a", version: 1 };
  // Always a real mock (never a bare function) so every caller can chain `.mockReturnValueOnce`
  // etc. regardless of whether `overrides.fetchLatest` was supplied.
  const fetchLatest = overrides?.fetchLatest ? vi.fn(overrides.fetchLatest) : vi.fn<(input: { id: string }) => Promise<TestRow>>();

  const { result, rerender } = renderHook<ReturnType<typeof useExternalEntryRefresh<TestRow>>, { loaded: TestRow | null }>(
    (props) =>
      useExternalEntryRefresh<TestRow>({
        routeIdentity: "test-route",
        saveSettlement: 0,
        loaded: props.loaded,
        fetchLatest,
        isDirty: () => dirty,
        isSaving: () => saving,
        applyLatest,
        discardStandingDraft,
        supersedeStandingDraftBasis,
        onLoadLatestFailed,
        useSettlementGeneration,
      }),
    { initialProps: { loaded }, wrapper }
  );

  return {
    result,
    rerender: (next: { loaded: TestRow | null }) => {
      loaded = next.loaded;
      rerender(next);
    },
    setDirty: (value: boolean) => {
      dirty = value;
    },
    setSaving: (value: boolean) => {
      saving = value;
    },
    applyLatest,
    discardStandingDraft,
    supersedeStandingDraftBasis,
    onLoadLatestFailed,
    fetchLatest,
    callLog,
  };
}

describe("useExternalEntryRefresh — checkForExternalChange", () => {
  it("applies a newer row when clean and never shows the notice", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: false, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(env.applyLatest).toHaveBeenCalledWith({ id: "a", version: 2 });
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });

  // Reviewer finding 2 (2026-09-16): an autosave built on the replaced version must not reach the
  // server and be refused after the apply, so the basis moves first.
  it("a silent apply supersedes the standing draft's basis BEFORE replacing the working copy", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: false, fetchLatest: vi.fn().mockReturnValue(promise) });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(env.callLog).toEqual(["supersede 2", "apply 2"]);
  });

  it("a notice or a no-op check never supersedes the basis — the editor is still on it", async () => {
    const notified = deferred<TestRow>();
    const unchanged = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(notified.promise).mockReturnValueOnce(unchanged.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      notified.resolve({ id: "a", version: 2 });
      await notified.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(2);

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      unchanged.resolve({ id: "a", version: 1 });
      await unchanged.promise;
    });

    expect(env.supersedeStandingDraftBasis).not.toHaveBeenCalled();
  });

  it("a failed background re-read is silent: no notice, no apply, no error surfaced", async () => {
    const fetchLatest = vi.fn().mockRejectedValue(new Error("offline"));
    const env = setup({ loaded: { id: "a", version: 1 }, fetchLatest });

    await act(async () => {
      env.result.current.checkForExternalChange();
      await Promise.resolve();
    });

    expect(fetchLatest).toHaveBeenCalledWith({ id: "a" });
    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.supersedeStandingDraftBasis).not.toHaveBeenCalled();
    expect(env.onLoadLatestFailed).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });

  it("does nothing when the fetched row is not newer", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 3 }, dirty: false, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 3 });
      await promise;
    });

    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });

  it("shows pendingExternalVersion instead of applying when dirty", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBe(2);
  });

  it("reads dirty when the fetch settles, not when it starts", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: false, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    env.setDirty(true);
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBe(2);
  });

  it("ignores a newer row that settles while a save is in flight", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: false, fetchLatest });

    env.setSaving(true);
    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });

  it("drops an earlier check that settles after a later one", async () => {
    const first = deferred<TestRow>();
    const second = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: false, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
      env.result.current.checkForExternalChange();
    });

    await act(async () => {
      second.resolve({ id: "a", version: 5 });
      await second.promise;
    });
    await act(async () => {
      first.resolve({ id: "a", version: 4 });
      await first.promise.catch(() => undefined);
    });

    expect(env.applyLatest).toHaveBeenCalledTimes(1);
    expect(env.applyLatest).toHaveBeenCalledWith({ id: "a", version: 5 });
  });

  it("drops a check that settles after unmount", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const applyLatest = vi.fn();
    const { result, unmount } = renderHook(() =>
      useExternalEntryRefresh<TestRow>({
        routeIdentity: "test-route",
        saveSettlement: 0,
        loaded: { id: "a", version: 1 },
        fetchLatest,
        isDirty: () => false,
        isSaving: () => false,
        applyLatest,
        discardStandingDraft: vi.fn().mockResolvedValue(undefined),
        supersedeStandingDraftBasis: vi.fn(),
        onLoadLatestFailed: vi.fn(),
        useSettlementGeneration,
      }),
    { wrapper }
    );

    act(() => {
      result.current.checkForExternalChange();
    });
    unmount();
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });

    expect(applyLatest).not.toHaveBeenCalled();
  });
});

describe("useExternalEntryRefresh — dismissExternalChange", () => {
  it("dismissing before an entry loads does not suppress a later conflict", async () => {
    const fresh = deferred<TestRow>();
    const env = setup({ dirty: true, fetchLatest: () => fresh.promise });
    env.rerender({ loaded: null });
    act(() => {
      env.result.current.dismissExternalChange();
      env.result.current.checkForExternalChange();
    });
    expect(env.result.current.pendingExternalVersion).toBeNull();
    expect(env.fetchLatest).not.toHaveBeenCalled();

    env.rerender({ loaded: { id: "a", version: 1 } });
    act(() => env.result.current.checkForExternalChange());
    await act(async () => {
      fresh.resolve({ id: "a", version: 2 });
      await fresh.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(2);
    expect(env.applyLatest).not.toHaveBeenCalled();
  });

  it("hides the notice and suppresses it for the same basis; a new basis re-enables it", async () => {
    const first = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(first.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      first.resolve({ id: "a", version: 2 });
      await first.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(2);

    act(() => {
      env.result.current.dismissExternalChange();
    });
    expect(env.result.current.pendingExternalVersion).toBeNull();

    // Same basis (version 1) checks again — stays quiet.
    const second = deferred<TestRow>();
    env.fetchLatest.mockReturnValueOnce(second.promise);
    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      second.resolve({ id: "a", version: 3 });
      await second.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBeNull();
    expect(env.applyLatest).not.toHaveBeenCalled();

    // The basis moves (e.g. a Save anyway bumped it to 3) — re-render with the new loaded basis.
    env.rerender({ loaded: { id: "a", version: 3 } });
    const third = deferred<TestRow>();
    env.fetchLatest.mockReturnValueOnce(third.promise);
    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      third.resolve({ id: "a", version: 4 });
      await third.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(4);
  });
});

describe("useExternalEntryRefresh — loadExternalChange", () => {
  it.each(["saving", "not loaded"] as const)("does nothing while %s", async (guard) => {
    const env = setup({ fetchLatest: async () => ({ id: "a", version: 2 }) });
    if (guard === "saving") env.setSaving(true);
    else env.rerender({ loaded: null });

    await act(async () => { await env.result.current.loadExternalChange(); });

    expect(env.fetchLatest).not.toHaveBeenCalled();
    expect(env.discardStandingDraft).not.toHaveBeenCalled();
    expect(env.supersedeStandingDraftBasis).not.toHaveBeenCalled();
    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.onLoadLatestFailed).not.toHaveBeenCalled();
  });

  it("discards the standing draft BEFORE applying, and clears the notice", async () => {
    const callLog: string[] = [];
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const applyLatest = vi.fn(() => callLog.push("apply"));
    const discardStandingDraft = vi.fn(async () => {
      callLog.push("discard");
    });

    const { result } = renderHook(() =>
      useExternalEntryRefresh<TestRow>({
        routeIdentity: "test-route",
        saveSettlement: 0,
        loaded: { id: "a", version: 1 },
        fetchLatest,
        isDirty: () => true,
        isSaving: () => false,
        applyLatest,
        discardStandingDraft,
        supersedeStandingDraftBasis: vi.fn(),
        onLoadLatestFailed: vi.fn(),
        useSettlementGeneration,
      }),
    { wrapper }
    );

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.loadExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await loadPromise;
    });

    expect(callLog).toEqual(["discard", "apply"]);
    expect(applyLatest).toHaveBeenCalledWith({ id: "a", version: 2 });
    expect(result.current.pendingExternalVersion).toBeNull();
  });

  it("supersedes the standing draft's basis after discarding and before applying", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest: vi.fn().mockReturnValue(promise) });
    env.discardStandingDraft.mockImplementation(async () => {
      env.callLog.push("discard");
    });

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = env.result.current.loadExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await loadPromise;
    });

    expect(env.callLog).toEqual(["discard", "supersede 2", "apply 2"]);
  });

  it("reports failure through onLoadLatestFailed and leaves the working copy alone", async () => {
    const fetchLatest = vi.fn().mockRejectedValue(new Error("boom"));
    const env = setup({ loaded: { id: "a", version: 1 }, fetchLatest });

    await act(async () => {
      await env.result.current.loadExternalChange();
    });

    expect(env.onLoadLatestFailed).toHaveBeenCalledTimes(1);
    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.supersedeStandingDraftBasis).not.toHaveBeenCalled();
  });

  // Reviewer finding 3 (2026-09-16): a check and the click shared one generation counter, so a
  // tool-result publish landing during the click's re-read dropped the click without a word.
  it("a background check landing while Load latest is in flight neither drops the click nor is lost", async () => {
    const load = deferred<TestRow>();
    const recheck = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(load.promise).mockReturnValueOnce(recheck.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = env.result.current.loadExternalChange();
    });
    act(() => {
      env.result.current.checkForExternalChange();
    });
    // Deferred, not started over the click.
    expect(env.fetchLatest).toHaveBeenCalledTimes(1);

    await act(async () => {
      load.resolve({ id: "a", version: 6 });
      await loadPromise;
    });
    expect(env.applyLatest).toHaveBeenCalledWith({ id: "a", version: 6 });
    // The editor is clean on version 6 now; the deferred check runs because the notification may
    // name a write newer than the row the click fetched.
    env.setDirty(false);
    env.rerender({ loaded: { id: "a", version: 6 } });
    expect(env.fetchLatest).toHaveBeenCalledTimes(2);

    await act(async () => {
      recheck.resolve({ id: "a", version: 7 });
      await recheck.promise;
    });
    expect(env.applyLatest).toHaveBeenLastCalledWith({ id: "a", version: 7 });
  });

  it("a check deferred behind a Load latest that fails still runs", async () => {
    const load = deferred<TestRow>();
    const recheck = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(load.promise).mockReturnValueOnce(recheck.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = env.result.current.loadExternalChange();
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      load.reject(new Error("offline"));
      await loadPromise;
    });
    expect(env.onLoadLatestFailed).toHaveBeenCalledTimes(1);
    expect(env.fetchLatest).toHaveBeenCalledTimes(2);

    await act(async () => {
      recheck.resolve({ id: "a", version: 3 });
      await recheck.promise;
    });
    expect(env.applyLatest).not.toHaveBeenCalled();
    expect(env.result.current.pendingExternalVersion).toBe(3);
  });

  it("a superseded Load latest click neither ends the in-flight state nor runs the deferred check early", async () => {
    const firstLoad = deferred<TestRow>();
    const secondLoad = deferred<TestRow>();
    const recheck = deferred<TestRow>();
    const fetchLatest = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)
      .mockReturnValueOnce(recheck.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = env.result.current.loadExternalChange();
      second = env.result.current.loadExternalChange();
    });
    await act(async () => {
      firstLoad.resolve({ id: "a", version: 2 });
      await first;
    });
    act(() => {
      env.result.current.checkForExternalChange();
    });
    expect(env.fetchLatest).toHaveBeenCalledTimes(2);
    expect(env.applyLatest).not.toHaveBeenCalled();

    await act(async () => {
      secondLoad.resolve({ id: "a", version: 2 });
      await second;
    });
    expect(env.applyLatest).toHaveBeenCalledTimes(1);
    expect(env.fetchLatest).toHaveBeenCalledTimes(3);
  });

  it("supersedes a background check still in flight", async () => {
    const checkDeferred = deferred<TestRow>();
    const loadDeferred = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValueOnce(checkDeferred.promise).mockReturnValueOnce(loadDeferred.promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = env.result.current.loadExternalChange();
    });
    await act(async () => {
      loadDeferred.resolve({ id: "a", version: 6 });
      await loadPromise;
    });
    expect(env.applyLatest).toHaveBeenCalledTimes(1);
    expect(env.applyLatest).toHaveBeenCalledWith({ id: "a", version: 6 });

    await act(async () => {
      checkDeferred.resolve({ id: "a", version: 5 });
      await checkDeferred.promise;
    });
    expect(env.applyLatest).toHaveBeenCalledTimes(1);
  });
});

describe("useExternalEntryRefresh — pendingExternalVersion", () => {
  it("hides a known newer version while the loaded entry is absent", async () => {
    const fresh = deferred<TestRow>();
    const env = setup({ dirty: true, fetchLatest: () => fresh.promise });
    act(() => env.result.current.checkForExternalChange());
    await act(async () => {
      fresh.resolve({ id: "a", version: 2 });
      await fresh.promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(2);

    env.rerender({ loaded: null });
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });

  it("clears itself when loaded.version catches up", async () => {
    const { promise, resolve } = deferred<TestRow>();
    const fetchLatest = vi.fn().mockReturnValue(promise);
    const env = setup({ loaded: { id: "a", version: 1 }, dirty: true, fetchLatest });

    act(() => {
      env.result.current.checkForExternalChange();
    });
    await act(async () => {
      resolve({ id: "a", version: 2 });
      await promise;
    });
    expect(env.result.current.pendingExternalVersion).toBe(2);

    env.rerender({ loaded: { id: "a", version: 2 } });
    expect(env.result.current.pendingExternalVersion).toBeNull();
  });
});

describe("useExternalEntryRefresh — identity", () => {
  it("keeps checkForExternalChange's identity stable across renders", () => {
    const env = setup();
    const first = env.result.current.checkForExternalChange;
    env.rerender({ loaded: { id: "a", version: 1 } });
    expect(env.result.current.checkForExternalChange).toBe(first);
  });
});
