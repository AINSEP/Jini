// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bindMedia, type MediaDependencies } from "../hooks/use-media.hooks.js";
import { readFileAsBase64 } from "../rules.js";
import { FetchQueryProvider, useFetchMutation, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { useMediaWrites } from "@jini-ai/cms/react/media/hooks/use-media-writes.hooks";
import { createFakeMediaPort } from "../hooks/fake-media-port.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("An oversized video never reaches FileReader.", async () => {
  const cap = 192 * 1024 * 1024;
  const mutate = vi.fn(async () => ({ media: {} }));
  const mutation = { error: null, reset: vi.fn(), mutate };
  const hooks = {
    useLocaleHook: () => "en", useInvalidate: () => vi.fn(), useContentRefreshSubscription: vi.fn(),
    useGridPages: () => ({ items: [], error: null, exactItem: null }),
    useMediaWrites: () => ({ uploadMutation: mutation, trashMutation: mutation, purgeMutation: mutation,
      restoreMutation: mutation, clearOtherWriteErrors: vi.fn() }),
  } as unknown as MediaDependencies["hooks"] & { useLocaleHook: () => string };
  const useBoundMedia = bindMedia({ hooks, deps: {
    port: {} as MediaDependencies["port"], maxJsonUploadBytes: cap, readFileAsBase64,
    translate: ({ key }) => key, describeApiError: () => "upload failed", sizeRefusalFromError: () => null,
  } });
  const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:video/quicktime;base64,cGl4ZWw=" });
    this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
  });
  const { result } = renderHook(() => useBoundMedia({ tab: "all" }));
  const file = new File(["pixel"], "clip.mov", { type: "" });
  Object.defineProperty(file, "size", { value: cap + 1, configurable: true });
  const input = document.createElement("input");
  Object.defineProperty(input, "files", { value: [file] });
  result.current.fileInputRef.current = input;
  act(() => result.current.openUpload({ currentTarget: document.createElement("button") }));
  await act(async () => { await result.current.upload(); });
  expect(read).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
  expect(result.current.uploadError).toContain("192 MiB");
  expect(result.current.uploadOpen).toBe(true);
  expect(result.current.uploading).toBe(false);
  Object.defineProperty(file, "size", { value: cap });
  await act(async () => { await result.current.upload(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ input: {
    filename: "clip.mov", contentType: "", dataBase64: "cGl4ZWw=", alt: undefined,
  } });
  expect(result.current.uploadError).toBeNull();
  expect(result.current.uploading).toBe(false);
});

function mediaHookSetup() {
  const store = createFakeMediaPort();
  const uploadMedia = vi.fn(store.uploadMedia);
  const port = { ...store, uploadMedia, listMediaGrid: vi.fn<MediaDependencies["port"]["listMediaGrid"]>() };
  const readFileAsBase64 = vi.fn(async (_required: { file: File }) => "YXNzZXQ=");
  const sizeRefusalFromError = vi.fn<MediaDependencies["deps"]["sizeRefusalFromError"]>(() => null);
  const list: ReturnType<MediaDependencies["hooks"]["useGridPages"]> = {
    items: [], exactItem: null, counts: { all: 4, images: 3, videos: 1, trash: 2 }, retentionDays: 30,
    hasUntypedActive: false, error: null, hasMore: true, loadingMore: false, loadMoreError: new Error("Grid page unavailable"),
    loadMore: vi.fn(async () => {}), retryLoadMore: vi.fn(async () => {}),
  };
  const useBoundMedia = bindMedia({
    hooks: {
      useFetchMutation, useFetchQuery, useInvalidate, useMediaWrites,
      useLocaleHook: () => "en", useGridPages: () => list,
      useContentRefreshSubscription: () => {},
    },
    deps: { port, readFileAsBase64, sizeRefusalFromError, maxJsonUploadBytes: 1024,
      translate: ({ key }) => key, describeApiError: ({ fallback, e }) => e instanceof Error ? e.message : fallback },
  });
  const mounted = renderHook(() => useBoundMedia({ tab: "all" }), { wrapper: FetchQueryProvider });
  return { ...mounted, store, uploadMedia, readFileAsBase64, sizeRefusalFromError };
}

