// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { expect, it, vi } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { useLibrary } from "../hooks/use-library.hooks.js";
import type { LibraryPort } from "../hooks/library-port.hooks.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
const documentRow = (id: string, ext = "md", overrides: Partial<AdminMedia> = {}): AdminMedia => ({
  id, workspaceId: "ws", title: id, slug: id, originalFilename: `${id}.${ext}`, alt: "", caption: "", credit: "",
  sha256: `sha-${id}`, status: "active", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  version: 1, width: null, height: null, cssClass: null, htmlAttributes: null, contentType: null, publicUrl: null,
  ...overrides,
});
const guides = documentRow("Guides");
const notes = documentRow("Notes", "txt", { createdAt: "2026-10-03T00:00:00Z" });

function setup(options: { users?: boolean; port?: Partial<LibraryPort>; maxUploadBytes?: number } = {}) {
  const store = new Map([guides, notes].map((row) => [row.id, row]));
  const locate = (id: string) => {
    const row = store.get(id);
    if (!row) throw new Error(`Unknown document: ${id}`);
    return row;
  };
  const list = vi.fn(async () => ({ media: [...store.values()].filter(({ status }) => status === "active") }));
  const upload = vi.fn<LibraryPort["uploadDocument"]>(async ({ filename, dataBase64 }) => {
    if (!dataBase64) throw new Error("missing file bytes");
    const row = documentRow(filename, "txt", { originalFilename: filename });
    store.set(row.id, row);
    return { media: row };
  });
  const rename = vi.fn<LibraryPort["renameDocument"]>(async ({ target: { id }, input: { title } }) => {
    const row = { ...locate(id), title };
    store.set(id, row);
    return { media: row };
  });
  const trash = vi.fn<LibraryPort["trashDocument"]>(async ({ id }) => {
    const row = { ...locate(id), status: "trashed" as const };
    store.set(id, row);
    return { media: row };
  });
  const readDocumentText = vi.fn<LibraryPort["readDocumentText"]>(async ({ id }) => {
    locate(id);
    return id === "Guides" ? { text: "# Guides", truncated: true } : { text: "Plain notes <b>", truncated: false };
  });
  const port: LibraryPort = {
    listDocuments: list, uploadDocument: upload, renameDocument: rename, trashDocument: trash, readDocumentText,
    documentDownloadUrl: ({ id }) => `/private/documents/${encodeURIComponent(id)}`,
    fetchDocumentBlob: async ({ id }) => { throw new Error(`Unexpected PDF read: ${id}`); },
    me: async () => ({ effectivePermissions: ["media.upload", "media.delete"] }),
    ...(options.users ? { listUsers: async () => ({ users: [{ principalId: "key-1", username: "Sam" }] }) } : {}),
    ...options.port,
  };
  const t = (key: string) => key;
  const readFileAsBase64 = vi.fn(async ({ file }: { file: File }) => file.name === "good.txt" ? "Z29vZA==" : "bmV4dA==");
  const renderMarkdownToSafeHtml = vi.fn((markdown: string) => {
    if (markdown !== "# Guides") throw new Error(`Unexpected Markdown: ${markdown}`);
    return "<h1>Guides</h1>";
  });
  const subscription = vi.fn<Parameters<typeof useLibrary>[0]["useContentRefreshSubscription"]>();
  const mounted = renderHook(() => useLibrary({
    port, locale: "en", t, renderMarkdownToSafeHtml, useContentRefreshSubscription: subscription,
    describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
    readFileAsBase64, ...(options.maxUploadBytes === undefined ? {} : { maxUploadBytes: options.maxUploadBytes }),
  }));
  return { ...mounted, store, list, upload, rename, trash, readDocumentText, readFileAsBase64, renderMarkdownToSafeHtml, subscription };
}

