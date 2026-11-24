// @vitest-environment jsdom
import { act, renderHook as originalRenderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type DragEvent, type ReactNode } from "react";
import { folderPathsFromDataTransfer } from "@jini-ai/ui/core";
import { useSerialWrites, useSettlementGeneration } from "@jini-ai/ui/panel-kit";

import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import type { FolderDropPort } from "../folder-drop-port.js";
import type { CustomRootFailure } from "../folder-drop.rules.js";
import { useFolderDrop, type UseFolderDropDeps, type UseFolderDropInput } from "../use-folder-drop.hooks.js";

/** Stands in for the host's API error: a status line plus the `code`/`body` the server sent. */
class ApiError extends Error {
  readonly code: string;
  readonly body: { error?: unknown } | undefined;
  constructor(required: { message: string; status: number }, optional: { code: string; body: { error?: unknown } | undefined }) {
    super(required.message);
    this.code = optional.code;
    this.body = optional.body;
  }
}

/** The host's `readFailure` binding, against the stand-in above. Module-level so its identity is stable. */
function readFailure(error: unknown): CustomRootFailure {
  if (!(error instanceof ApiError)) return null;
  return { code: error.code, message: typeof error.body?.error === "string" ? error.body.error : "" };
}

/** The required deps every test shares; each test overrides the seams it drives. */
function useFolderDropWith(input: UseFolderDropInput, deps: Partial<UseFolderDropDeps> = {}) {
  return useFolderDrop(input, {
    getPort: () => null, getCustomRoot: async () => ({ path: null }), setCustomRoot: async () => ({}),
    folderPathsFromDataTransfer, readFailure, ...deps,
  });
}

/** The real serial-writes/settlement hooks, as a host's admin kit binds them — the overlap tests depend on their ordering. */
const kit = fakeAdminKit({ hooks: { useSerialWrites, useSettlementGeneration } });
function KitScope({ children }: { children: ReactNode }) {
  return createElement(AdminKitProvider, { kit, children });
}
const renderHook: typeof originalRenderHook = (callback, options) => originalRenderHook(callback, { ...options, wrapper: KitScope });

/** The composer handle members these tests observe. */
type ComposerSpy = { insertText: ReturnType<typeof vi.fn>; addFolders: ReturnType<typeof vi.fn> };

/** A manually-resolved/rejected promise, for pinning exact settlement order across overlapping
 *  drops — never a timer. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes pending microtasks without advancing any timer. Only for a *negative* or count
 *  assertion ("still only 1 call") — everything else below uses `waitFor`. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/**
 * @file SPEC-053 core logic — behavior.spec.md §1.2 (custom-root "last write wins" + replacement
 * wording), feature.spec.md AC-01/AC-02/AC-04/AC-05/AC-09, owner 11-01: folder chips replace text insertion; a failed custom-root set keeps the chips.
 */

/** A minimal `DragEvent` stand-in — only `dataTransfer`/`preventDefault`/`stopPropagation` are ever
 *  read by `handleDropCapture`. */
