import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { FetchQueryProvider, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { expect, it, vi } from "vitest";
import { useMediaWrites, type MediaWritesDeps } from "../hooks/use-media-writes.hooks.js";

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
const keys = { list: ["media"] };
const translate = ({ locale, key }: { locale: string; key: string }) => `${locale}/${key}`;

function asset(id: string, status: AdminMedia["status"]): AdminMedia {
  return {
    id, status, workspaceId: "library", title: id, slug: id, alt: "", caption: "", credit: "",
    sha256: "f".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1, width: null, height: null, cssClass: null, htmlAttributes: null,
    contentType: "image/png", publicUrl: status === "active" ? `/m/${id}` : null,
  };
}

function gate() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { pending, release };
}

function mediaHost(initial: AdminMedia[], holds: { trash?: Promise<void>; restore?: Promise<void>; purge?: Promise<void> } = {}) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  function requireRow(id: string, status: AdminMedia["status"]): AdminMedia {
    const row = rows.get(id);
    if (row?.status !== status) throw new Error(`Expected ${id} to be ${status}`);
    return row;
  }
  const port = {
    uploadMedia: vi.fn<MediaWritesDeps["port"]["uploadMedia"]>(async (input, options) => {
      if (input.filename !== "fox.png" || input.contentType !== "image/png" || input.dataBase64 !== "iVBORw0KGgo=") throw new Error("unexpected upload payload");
      const row = { ...asset("new-fox", "active"), alt: options?.alt ?? "" };
      rows.set(row.id, row);
      return { media: row, conversionNotice: "web-copy-unavailable" };
    }),
    trashMedia: vi.fn(async (id: string) => {
      const row = requireRow(id, "active");
      await holds.trash;
      const media = { ...row, status: "trashed" as const, publicUrl: null };
      rows.set(id, media);
      return { media };
    }),
    restoreMedia: vi.fn(async (id: string) => {
      const row = requireRow(id, "trashed");
      await holds.restore;
      rows.set(id, { ...row, status: "active", publicUrl: `/m/${id}` });
      return { restored: true };
    }),
    deleteMedia: vi.fn(async (id: string) => {
      requireRow(id, "trashed");
      await holds.purge;
      return { purged: rows.delete(id) };
    }),
  } satisfies MediaWritesDeps["port"];
  return {
    port,
    active: async () => [...rows.values()].filter((row) => row.status === "active"),
    trashed: async () => [...rows.values()].filter((row) => row.status === "trashed"),
  };
}

function renderWrites(host: ReturnType<typeof mediaHost>) {
  return renderHook(() => ({
    writes: useMediaWrites({ useState, port: host.port, deps: { KEYS: keys, translate }, locale: "fr", useFetchMutation }),
    active: useFetchQuery({ key: ["media", "grid", "all"], fetch: host.active }),
    trashed: useFetchQuery({ key: ["media", "grid", "trash"], fetch: host.trashed }),
  }), { wrapper });
}

it("uploads the supplied bytes and alt text, then refreshes the active grid", async () => {
  const host = mediaHost([asset("existing", "active")]);
  const { result } = renderWrites(host);
  await waitFor(() => expect(result.current.active.data?.map(({ id }) => id)).toEqual(["existing"]));

  let notice: string | undefined;
  await act(async () => {
    const upload = await result.current.writes.uploadMutation.mutate({ input: {
      filename: "fox.png", contentType: "image/png", dataBase64: "iVBORw0KGgo=", alt: "Fox in a snowy field",
    } });
    notice = upload.conversionNotice;
  });

  expect(host.port.uploadMedia.mock.calls).toEqual([[{ filename: "fox.png", contentType: "image/png", dataBase64: "iVBORw0KGgo=" }, { alt: "Fox in a snowy field" }]]);
  expect(notice).toBe("web-copy-unavailable");
  await waitFor(() => expect(result.current.active.data?.find(({ id }) => id === "new-fox")?.alt).toBe("Fox in a snowy field"));
});

it("reports a failed trash request without dropping the active row, then moves it on retry", async () => {
  const row = asset("to-trash", "active");
  const host = mediaHost([row]);
  host.port.trashMedia.mockRejectedValueOnce(new Error("asset is in use"));
  const { result } = renderWrites(host);
  await waitFor(() => expect(result.current.active.data?.map(({ id }) => id)).toEqual(["to-trash"]));

  await act(async () => result.current.writes.trash(row));
  expect(result.current.writes.trashMutation.error?.message).toBe("asset is in use");
  expect(result.current.writes.rowSavingId).toBeNull();
  expect(result.current.active.data?.map(({ id }) => id)).toEqual(["to-trash"]);

  await act(async () => result.current.writes.trash(row));
  expect(host.port.trashMedia.mock.calls).toEqual([["to-trash"], ["to-trash"]]);
  expect(result.current.writes.trashMutation.error).toBeNull();
  await waitFor(() => {
    expect(result.current.active.data).toEqual([]);
    expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(["to-trash"]);
  });
});