it("publishes permissions only after identity loads and refreshes the sorted document list on media notifications", async () => {
  const identity = deferred<{ effectivePermissions: string[] }>();
  const { result, store, subscription } = setup({ users: true, port: { me: () => identity.promise } });
  expect(result.current.permissions).toEqual({ known: false, canUpload: false, canRename: false, canTrash: false });
  await act(async () => identity.resolve({ effectivePermissions: ["media.upload", "media.delete"] }));
  await waitFor(() => expect(result.current.documents?.map(({ id }) => id)).toEqual(["Notes", "Guides"]));
  expect(result.current.permissions).toEqual({ known: true, canUpload: true, canRename: false, canTrash: true });
  await waitFor(() => expect([...result.current.userNames]).toEqual([["key-1", "Sam"]]));
  expect(result.current.downloadUrl({ item: documentRow("letter / 2") })).toBe("/private/documents/letter%20%2F%202");
  store.set("new", documentRow("new", "txt", { createdAt: "2026-10-04T00:00:00Z" }));
  const listener = subscription.mock.lastCall?.[0];
  expect(listener?.resource).toBe("media");
  act(() => listener?.onRefresh());
  await waitFor(() => expect(result.current.documents?.map(({ id }) => id)).toEqual(["new", "Notes", "Guides"]));
});

it("surfaces the list failure and does not invent permissions or user names when absent", async () => {
  const { result } = setup({ port: {
    listDocuments: async () => { throw "network offline"; },
    me: async () => ({}),
  } });
  await waitFor(() => expect(result.current.listError).toBe("network offline"));
  expect(result.current.documents).toBeUndefined();
  expect(result.current.permissions).toEqual({ known: false, canUpload: false, canRename: false, canTrash: false });
  expect([...result.current.userNames]).toEqual([]);
});

it("validates each picked file, drains one at a time across additions, and survives a failed upload", async () => {
  const { result, upload, readFileAsBase64 } = setup({ maxUploadBytes: 4 });
  await waitFor(() => expect(result.current.documents).toEqual([notes, guides]));
  const first = deferred<{ media: AdminMedia }>();
  upload.mockImplementationOnce(() => first.promise);
  const good = new File(["good"], "good.txt");
  const second = new File(["next"], "next.txt");
  const wrong = new File(["x"], "hero.png");
  const empty = new File([], "empty.txt");
  const folder = new File([], "report.pages");
  const large = new File(["12345"], "large.md");
  await act(async () => result.current.addFiles([good, wrong, empty, folder, large]));
  expect(result.current.uploads.map(({ name, status, error }) => [name, status, error])).toEqual([
    ["good.txt", "uploading", null],
    ["hero.png", "failed", "This file type isn't supported."],
    ["empty.txt", "failed", "This file is empty."],
    ["report.pages", "failed", "Folder package: in Pages/Keynote, save as a single file, then upload again."],
    ["large.md", "failed", "That file is 5 bytes; the limit is 4 bytes."],
  ]);
  await act(async () => result.current.addFiles([second]));
  expect(result.current.uploads.find(({ name }) => name === "next.txt")?.status).toBe("waiting");
  expect(upload.mock.calls).toEqual([[{ filename: "good.txt", dataBase64: "Z29vZA==" }]]);
  act(() => result.current.clearUploads());
  expect(result.current.uploads.map(({ name }) => name)).toEqual(["next.txt", "good.txt"]);
  await act(async () => first.reject(new Error("First upload timed out")));
  await waitFor(() => expect(result.current.documents?.some(({ id }) => id === "next.txt")).toBe(true));
  expect(result.current.uploads.map(({ name, status, error }) => [name, status, error])).toEqual([
    ["next.txt", "done", null], ["good.txt", "failed", "First upload timed out"],
  ]);
  expect(upload.mock.calls).toEqual([
    [{ filename: "good.txt", dataBase64: "Z29vZA==" }], [{ filename: "next.txt", dataBase64: "bmV4dA==" }],
  ]);
  expect(readFileAsBase64.mock.calls).toEqual([[{ file: good }], [{ file: second }]]);
  expect(result.current.uploadedCount).toBe(1);
  act(() => result.current.clearUploads());
  expect(result.current.uploads).toEqual([]);
  expect(result.current.uploadedCount).toBe(0);
});