function fakeDropEvent(dataTransfer: DataTransfer): DragEvent<HTMLElement> {
  return {
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as DragEvent<HTMLElement>;
}

/** One `kind: "file"` drag item whose `webkitGetAsEntry()` reports a directory, paired with a `File`
 *  `getPathForFile` resolves to `path` — the shape `folderPathsFromDataTransfer` requires to treat a
 *  drop as a folder. */
function folderDataTransfer(paths: readonly string[]): { dataTransfer: DataTransfer; port: FolderDropPort } {
  const files = paths.map((_, i) => ({ id: `f${i}` }) as unknown as File);
  const items = files.map(
    (file) =>
      ({
        kind: "file",
        webkitGetAsEntry: () => ({ isDirectory: true }) as unknown as FileSystemEntry,
      }) as unknown as DataTransferItem,
  );
  const dataTransfer = { items, files } as unknown as DataTransfer;
  const byFile = new Map(files.map((file, i) => [file, paths[i] as string]));
  const port: FolderDropPort = { getPathForFile: (file) => byFile.get(file) ?? "" };
  return { dataTransfer, port };
}

/** Two independent single-folder drops (`a`, `b`) plus one combined port that answers for either
 *  one's files — needed because `getPort` is read once at render, so both drops must share a port. */
function twoFolderDrops(): {
  a: ReturnType<typeof folderDataTransfer>;
  b: ReturnType<typeof folderDataTransfer>;
  port: FolderDropPort;
} {
  const a = folderDataTransfer(["/Users/x/a"]);
  const b = folderDataTransfer(["/Users/x/b"]);
  const port: FolderDropPort = { getPathForFile: (f) => a.port.getPathForFile(f) || b.port.getPathForFile(f) };
  return { a, b, port };
}

/** A loose-file drop (not a folder) — `webkitGetAsEntry().isDirectory` is `false`. */
function looseFileDataTransfer(): DataTransfer {
  const file = { id: "loose" } as unknown as File;
  return {
    items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) }] as unknown as DataTransferItem[],
    files: [file],
  } as unknown as DataTransfer;
}

function fakeComposerHandle(): { current: ComposerSpy | null } {
  return { current: { insertText: vi.fn(), addFolders: vi.fn() } };
}

