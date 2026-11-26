// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bindMedia, type MediaDependencies } from "../hooks/use-media.hooks.js";
import { readFileAsBase64 } from "../rules.js";

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
