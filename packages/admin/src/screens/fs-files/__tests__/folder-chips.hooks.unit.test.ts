// @vitest-environment jsdom
import { act, renderHook as originalRenderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createElement, type DragEvent, type ReactNode } from "react";
import { folderPathsFromDataTransfer } from "@jini-ai/ui/core";
import { useSerialWrites, useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { useFolderDrop as useFolderDropHook, type UseFolderDropDeps, type UseFolderDropInput } from "../use-folder-drop.hooks.js";
import { useNativeFolderPicker } from "../use-native-folder-picker.hooks.js";

type ChatPaneComposerHandle = { insertText: (text: string) => void; addFolders: (required: { folders: readonly string[] }) => void };

/** The host's binding of the injected collaborators these tests do not drive. */
function useFolderDrop(input: UseFolderDropInput, deps: Omit<UseFolderDropDeps, "folderPathsFromDataTransfer" | "readFailure">) {
  return useFolderDropHook(input, { folderPathsFromDataTransfer, readFailure: () => null, ...deps });
}
const kit = fakeAdminKit({ hooks: { useSerialWrites, useSettlementGeneration } });
const renderHook: typeof originalRenderHook = (callback, options) => originalRenderHook(callback, {
  ...options, wrapper: ({ children }: { children: ReactNode }) => createElement(AdminKitProvider, { kit, children }),
});

it("a picker stages the exact folder without inserting text and still sets the custom root", async () => {
  const path = String.raw`C:\A B`;
  const insertText = vi.fn(), addFolders = vi.fn(), setCustomRoot = vi.fn(async () => ({ path }));
  const composerHandle = { current: { insertText, addFolders } as unknown as ChatPaneComposerHandle };
  const { result } = renderHook(() => {
    const drop = useFolderDrop({ composerHandle }, { getPort: () => null, getCustomRoot: async () => ({ path: null }), setCustomRoot });
    return useNativeFolderPicker({ onPicked: drop.insertFolderPath, onFailed: drop.showPathHint }, {
      probe: async () => ({}), pick: async () => ({ path }), isDialogAlreadyOpen: () => false,
    });
  });
  await act(async () => result.current.pickFolder());
  expect(addFolders).toHaveBeenCalledExactlyOnceWith({ folders: [path] });
  expect(insertText).not.toHaveBeenCalled();
  expect(setCustomRoot).toHaveBeenCalledExactlyOnceWith(path);
});

it("a multi-folder drop stages every folder and sets the last custom root without touching text", async () => {
  const folders = ["/a/First Folder", String.raw`\\srv\share`];
  const files = folders.map(path => new File([], path));
  const insertText = vi.fn(), addFolders = vi.fn(), setCustomRoot = vi.fn(async (path: string) => ({ path }));
  const composerHandle = { current: { insertText, addFolders } as unknown as ChatPaneComposerHandle };
  const { result } = renderHook(() => useFolderDrop({ composerHandle }, {
    getPort: () => ({ getPathForFile: file => folders[files.indexOf(file)]! }),
    getCustomRoot: async () => ({ path: null }), setCustomRoot,
  }));
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: {
    files, items: files.map(() => ({ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) })),
  } } as unknown as DragEvent<HTMLElement>;
  await act(async () => result.current.handleDropCapture(event));
  expect(addFolders).toHaveBeenCalledExactlyOnceWith({ folders });
  expect(insertText).not.toHaveBeenCalled();
  expect(setCustomRoot).toHaveBeenCalledExactlyOnceWith(folders[1]);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
});