describe("useFolderDrop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps handleDropCapture's identity across re-renders with an inline port lookup (a new getPort each render)", () => {
    // `useFolderDropBridge` (AssistantDock.hooks.tsx) re-publishes on every identity change of
    // `handleDropCapture` and documents that as "effectively once per mount". An inline default
    // `getPort` broke that: a new `handleDropCapture` on every render.
    const composerHandle = fakeComposerHandle();
    const setCustomRoot = vi.fn();
    const getCustomRoot = vi.fn();
    const { result, rerender } = renderHook(() => useFolderDropWith({ composerHandle }, { setCustomRoot, getCustomRoot }));
    const first = result.current.handleDropCapture;

    rerender();

    expect(result.current.handleDropCapture).toBe(first);
  });

  it("swallows a folder drop with no recoverable path and asks for a pasted path (plain browser tab)", () => {
    // Owner 2026-10-27: a folder dragged onto the browser admin's chat was expanded into an upload
    // ("You can attach at most 10 files"). A folder drop must never upload; with no path to insert,
    // it shows the paste hint instead.
    const composerHandle = fakeComposerHandle();
    const { dataTransfer } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn();
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => null, setCustomRoot, getCustomRoot: vi.fn() }),
    );

    const event = fakeDropEvent(dataTransfer);
    act(() => result.current.handleDropCapture(event));

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).not.toHaveBeenCalled();
    expect(result.current.notice).toEqual({ kind: "path-unavailable" });
  });

  it("swallows a folder drop the desktop bridge cannot resolve (empty path) the same way", () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer } = folderDataTransfer(["/Users/x/site"]);
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => ({ getPathForFile: () => "" }), setCustomRoot: vi.fn(), getCustomRoot: vi.fn() }),
    );

    const event = fakeDropEvent(dataTransfer);
    act(() => result.current.handleDropCapture(event));

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toEqual({ kind: "path-unavailable" });
  });

  it("leaves a loose-file drop alone in a plain browser tab (it is an ordinary attachment)", () => {
    const composerHandle = fakeComposerHandle();
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => null, setCustomRoot: vi.fn(), getCustomRoot: vi.fn() }),
    );

    const event = fakeDropEvent(looseFileDataTransfer());
    act(() => result.current.handleDropCapture(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it("falls through (no-op) when nothing dropped is a folder (EC-02, a loose file)", () => {
    const composerHandle = fakeComposerHandle();
    const port: FolderDropPort = { getPathForFile: () => "/should-not-be-used" };
    const setCustomRoot = vi.fn();
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn() }),
    );

    const event = fakeDropEvent(looseFileDataTransfer());
    act(() => result.current.handleDropCapture(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).not.toHaveBeenCalled();
  });

  it("uses the folder path in a drop containing a string item, a loose file, and a folder", async () => {
    const composerHandle = fakeComposerHandle();
    const loose = { id: "loose" } as unknown as File;
    const folder = { id: "folder" } as unknown as File;
    const dataTransfer = {
      items: [
        { kind: "string" },
        { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) },
        { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) },
      ],
      files: [loose, folder],
    } as unknown as DataTransfer;
    const port: FolderDropPort = { getPathForFile: (file) => file === folder ? "/Users/x/site" : "/Users/x/loose.txt" };
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site" });
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }),
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));

    expect(composerHandle.current?.addFolders).toHaveBeenCalledExactlyOnceWith({ folders: ["/Users/x/site"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).toHaveBeenCalledExactlyOnceWith("/Users/x/site");
  });

  it("leaves a drop whose webkitGetAsEntry returns null for normal file handling", () => {
    const composerHandle = fakeComposerHandle();
    const dataTransfer = {
      items: [{ kind: "file", webkitGetAsEntry: () => null }],
      files: [{ id: "no-entry" }],
    } as unknown as DataTransfer;
    const getPathForFile = vi.fn(() => "/must-not-be-used");
    const setCustomRoot = vi.fn();
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => ({ getPathForFile }), setCustomRoot, getCustomRoot: vi.fn(),
    }));
    const event = fakeDropEvent(dataTransfer);

    act(() => result.current.handleDropCapture(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(getPathForFile).not.toHaveBeenCalled();
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it("inserts the path and sets the custom root on a successful drop (AC-01/AC-02)", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/my-site"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/my-site" });
    const getCustomRoot = vi.fn().mockResolvedValue({ path: null });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot }),
    );

    const event = fakeDropEvent(dataTransfer);
    await act(async () => {
      result.current.handleDropCapture(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(composerHandle.current?.addFolders).toHaveBeenCalledWith({ folders: ["/Users/x/my-site"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).toHaveBeenCalledWith("/Users/x/my-site");
    expect(result.current.notice).toEqual({
      kind: "confirmation",
      path: "/Users/x/my-site",
      replacedPreviousPath: null,
    });
  });

  it("an unmount cancels a pending auto-dismiss, so it never fires afterwards", async () => {
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site" });
    const getCustomRoot = vi.fn().mockResolvedValue({ path: null });
    const { result, unmount } = renderHook(() =>
      useFolderDropWith({ composerHandle: fakeComposerHandle() }, { getPort: () => port, setCustomRoot, getCustomRoot, autoDismissMs: 1000 }),
    );
    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });
    for (let i = 0; i < 5 && result.current.notice === null; i++) await flushMicrotasks();
    expect(result.current.notice).toMatchObject({ kind: "confirmation" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a replaced previous path when a different custom root was already set (behavior.spec.md §1.2)", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site-b"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site-b" });
    const getCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site-a" });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(result.current.notice).toEqual({
      kind: "confirmation",
      path: "/Users/x/site-b",
      replacedPreviousPath: "/Users/x/site-a",
    });
  });

  it("does not report a replacement when the previous root already equalled the dropped path", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/same"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/same" });
    const getCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/same" });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(result.current.notice).toMatchObject({ replacedPreviousPath: null });
  });

  it.each([
    { previousPath: null, replacedPreviousPath: null },
    { previousPath: "/Users/x/site", replacedPreviousPath: null },
    { previousPath: "/Users/x/old-site", replacedPreviousPath: "/Users/x/old-site" },
  ])("pins replacement wording for previous root $previousPath", async ({ previousPath, replacedPreviousPath }) => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn(async (path: string) => ({ path }));
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port,
      getCustomRoot: async () => ({ path: previousPath }),
      setCustomRoot,
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));

    expect(setCustomRoot).toHaveBeenCalledExactlyOnceWith("/Users/x/site");
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/site", replacedPreviousPath });
  });

  // Bug (11-02 o2/lane C): this case used to pin the wrong behaviour — the earlier success's
  // auto-dismiss timer wiped the newer error 400 ms later. A newer notice must cancel the older
  // timer; errors stay until dismissed or replaced.
  it("a prior confirmation timer never erases a later error notice", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    const setCustomRoot = vi.fn<(path: string) => Promise<{ path: string }>>()
      .mockResolvedValueOnce({ path: "/Users/x/a" })
      .mockRejectedValueOnce(new Error("write failed"));
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port,
      getCustomRoot: async () => ({ path: null }),
      setCustomRoot,
      autoDismissMs: 1000,
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/a", replacedPreviousPath: null });
    act(() => vi.advanceTimersByTime(600));
    await act(async () => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));
    const errorNotice = { kind: "error", path: "/Users/x/b", reason: "endpoint-unreachable" };
    expect(result.current.notice).toEqual(errorNotice);
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.notice).toEqual(errorNotice);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toEqual(errorNotice);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.notice).toEqual(errorNotice);
  });

  it("still sets the custom root when reading the previous value fails (best-effort read, REQ-02 unaffected)", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site" });
    const getCustomRoot = vi.fn().mockRejectedValue(new Error("network hiccup"));
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(setCustomRoot).toHaveBeenCalledWith("/Users/x/site");
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/site", replacedPreviousPath: null });
  });

  it("inserts the composer text even when the custom-root call fails (ui.spec.md §4, REQ-01 never regresses)", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/gone"]);
    const setCustomRoot = vi.fn().mockRejectedValue(new ApiError({ message: "'/Users/x/gone' does not exist", status: 400 }, { code: "INVALID_PATH", body: { error: "'/Users/x/gone' does not exist" } }));
    const getCustomRoot = vi.fn().mockResolvedValue({ path: null });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(composerHandle.current?.addFolders).toHaveBeenCalledWith({ folders: ["/Users/x/gone"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(result.current.notice).toEqual({ kind: "error", path: "/Users/x/gone", reason: "does-not-exist" });
  });

  it("classifies a 'not a directory' validation failure distinctly from 'does not exist'", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/a-file"]);
    const setCustomRoot = vi
      .fn()
      .mockRejectedValue(new ApiError({ message: "'/Users/x/a-file' is not a directory", status: 400 }, { code: "INVALID_PATH", body: { error: "'/Users/x/a-file' is not a directory" } }));
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(result.current.notice).toEqual({ kind: "error", path: "/Users/x/a-file", reason: "not-a-directory" });
  });

  it.each([undefined, { error: 42 }])("uses the directory-validation notice when INVALID_PATH has no textual body (%j)", async (body) => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/a-file"]);
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port,
      getCustomRoot: async () => ({ path: null }),
      setCustomRoot: async () => { throw new ApiError({ message: "invalid path", status: 400 }, { code: "INVALID_PATH", body }); },
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));

    expect(result.current.notice).toEqual({ kind: "error", path: "/Users/x/a-file", reason: "not-a-directory" });
    expect(composerHandle.current?.addFolders).toHaveBeenCalledWith({ folders: ["/Users/x/a-file"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
  });

  it("does not infer a validation reason from the message of an unrelated API error", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port,
      getCustomRoot: async () => ({ path: null }),
      setCustomRoot: async () => { throw new ApiError({ message: "does not exist", status: 503 }, { code: "UNAVAILABLE", body: { error: "does not exist" } }); },
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));
    expect(result.current.notice).toEqual({ kind: "error", path: "/Users/x/site", reason: "endpoint-unreachable" });
  });

  it("reports the endpoint as unreachable for a non-validation failure (network/500)", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(result.current.notice).toEqual({ kind: "error", path: "/Users/x/site", reason: "endpoint-unreachable" });
  });

  it("uses the LAST folder in a single multi-folder drop as the custom root, and stages every folder without editing text", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/one", "/Users/x/two"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/two" });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });

    expect(composerHandle.current?.addFolders).toHaveBeenCalledWith({ folders: ["/Users/x/one", "/Users/x/two"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    expect(setCustomRoot).toHaveBeenCalledWith("/Users/x/two");
    expect(result.current.notice).toMatchObject({ kind: "confirmation", paths: ["/Users/x/one", "/Users/x/two"] });
  });

  it("retry preserves every staged folder when the active-root request initially fails", async () => {
    const composerHandle = fakeComposerHandle();
    const paths = ["/Users/x/one", "/Users/x/two"];
    const { dataTransfer, port } = folderDataTransfer(paths);
    const setCustomRoot = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ path: paths[1] });
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }));
    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));
    expect(result.current.notice?.kind).toBe("error");
    await act(async () => result.current.retry());
    expect(result.current.notice).toMatchObject({ kind: "confirmation", paths });
    expect(composerHandle.current?.addFolders).toHaveBeenCalledTimes(1);
  });

  it("dismiss() clears the notice immediately and cancels the pending auto-dismiss", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site" });
    const { result } = renderHook(() =>
      useFolderDropWith(
        { composerHandle },
        { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }), autoDismissMs: 4000 },
      ),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });
    expect(result.current.notice).not.toBeNull();

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();

    // The timer that would have auto-dismissed must not fire a second, redundant `setNotice(null)`
    // after an explicit dismiss already happened — asserted indirectly: advancing past it must not
    // throw or resurrect a notice.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.notice).toBeNull();
  });

  it("a dismissed confirmation's timer never erases a later error notice", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn()
      .mockResolvedValueOnce({ path: "/Users/x/site" })
      .mockRejectedValueOnce(new Error("write failed"));
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }), autoDismissMs: 4000,
    }));
    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));
    expect(result.current.notice?.kind).toBe("confirmation");
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();

    await act(async () => result.current.handleDropCapture(fakeDropEvent(dataTransfer)));
    const errorNotice = { kind: "error", path: "/Users/x/site", reason: "endpoint-unreachable" };
    expect(result.current.notice).toEqual(errorNotice);
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.notice).toEqual(errorNotice);
  });

  it("auto-dismisses the confirmation after autoDismissMs", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/site"]);
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/site" });
    const { result } = renderHook(() =>
      useFolderDropWith(
        { composerHandle },
        { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }), autoDismissMs: 1000 },
      ),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });
    expect(result.current.notice).not.toBeNull();

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.notice).toBeNull();
  });

  it("gives a second confirmation its own full auto-dismiss interval", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    let root: string | null = null;
    const { result } = renderHook(() => useFolderDropWith({ composerHandle }, {
      getPort: () => port,
      getCustomRoot: async () => ({ path: root }),
      setCustomRoot: async (path) => { root = path; return { path }; },
      autoDismissMs: 1000,
    }));

    await act(async () => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/a", replacedPreviousPath: null });
    act(() => vi.advanceTimersByTime(600));
    await act(async () => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));
    expect(root).toBe("/Users/x/b");
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/b", replacedPreviousPath: "/Users/x/a" });

    act(() => vi.advanceTimersByTime(400));
    expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/b" });
    act(() => vi.advanceTimersByTime(599));
    expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/b" });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toBeNull();
  });

  it("can dismiss before any confirmation has scheduled a timer", () => {
    const { result } = renderHook(() => useFolderDropWith({ composerHandle: fakeComposerHandle() }, {
      getPort: () => null,
      getCustomRoot: async () => ({ path: null }),
      setCustomRoot: async (path) => ({ path }),
    }));

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retry() is a no-op before any drop has been handled", () => {
    const composerHandle = fakeComposerHandle();
    const setCustomRoot = vi.fn();
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => null, setCustomRoot, getCustomRoot: vi.fn() }),
    );

    act(() => result.current.retry());
    expect(setCustomRoot).not.toHaveBeenCalled();
  });

  it("retry() re-attempts the last dropped path and can turn a failure into a confirmation", async () => {
    const composerHandle = fakeComposerHandle();
    const { dataTransfer, port } = folderDataTransfer(["/Users/x/flaky"]);
    const setCustomRoot = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ path: "/Users/x/flaky" });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }),
    );

    await act(async () => {
      result.current.handleDropCapture(fakeDropEvent(dataTransfer));
    });
    expect(result.current.notice).toMatchObject({ kind: "error" });

    await act(async () => {
      result.current.retry();
    });

    expect(setCustomRoot).toHaveBeenCalledTimes(2);
    expect(setCustomRoot).toHaveBeenNthCalledWith(2, "/Users/x/flaky");
    expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/flaky", replacedPreviousPath: null });
  });
});