it("does not upload unreadable files and can start another drain after that failure", async () => {
  const { result, upload, readFileAsBase64 } = setup();
  const unreadable = new File(["a"], "locked.txt");
  readFileAsBase64.mockRejectedValueOnce(new Error("File read was denied"));
  await act(async () => result.current.addFiles([unreadable]));
  expect(result.current.uploads.map(({ name, status, error }) => [name, status, error]))
    .toEqual([["locked.txt", "failed", "File read was denied"]]);
  expect(upload.mock.calls).toEqual([]);
  await act(async () => result.current.addFiles([new File(["next"], "next.txt")]));
  await waitFor(() => expect(result.current.documents?.some(({ id }) => id === "next.txt")).toBe(true));
  expect(result.current.uploadedCount).toBe(1);
});

it("renames only a valid trimmed stem, ignores another submit while busy, and leaves failed edits available to retry", async () => {
  const { result, rename } = setup();
  await waitFor(() => expect(result.current.documents?.map(({ title }) => title)).toEqual(["Notes", "Guides"]));
  await act(() => result.current.rename.save());
  act(() => result.current.rename.start(guides));
  expect(result.current.rename.draft).toBe("Guides");
  act(() => result.current.rename.setDraft("folder/name"));
  expect(result.current.rename.invalid).toBe(true);
  await act(() => result.current.rename.save());
  expect(rename.mock.calls).toEqual([]);
  act(() => result.current.rename.setDraft("  New stem  "));
  const failed = deferred<{ media: AdminMedia }>();
  rename.mockImplementationOnce(() => failed.promise);
  let settling!: Promise<void>;
  act(() => { settling = result.current.rename.save(); });
  expect(result.current.rename.saving).toBe(true);
  await act(() => result.current.rename.save());
  expect(rename.mock.calls).toEqual([[{ target: { id: "Guides" }, input: { title: "New stem" } }]]);
  await act(async () => { failed.reject(new Error("Title already in use")); await settling; });
  expect(result.current.rowError).toBe("Title already in use");
  expect(result.current.rename.editingId).toBe("Guides");
  expect(result.current.rename.draft).toBe("  New stem  ");
  await act(() => result.current.rename.save());
  await waitFor(() => expect(result.current.documents?.find(({ id }) => id === "Guides")?.title).toBe("New stem"));
  expect(result.current.documents?.find(({ id }) => id === "Guides")?.originalFilename).toBe("Guides.md");
  expect(result.current.rowError).toBeNull();
  expect(result.current.rename.editingId).toBeNull();
  act(() => result.current.rename.start(notes));
  act(() => result.current.rename.cancel());
  expect(result.current.rename.editingId).toBeNull();
});

it("keeps an unrelated preview while trashing, blocks a second trash while pending, and closes the matching preview after retry", async () => {
  const { result, store, trash } = setup();
  const reply = deferred<{ media: AdminMedia }>();
  const removeNotes = trash.getMockImplementation()!;
  trash.mockImplementationOnce(async (target) => { await reply.promise; return removeNotes(target); });
  await act(async () => result.current.openPreview(guides));
  expect(result.current.preview?.item.id).toBe("Guides");
  let settling!: Promise<void>;
  act(() => { settling = result.current.trash(notes); });
  expect(result.current.trashingId).toBe("Notes");
  await act(() => result.current.trash(guides));
  expect(trash.mock.calls).toEqual([[{ id: "Notes" }]]);
  await act(async () => { reply.resolve({ media: notes }); await settling; });
  await waitFor(() => expect(result.current.documents?.map(({ id }) => id)).toEqual(["Guides"]));
  expect(result.current.preview?.item.id).toBe("Guides");
  expect(result.current.notice).toBe("Moved to Trash.");
  act(() => result.current.dismissNotice());
  expect(result.current.notice).toBeNull();
  trash.mockRejectedValueOnce(new Error("Trash service offline"));
  await act(() => result.current.trash(guides));
  expect(result.current.rowError).toBe("Trash service offline");
  expect(result.current.trashingId).toBeNull();
  expect(result.current.preview?.item.id).toBe("Guides");
  await act(() => result.current.trash(guides));
  await waitFor(() => expect(result.current.documents).toEqual([]));
  expect(store.get("Guides")?.status).toBe("trashed");
  expect(result.current.preview).toBeNull();
  expect(result.current.notice).toBe("Moved to Trash.");
});

