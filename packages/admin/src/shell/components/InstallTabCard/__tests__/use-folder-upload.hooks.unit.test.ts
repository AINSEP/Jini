// @vitest-environment jsdom
/** `useFolderUpload`: a picked folder reaches the page as one `<folder>.zip`; refusals come back as
 *  dictionary keys; a pick during an upload is ignored; the input is cleared for a re-pick. */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as folderZip from "@jini-ai/agent-plugins/folder-zip";
import { FOLDER_EMPTY } from "@jini-ai/agent-plugins/folder-zip";
import { FOLDER_TOO_MANY, useFolderUpload, type PickedFolderInput } from "../use-folder-upload.hooks.js";

// This package's jsdom has no `Blob.prototype.arrayBuffer`, so every pick read as unreadable. Answer it
// through jsdom's own FileReader, as a browser File does, so the real zipper runs on the fixtures below.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

function picked(path: string, content = "x"): File {
  const file = new File([content], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

function change(files: File[]) {
  const target: PickedFolderInput = { files, value: "C:\\fakepath\\x" };
  return { event: { target }, target };
}

function setup(locked = false, maxBytes = 1024) {
  const onZipped = vi.fn();
  const onError = vi.fn();
  const { result } = renderHook(() => useFolderUpload({ maxBytes, tooLarge: "too big", isLocked: () => locked, onZipped, onError, folderZip }));
  return { result, onZipped, onError };
}

describe("useFolderUpload", () => {
  it("zips the picked folder, hands over <folder>.zip, and clears the input", async () => {
    const { result, onZipped, onError } = setup();
    const { event, target } = change([picked("pkg/plugin.json"), picked("pkg/skills/a.md")]);
    await act(async () => { await result.current.onChange(event); });
    expect(target.value).toBe("");
    expect(onError).not.toHaveBeenCalled();
    expect(onZipped).toHaveBeenCalledOnce();
    expect((onZipped.mock.calls[0]![0] as File).name).toBe("pkg.zip");
    expect(result.current.zipping).toBe(false);
  });

  it("maps refusals to the page's keys: empty, over the page's limit, too many files", async () => {
    const { result, onError } = setup(false, 4);
    await act(async () => { await result.current.onChange(change([]).event); });
    await act(async () => { await result.current.onChange(change([picked("p/a", "12345")]).event); });
    await act(async () => { await result.current.onChange(change(Array.from({ length: 4097 }, (_, i) => picked(`p/${i}`, ""))).event); });
    expect(onError.mock.calls.map((call) => call[0])).toEqual([{ key: FOLDER_EMPTY }, { key: "too big" }, { key: FOLDER_TOO_MANY }]);
  });

  it("ignores a pick while the page is uploading", async () => {
    const { result, onZipped, onError } = setup(true);
    await act(async () => { await result.current.onChange(change([picked("p/a")]).event); });
    expect(onZipped).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores a second pick while the first is still zipping, and reports an unreadable file", async () => {
    const { result, onZipped, onError } = setup();
    const broken = picked("p/a");
    Object.defineProperty(broken, "arrayBuffer", { value: () => Promise.reject(new Error("gone")) });
    await act(async () => {
      const first = result.current.onChange(change([broken]).event);
      await result.current.onChange(change([picked("q/b")]).event);
      await first;
    });
    expect(onZipped).not.toHaveBeenCalled();
    expect(onError.mock.calls).toEqual([[{ key: "Could not read that folder. Try again." }]]);
  });

  it("opens the hidden folder picker", () => {
    const { result } = setup();
    const input = document.createElement("input");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    result.current.inputRef.current = input;
    result.current.onChoose();
    expect(click).toHaveBeenCalledOnce();
  });

  it("allows choosing before the hidden input is mounted", () => {
    const { result, onZipped, onError } = setup();
    expect(() => result.current.onChoose()).not.toThrow();
    expect(result.current.zipping).toBe(false);
    expect(onZipped).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("treats a picker with no file list as an empty folder and clears the input", async () => {
    const { result, onZipped, onError } = setup();
    const target: PickedFolderInput = { files: null, value: "C:\\fakepath\\x" };
    await act(async () => {
      await result.current.onChange({ target });
    });
    expect(target.value).toBe("");
    expect(onError.mock.calls).toEqual([[{ key: FOLDER_EMPTY }]]);
    expect(onZipped).not.toHaveBeenCalled();
    expect(result.current.zipping).toBe(false);
  });

  it("reports an unexpected handoff failure and releases the picker for another attempt", async () => {
    const received: string[] = [];
    const errors: string[] = [];
    let failHandoff = true;
    const { result } = renderHook(() => useFolderUpload({
      maxBytes: 1024, tooLarge: "too big", isLocked: () => false,
      onZipped: file => {
        if (failHandoff) throw new Error("preview unavailable");
        received.push(file.name);
      },
      onError: ({ key }) => errors.push(key),
      folderZip,
    }));
    await act(async () => { await result.current.onChange(change([picked("p/a")]).event); });
    expect(errors).toEqual(["Could not read that folder. Try again."]);
    expect(received).toEqual([]);
    expect(result.current.zipping).toBe(false);

    failHandoff = false;
    await act(async () => { await result.current.onChange(change([picked("p/a")]).event); });
    expect(received).toEqual(["p.zip"]);
    expect(errors).toEqual(["Could not read that folder. Try again."]);
    expect(result.current.zipping).toBe(false);
  });
});