describe("useFolderDrop — last drop wins across overlapping drops", () => {
  // Real timers throughout: `waitFor` polls on real timers, and these tests pin ordering with
  // manually-resolved deferreds, never `vi.advanceTimersByTime`.
  it("a slow read for an older drop never overwrites the newer drop's root", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    const reads = [deferred<{ path: string | null }>(), deferred<{ path: string | null }>()];
    const readsCopy = [...reads];
    const getCustomRoot = vi.fn(() => reads.shift()!.promise);
    const setCustomRoot = vi.fn(async (p: string) => ({ path: p }));
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot, autoDismissMs: 60_000 }),
    );

    act(() => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    act(() => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));

    readsCopy[1]!.resolve({ path: null });
    readsCopy[0]!.resolve({ path: null });

    await waitFor(() => expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/b" }));
    expect(setCustomRoot.mock.calls.at(-1)).toEqual(["/Users/x/b"]);
    // `a` was superseded before its turn on the chain came up, so it never read and never wrote —
    // the server only ever saw `b`. Pins the mint-BEFORE-`run` rule too: minted inside the queued
    // task, `a` would still be "current" when it started, and would read and write `/Users/x/a`.
    expect(getCustomRoot).toHaveBeenCalledTimes(1);
    expect(setCustomRoot.mock.calls).toEqual([["/Users/x/b"]]);
  });

  it("a drop superseded while its own read is in flight never issues its write", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    const readA = deferred<{ path: string | null }>();
    const getCustomRoot = vi.fn().mockReturnValueOnce(readA.promise).mockResolvedValue({ path: null });
    const setCustomRoot = vi.fn(async (p: string) => ({ path: p }));
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot, autoDismissMs: 60_000 }),
    );

    act(() => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    await waitFor(() => expect(getCustomRoot).toHaveBeenCalledTimes(1));

    // `b` lands while `a`'s read is still parked; then `a`'s read settles.
    act(() => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));
    readA.resolve({ path: null });

    await waitFor(() =>
      expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/b", replacedPreviousPath: null }),
    );
    expect(setCustomRoot.mock.calls).toEqual([["/Users/x/b"]]);
  });

  it("does not issue a newer drop's write until the older write has settled", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    const getCustomRoot = vi.fn().mockResolvedValue({ path: null });
    const sA = deferred<{ path: string }>();
    const sB = deferred<{ path: string }>();
    const setCustomRoot = vi.fn().mockReturnValueOnce(sA.promise).mockReturnValueOnce(sB.promise);
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => port, setCustomRoot, getCustomRoot, autoDismissMs: 60_000 }),
    );

    act(() => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    await waitFor(() => expect(setCustomRoot).toHaveBeenCalledTimes(1));

    act(() => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));
    await flushMicrotasks();

    expect(setCustomRoot).toHaveBeenCalledTimes(1);

    sA.resolve({ path: "/Users/x/a" });
    await waitFor(() => expect(setCustomRoot).toHaveBeenNthCalledWith(2, "/Users/x/b"));

    sB.resolve({ path: "/Users/x/b" });
    await waitFor(() =>
      expect(result.current.notice).toEqual({ kind: "confirmation", path: "/Users/x/b", replacedPreviousPath: null }),
    );
  });

  it("an older drop's failure never replaces the newer drop's confirmation", async () => {
    const composerHandle = fakeComposerHandle();
    const { a, b, port } = twoFolderDrops();
    // `b`'s own read is parked, so the moment between `a`'s failure and `b`'s confirmation spans a
    // render — a superseded error that leaked through would be on screen for that whole wait.
    const readB = deferred<{ path: string | null }>();
    const getCustomRoot = vi.fn().mockResolvedValueOnce({ path: null }).mockReturnValueOnce(readB.promise);
    const sA = deferred<{ path: string }>();
    const setCustomRoot = vi
      .fn()
      .mockReturnValueOnce(sA.promise)
      .mockResolvedValueOnce({ path: "/Users/x/b" });
    // Every notice any render ever showed — a superseded drop's error must never appear, not even
    // briefly before the newer drop's confirmation replaces it.
    const shown: Array<ReturnType<typeof useFolderDropWith>["notice"]> = [];
    const { result } = renderHook(() => {
      const controller = useFolderDropWith(
        { composerHandle },
        { getPort: () => port, setCustomRoot, getCustomRoot, autoDismissMs: 60_000 },
      );
      shown.push(controller.notice);
      return controller;
    });

    act(() => result.current.handleDropCapture(fakeDropEvent(a.dataTransfer)));
    await waitFor(() => expect(setCustomRoot).toHaveBeenCalledTimes(1));

    act(() => result.current.handleDropCapture(fakeDropEvent(b.dataTransfer)));
    await flushMicrotasks();

    sA.reject(new ApiError({ message: "'/Users/x/a' does not exist", status: 400 }, { code: "INVALID_PATH", body: { error: "'/Users/x/a' does not exist" } }));
    await waitFor(() => expect(getCustomRoot).toHaveBeenCalledTimes(2));
    await flushMicrotasks();
    readB.resolve({ path: null });

    await waitFor(() => expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/b" }));
    await flushMicrotasks();
    expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/b" });
    expect(shown.filter((n) => n !== null && "path" in n).map((n) => `${n.kind} ${n.path}`)).not.toContain("error /Users/x/a");
  });
});