it("clears only other write errors, then treats a refused restore as a localized error before a retry", async () => {
  const row = asset("to-restore", "trashed");
  const host = mediaHost([row]);
  host.port.uploadMedia.mockRejectedValueOnce(new Error("upload quota exhausted"));
  host.port.restoreMedia.mockResolvedValueOnce({ restored: false });
  const { result } = renderWrites(host);
  await waitFor(() => expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(["to-restore"]));
  await act(async () => {
    await expect(result.current.writes.uploadMutation.mutate({ input: { filename: "fox.png", contentType: "image/png", dataBase64: "iVBORw0KGgo=" } })).rejects.toThrow("upload quota exhausted");
  });
  act(() => result.current.writes.clearOtherWriteErrors(result.current.writes.uploadMutation));
  expect(result.current.writes.uploadMutation.error?.message).toBe("upload quota exhausted");

  await act(async () => result.current.writes.restore(row));
  expect(result.current.writes.restoreMutation.error?.message).toBe("fr/failed to restore");
  expect(result.current.writes.uploadMutation.error).toBeNull();
  expect(result.current.writes.rowSavingId).toBeNull();
  expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(["to-restore"]);

  await act(async () => result.current.writes.restore(row));
  expect(host.port.restoreMedia.mock.calls).toEqual([["to-restore"], ["to-restore"]]);
  expect(result.current.writes.restoreMutation.error).toBeNull();
  await waitFor(() => {
    expect(result.current.active.data?.map(({ id }) => id)).toEqual(["to-restore"]);
    expect(result.current.trashed.data).toEqual([]);
  });
});

it("requires a purge target and closes the confirmation without removing the row on failure", async () => {
  const row = asset("keep", "trashed");
  const host = mediaHost([row]);
  host.port.deleteMedia.mockRejectedValueOnce(new Error("storage is unavailable"));
  const { result } = renderWrites(host);
  await waitFor(() => expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(["keep"]));

  await act(async () => result.current.writes.purge());
  expect(host.port.deleteMedia.mock.calls).toEqual([]);
  act(() => result.current.writes.setPendingPurge(row));
  expect(result.current.writes.pendingPurge?.id).toBe("keep");
  await act(async () => result.current.writes.purge());

  expect(host.port.deleteMedia.mock.calls).toEqual([["keep"]]);
  expect(result.current.writes.purgeMutation.error?.message).toBe("storage is unavailable");
  expect(result.current.writes.pendingPurge).toBeNull();
  expect(result.current.writes.rowSavingId).toBeNull();
  expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(["keep"]);
});

it.each([
  { action: "trash" as const, initialStatus: "active" as const, initialTrash: ["deleting"], duringPurge: ["moving", "deleting"], finalTrash: ["moving"] },
  { action: "restore" as const, initialStatus: "trashed" as const, initialTrash: ["moving", "deleting"], duringPurge: ["deleting"], finalTrash: [] },
])("keeps the purge row busy when a different in-flight $action finishes first", async ({ action, initialStatus, initialTrash, duringPurge, finalTrash }) => {
  const moving = asset("moving", initialStatus);
  const deleting = asset("deleting", "trashed");
  const move = gate();
  const purge = gate();
  const host = mediaHost([moving, deleting], { [action]: move.pending, purge: purge.pending });
  const { result } = renderWrites(host);
  await waitFor(() => expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(initialTrash));

  let moved!: Promise<void>;
  act(() => { moved = result.current.writes[action](moving); });
  expect(result.current.writes.rowSavingId).toBe("moving");
  act(() => result.current.writes.setPendingPurge(deleting));
  let deleted!: Promise<void>;
  act(() => { deleted = result.current.writes.purge(); });
  expect(result.current.writes.rowSavingId).toBe("deleting");
  await waitFor(() => expect(host.port.deleteMedia.mock.calls).toEqual([["deleting"]]));

  await act(async () => { move.release(); await moved; });
  expect(result.current.writes.rowSavingId).toBe("deleting");
  expect(result.current.writes.pendingPurge?.id).toBe("deleting");
  await waitFor(() => expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(duringPurge));

  await act(async () => { purge.release(); await deleted; });
  expect(result.current.writes.rowSavingId).toBeNull();
  expect(result.current.writes.pendingPurge).toBeNull();
  await waitFor(() => expect(result.current.trashed.data?.map(({ id }) => id)).toEqual(finalTrash));
});