it("ignores fileless submits, keeps the file and alt through Cancel, and reports a conversion notice on success", async () => {
  const { result, store, uploadMedia, readFileAsBase64 } = mediaHookSetup();
  const opener = document.createElement("button");
  document.body.append(opener);
  try {
    act(() => result.current.openUpload({ currentTarget: opener }));
    expect(opener).toHaveFocus();
    expect(result.current.uploadOpen).toBe(true);
    const prevented = vi.fn();
    await act(() => result.current.upload({ preventDefault: prevented }));
    expect(prevented.mock.calls).toEqual([[]]);
    expect(readFileAsBase64.mock.calls).toEqual([]);
    expect(uploadMedia.mock.calls).toEqual([]);
    expect(result.current.uploadOpen).toBe(true);
    const file = new File(["asset"], "walk.webm", { type: "video/webm" });
    const input = document.createElement("input");
    input.type = "file";
    Object.defineProperty(input, "files", { value: [file] });
    result.current.fileInputRef.current = input;
    act(() => {
      result.current.onFileChange({ currentTarget: input } as React.ChangeEvent<HTMLInputElement>);
      result.current.setAltDraft("  Walking tour  ");
    });
    act(() => result.current.closeUpload());
    expect(result.current.uploadOpen).toBe(false);
    act(() => result.current.openUpload({ currentTarget: opener }));
    expect(result.current.selectedFileName).toBe("walk.webm");
    expect(result.current.altDraft).toBe("  Walking tour  ");
    expect(result.current.canUpload).toBe(true);
    const uploadToStore = uploadMedia.getMockImplementation()!;
    uploadMedia.mockImplementationOnce(async (target, options) => ({
      ...await uploadToStore(target, options), conversionNotice: "web-copy-unavailable",
    }));
    await act(() => result.current.upload());
    expect(uploadMedia.mock.calls).toEqual([[{ filename: "walk.webm", contentType: "video/webm", dataBase64: "YXNzZXQ=" }, { alt: "Walking tour" }]]);
    expect((await store.listMedia()).media.map(({ alt, contentType }) => [alt, contentType])).toEqual([["Walking tour", "video/webm"]]);
    expect(result.current.conversionNotice).toBe("web-copy-unavailable");
    expect(result.current.uploadOpen).toBe(false);
    expect(result.current.selectedFileName).toBe("");
    expect(result.current.altDraft).toBe("");
    expect(result.current.canUpload).toBe(false);
  } finally {
    opener.remove();
  }
});

it("keeps failed reads and typed server size refusals in the upload dialog while preserving the grid", async () => {
  const { result, readFileAsBase64, uploadMedia, sizeRefusalFromError } = mediaHookSetup();
  const file = new File(["asset"], "cover.png", { type: "image/png" });
  const input = document.createElement("input");
  Object.defineProperty(input, "files", { value: [file] });
  result.current.fileInputRef.current = input;
  act(() => result.current.openUpload({ currentTarget: document.createElement("button") }));
  readFileAsBase64.mockRejectedValueOnce(new Error("File could not be read"));
  await act(() => result.current.upload());
  expect(result.current.uploadError).toBe("File could not be read");
  expect(uploadMedia.mock.calls).toEqual([]);
  expect(result.current.error).toBeNull();
  expect(result.current.uploadOpen).toBe(true);
  act(() => result.current.openUpload({ currentTarget: document.createElement("button") }));
  expect(result.current.uploadError).toBeNull();
  const refusal = new Error("413");
  sizeRefusalFromError.mockImplementation(({ error, t }) => error === refusal ? t("Server upload limit reached") : null);
  uploadMedia.mockRejectedValueOnce(refusal);
  await act(() => result.current.upload());
  expect(result.current.uploadError).toBe("Server upload limit reached");
  expect(result.current.error).toBeNull();
  expect(result.current.loadMoreError).toBe("more media could not be loaded");
  expect(result.current.uploading).toBe(false);
});

it("switches the active editor by item ID, toggles the same item closed and closes it after saving", async () => {
  const { result, store } = mediaHookSetup();
  const { media: a } = await store.uploadMedia({ filename: "a.png", contentType: "image/png", dataBase64: "YQ==" });
  const { media: b } = await store.uploadMedia({ filename: "b.png", contentType: "image/png", dataBase64: "Yg==" });
  act(() => result.current.toggleEditing(a));
  expect(result.current.editingId).toBe(a.id);
  act(() => result.current.toggleEditing(b));
  expect(result.current.editingId).toBe(b.id);
  act(() => result.current.toggleEditing(b));
  expect(result.current.editingId).toBeNull();
  act(() => result.current.toggleEditing(a));
  expect(result.current.editingId).toBe(a.id);
  act(() => result.current.onMetadataSaved());
  expect(result.current.editingId).toBeNull();
});
