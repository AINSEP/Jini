// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminTrashItemDto, AdminTrashPageDto, AdminTrashPurgeReportDto, AdminTrashRestoreReportDto } from "@jini-ai/core/contracts/site/cms-trash";
import type { AdminIdentityUser } from "@jini-ai/core/contracts/site/user-management-react";

import { publishContentRefresh, resetContentRefreshBus } from "../../../shell/lib/content-refresh-bus.js";
import { useTrash, type TrashDependencies } from "../hooks/use-trash.hooks.js";
import type { TrashPort } from "../hooks/trash-port.hooks.js";

afterEach(() => resetContentRefreshBus());

const row = (id: string): AdminTrashItemDto => ({
  id, entityType: "post", entityId: `e-${id}`, title: `Title ${id}`, subtitle: null,
  trashedAt: "2026-11-25T00:00:00.000Z", purgeAfter: "2026-12-25T00:00:00.000Z",
  daysRemaining: 30, actorPrincipalId: "user-1", actorPluginId: null,
});

const page = (ids: string[], nextCursor: string | null = null): AdminTrashPageDto => ({ items: ids.map(row), nextCursor, retentionDays: 30 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A scripted port: each `listTrash` call takes the next queued answer for its cursor key ("" = page 1). */
function fakePort(script: {
  pages: Record<string, Array<AdminTrashPageDto | Error | Promise<AdminTrashPageDto>>>;
  restore?: AdminTrashRestoreReportDto | Error;
  purge?: AdminTrashPurgeReportDto | Error;
  users?: { users: AdminIdentityUser[] } | Error;
}) {
  const listCalls: Array<{ cursor?: string }> = [];
  const restoreCalls: unknown[] = [];
  const purgeCalls: unknown[] = [];
  const port: TrashPort = {
    listTrash: async (options) => {
      listCalls.push(options);
      const queue = script.pages[options.cursor ?? ""] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      if (!next) throw new Error(`no page scripted for ${options.cursor ?? "page 1"}`);
      return next;
    },
    restoreTrashItems: async (input) => {
      restoreCalls.push(input);
      if (script.restore instanceof Error) throw script.restore;
      return script.restore ?? { restored: 0, results: [] };
    },
    purgeTrashItems: async (input) => {
      purgeCalls.push(input);
      if (script.purge instanceof Error) throw script.purge;
      return script.purge ?? { purged: 0, results: [] };
    },
  };
  if (script.users) {
    const users = script.users;
    port.listUsers = async () => {
      if (users instanceof Error) throw users;
      return users;
    };
  }
  return { port, listCalls, restoreCalls, purgeCalls };
}

function deps(port: TrashPort): TrashDependencies {
  return {
    port,
    locale: "fr",
    t: ({ locale, key }) => `${locale}:${key}`,
    describeLoadError: ({ error, locale }) => `load(${locale}): ${(error as Error).message}`,
    describeApiError: ({ e, fallback }) => `api: ${(e as Error).message} | ${fallback}`,
  };
}

async function mounted(port: TrashPort) {
  const hook = renderHook(() => useTrash(deps(port)));
  await waitFor(() => expect(hook.result.current.items).not.toBeNull());
  return hook;
}

describe("useTrash", () => {
  it("loads page 1, reports retention and the cursor, and exposes the injected locale and translator", async () => {
    const { port, listCalls } = fakePort({ pages: { "": [page(["a", "b"], "c2")] } });
    const { result } = await mounted(port);

    expect(result.current.items?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.current.retentionDays).toBe(30);
    expect(result.current.nextCursor).toBe("c2");
    expect(result.current.error).toBeNull();
    expect(result.current.locale).toBe("fr");
    expect(result.current.t({ locale: "de", key: "k" })).toBe("de:k");
    expect(listCalls[0]).toEqual({});
    // No listUsers on the port: the lookup stays disabled and the map empty.
    expect(result.current.actorUsernames.size).toBe(0);
  });

  it("describes a first-page failure through the host's load-error describer", async () => {
    const { port } = fakePort({ pages: { "": [new Error("offline")] } });
    const { result } = renderHook(() => useTrash(deps(port)));

    await waitFor(() => expect(result.current.error).toBe("load(fr): offline"));
    expect(result.current.items).toBeNull();
    expect(result.current.retentionDays).toBeNull();
  });

  it("resolves actor usernames from listUsers, and degrades to an empty map when that call fails", async () => {
    const ok = fakePort({ pages: { "": [page(["a"])] }, users: { users: [{ principalId: "user-1", username: "jo" } as AdminIdentityUser] } });
    const first = await mounted(ok.port);
    await waitFor(() => expect(first.result.current.actorUsernames.get("user-1")).toBe("jo"));

    const failing = fakePort({ pages: { "": [page(["a"])] }, users: new Error("403") });
    const second = await mounted(failing.port);
    expect(second.result.current.actorUsernames.size).toBe(0);
    expect(second.result.current.error).toBeNull();
  });

  it("appends the next page on loadMore and stops when there is no cursor left", async () => {
    const { port, listCalls } = fakePort({ pages: { "": [page(["a"], "c2")], c2: [page(["b"], null)] } });
    const { result } = await mounted(port);

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.loadingMore).toBe(false);
    expect(listCalls).toContainEqual({ cursor: "c2" });

    const before = listCalls.length;
    await act(async () => { await result.current.loadMore(); });
    expect(listCalls.length).toBe(before);
  });

  it("sends only one request for a same-tick double loadMore", async () => {
    const gate = deferred<AdminTrashPageDto>();
    const { port, listCalls } = fakePort({ pages: { "": [page(["a"], "c2")], c2: [gate.promise] } });
    const { result } = await mounted(port);

    let first!: Promise<void>;
    act(() => {
      first = Promise.resolve(result.current.loadMore());
      void result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    await act(async () => { gate.resolve(page(["b"])); await first; });
    expect(listCalls.filter((call) => call.cursor === "c2")).toHaveLength(1);
    expect(result.current.items?.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("reports a failed loadMore through the load-error describer", async () => {
    const { port } = fakePort({ pages: { "": [page(["a"], "c2")], c2: [new Error("timeout")] } });
    const { result } = await mounted(port);

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.error).toBe("load(fr): timeout");
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.items?.map((item) => item.id)).toEqual(["a"]);
  });

  it("drops a loadMore page that lands after a refresh superseded it", async () => {
    const gate = deferred<AdminTrashPageDto>();
    const { port } = fakePort({ pages: { "": [page(["a"], "c2"), page(["fresh"], null)], c2: [gate.promise] } });
    const { result } = await mounted(port);

    let pending!: Promise<void>;
    act(() => { pending = Promise.resolve(result.current.loadMore()); });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["fresh"]));
    await act(async () => { gate.resolve(page(["stale"])); await pending; });
    expect(result.current.items?.map((item) => item.id)).toEqual(["fresh"]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("drops a superseded loadMore failure instead of surfacing it", async () => {
    const gate = deferred<AdminTrashPageDto>();
    const { port } = fakePort({ pages: { "": [page(["a"], "c2"), page(["fresh"], null)], c2: [gate.promise] } });
    const { result } = await mounted(port);

    let pending!: Promise<void>;
    act(() => { pending = Promise.resolve(result.current.loadMore()); });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["fresh"]));
    await act(async () => { gate.reject(new Error("late")); await pending; });
    expect(result.current.error).toBeNull();
  });

  it("toggles single rows and select-all over the visible rows", async () => {
    const { port } = fakePort({ pages: { "": [page(["a", "b"])] } });
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    expect([...result.current.selected]).toEqual(["a"]);
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggleAll());
    expect([...result.current.selected].sort()).toEqual(["a", "b"]);
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.selected.size).toBe(0);
    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("b"));
    expect(result.current.selected.size).toBe(0);
  });

  it("restores the selected rows by entity identity, reports the outcome, clears the selection and refetches page 1", async () => {
    const { port, restoreCalls, listCalls } = fakePort({
      pages: { "": [page(["a", "b"]), page(["b"])] },
      restore: { restored: 1, results: [{ entityType: "post", entityId: "e-a", outcome: "restored" }] },
    });
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    await act(async () => { await result.current.onRestoreSelected(); });
    expect(restoreCalls).toEqual([{ items: [{ entityType: "post", entityId: "e-a" }] }]);
    expect(result.current.notice).toBe("fr:Restored.");
    expect(result.current.selected.size).toBe(0);
    expect(result.current.busy).toBe(false);
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["b"]));
    expect(listCalls.filter((call) => call.cursor === undefined).length).toBeGreaterThanOrEqual(2);
  });

  it("does nothing on restore or purge when nothing is selected", async () => {
    const { port, restoreCalls, purgeCalls } = fakePort({ pages: { "": [page(["a"])] } });
    const { result } = await mounted(port);

    await act(async () => { await result.current.onRestoreSelected(); await result.current.onPurgeConfirmed(); });
    expect(restoreCalls).toEqual([]);
    expect(purgeCalls).toEqual([]);
    expect(result.current.notice).toBeNull();
  });

  it("ignores a second restore while the first is still busy", async () => {
    const gate = deferred<AdminTrashRestoreReportDto>();
    const { port } = fakePort({ pages: { "": [page(["a"])] } });
    const restoreCalls: unknown[] = [];
    port.restoreTrashItems = (input) => { restoreCalls.push(input); return gate.promise; };
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    let first!: Promise<void>;
    act(() => { first = result.current.onRestoreSelected(); });
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.onRestoreSelected(); await result.current.onPurgeConfirmed(); });
    await act(async () => { gate.resolve({ restored: 1, results: [{ entityType: "post", entityId: "e-a", outcome: "restored" }] }); await first; });
    expect(restoreCalls).toHaveLength(1);
    expect(result.current.busy).toBe(false);
  });

  it("describes a failed restore with the translated fallback and keeps the selection", async () => {
    const { port } = fakePort({ pages: { "": [page(["a"])] }, restore: new Error("boom") });
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    await act(async () => { await result.current.onRestoreSelected(); });
    expect(result.current.error).toBe("api: boom | fr:failed to restore");
    expect([...result.current.selected]).toEqual(["a"]);
    expect(result.current.busy).toBe(false);
  });

  it("purges the selected rows by trash id, closes the confirm and notes still-referenced items", async () => {
    const { port, purgeCalls } = fakePort({
      pages: { "": [page(["a", "b"]), page([])] },
      purge: { purged: 1, results: [{ id: "a", outcome: "purged" }, { id: "b", outcome: "still-referenced" }] },
    });
    const { result } = await mounted(port);

    act(() => result.current.toggleAll());
    act(() => result.current.setPurgeConfirmOpen(true));
    expect(result.current.purgeConfirmOpen).toBe(true);
    await act(async () => { await result.current.onPurgeConfirmed(); });
    expect(purgeCalls).toEqual([{ ids: ["a", "b"] }]);
    expect(result.current.notice).toBe("fr:Deleted permanently. 1/2 fr:Items still in use were not deleted.");
    expect(result.current.purgeConfirmOpen).toBe(false);
    expect(result.current.selected.size).toBe(0);
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it("describes a failed purge with the translated fallback and leaves the confirm open", async () => {
    const { port } = fakePort({ pages: { "": [page(["a"])] }, purge: new Error("nope") });
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    act(() => result.current.setPurgeConfirmOpen(true));
    await act(async () => { await result.current.onPurgeConfirmed(); });
    expect(result.current.error).toBe("api: nope | fr:failed to delete permanently");
    expect(result.current.purgeConfirmOpen).toBe(true);
  });

  it("refetches on a trash content-refresh and prunes selected rows that left the page", async () => {
    const { port } = fakePort({ pages: { "": [page(["a", "b"]), page(["b"])] } });
    const { result } = await mounted(port);

    act(() => result.current.toggleAll());
    act(() => publishContentRefresh({ resources: ["trash"] }));
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["b"]));
    expect([...result.current.selected]).toEqual(["b"]);
  });

  it("prunes the whole selection when a refresh empties the page", async () => {
    const { port } = fakePort({ pages: { "": [page(["a"]), page([])] } });
    const { result } = await mounted(port);

    act(() => result.current.toggle("a"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.selected.size).toBe(0);
    expect(result.current.allSelected).toBe(false);
  });

  it("treats select-all, restore and purge before the first page lands as acting on no rows", async () => {
    const first = deferred<AdminTrashPageDto>();
    const { port, restoreCalls, purgeCalls } = fakePort({ pages: { "": [first.promise] } });
    const { result } = renderHook(() => useTrash(deps(port)));
    expect(result.current.items).toBeNull();
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggleAll());
    expect(result.current.selected.size).toBe(0);
    act(() => result.current.toggle("a"));
    await act(async () => { await result.current.onRestoreSelected(); await result.current.onPurgeConfirmed(); });
    expect(restoreCalls).toEqual([]);
    expect(purgeCalls).toEqual([]);
    expect(result.current.busy).toBe(false);

    await act(async () => { first.resolve(page(["a"])); await first.promise; });
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["a"]));
  });
});