describe("useFolderDrop — a path from the composer's folder button", () => {
  it("stages the picked path exactly like a desktop folder drop and points the custom root at it", async () => {
    const composerHandle = fakeComposerHandle();
    const setCustomRoot = vi.fn().mockResolvedValue({ path: "/Users/x/My Site" });
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle }, { getPort: () => null, setCustomRoot, getCustomRoot: vi.fn().mockResolvedValue({ path: null }) }),
    );
    act(() => result.current.insertFolderPath("/Users/x/My Site"));
    expect(composerHandle.current?.addFolders).toHaveBeenCalledExactlyOnceWith({ folders: ["/Users/x/My Site"] });
    expect(composerHandle.current?.insertText).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.notice).toMatchObject({ kind: "confirmation", path: "/Users/x/My Site" }));
    expect(setCustomRoot).toHaveBeenCalledWith("/Users/x/My Site");
  });

  it("shows the paste-the-path hint on request", () => {
    const { result } = renderHook(() =>
      useFolderDropWith({ composerHandle: fakeComposerHandle() }, { getPort: () => null, setCustomRoot: vi.fn(), getCustomRoot: vi.fn() }),
    );
    act(() => result.current.showPathHint());
    expect(result.current.notice).toEqual({ kind: "path-unavailable" });
  });
});