it("renders Markdown and plain source via distinct paths, avoids fetching Office documents, and reports preview errors", async () => {
  const { result, readDocumentText, renderMarkdownToSafeHtml } = setup();
  await act(async () => result.current.openPreview(guides));
  expect(result.current.preview).toMatchObject({ kind: "markdown", text: null, html: "<h1>Guides</h1>", loading: false, truncated: true, error: null });
  expect(renderMarkdownToSafeHtml.mock.calls).toEqual([["# Guides"]]);
  await act(async () => result.current.openPreview(notes));
  expect(result.current.preview).toMatchObject({ kind: "text", text: "Plain notes <b>", html: null, loading: false, truncated: false });
  act(() => result.current.openPreview(documentRow("Sheet", "xlsx")));
  expect(result.current.preview).toMatchObject({ kind: "download", loading: false, text: null, html: null, pdfUrl: null });
  expect(readDocumentText.mock.calls).toEqual([[{ id: "Guides" }], [{ id: "Notes" }]]);
  readDocumentText.mockRejectedValueOnce(new Error("Document read refused"));
  await act(async () => result.current.openPreview(notes));
  expect(result.current.preview).toMatchObject({ item: notes, loading: false, error: "Document read refused", text: null });
});

it("does not let an older or closed text preview take over the active document", async () => {
  const { result, readDocumentText } = setup();
  const first = deferred<{ text: string; truncated: boolean }>();
  const second = deferred<{ text: string; truncated: boolean }>();
  readDocumentText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  act(() => result.current.openPreview(guides));
  expect(result.current.preview).toMatchObject({ item: guides, loading: true });
  act(() => result.current.openPreview(notes));
  await act(async () => second.resolve({ text: "Newest", truncated: false }));
  expect(result.current.preview).toMatchObject({ item: notes, text: "Newest", loading: false });
  await act(async () => first.reject(new Error("Stale failure")));
  expect(result.current.preview).toMatchObject({ item: notes, text: "Newest", error: null });
  const closed = deferred<{ text: string; truncated: boolean }>();
  readDocumentText.mockReturnValueOnce(closed.promise);
  act(() => result.current.openPreview(notes));
  expect(result.current.preview?.loading).toBe(true);
  act(() => result.current.closePreview());
  await act(async () => closed.resolve({ text: "Too late", truncated: false }));
  expect(result.current.preview).toBeNull();
});

it("creates PDF-typed object URLs only for the current preview and revokes the live URL when replaced", async () => {
  const pending = deferred<Blob>();
  const pdf = documentRow("Brief", "pdf");
  const old = documentRow("Old", "pdf");
  const fetchDocumentBlob = vi.fn<LibraryPort["fetchDocumentBlob"]>()
    .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new Blob(["pdf bytes"]));
  const create = vi.fn((_blob: Blob) => "blob:preview-1");
  const revoke = vi.fn<(_: string) => void>();
  const original = { create: Object.getOwnPropertyDescriptor(URL, "createObjectURL"), revoke: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL") };
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  try {
    const { result, unmount } = setup({ port: { fetchDocumentBlob } });
    act(() => result.current.openPreview(old));
    await act(async () => result.current.openPreview(pdf));
    expect(fetchDocumentBlob.mock.calls).toEqual([[{ id: "Old" }], [{ id: "Brief" }]]);
    expect(result.current.preview).toMatchObject({ item: pdf, kind: "pdf", pdfUrl: "blob:preview-1", loading: false });
    expect(create.mock.calls.map(([blob]) => [blob.type, blob.size])).toEqual([["application/pdf", 9]]);
    await act(async () => pending.resolve(new Blob(["older"])));
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.preview?.item.id).toBe("Brief");
    expect(revoke.mock.calls).toEqual([]);
    await act(async () => result.current.openPreview(notes));
    expect(result.current.preview).toMatchObject({ item: notes, kind: "text", pdfUrl: null });
    expect(revoke.mock.calls).toEqual([["blob:preview-1"]]);
    unmount();
  } finally {
    if (original.create) Object.defineProperty(URL, "createObjectURL", original.create);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (original.revoke) Object.defineProperty(URL, "revokeObjectURL", original.revoke);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});
