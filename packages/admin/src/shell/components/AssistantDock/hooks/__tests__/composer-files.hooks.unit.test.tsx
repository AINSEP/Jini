// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminKitProvider, type KitUploadAttachments } from "../../../../../react/kit.js";
import { fakeAdminKit } from "../../../../../react/testing-kit.js";
import { useAttachmentValidator, useFolderDropBridge, useSkillAwareAttachmentUploader, useWorkingDirectoryAccess } from "../composer-files.hooks.js";

afterEach(() => vi.unstubAllGlobals());

it("proposes skill files without uploading them and forwards the cancellation batch for ordinary files", async () => {
  const attached = { path: "/files/notes.txt", name: "notes.txt", kind: "file" } as const;
  const uploadAttachments = vi.fn<KitUploadAttachments>(async () => [attached]);
  const proposeFiles = vi.fn(async () => {});
  const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames: [] }));
  const skill = new File(["skill"], "SKILL.md");
  const notes = new File(["notes"], "notes.txt");
  const options = { batchId: "draft-42", signal: new AbortController().signal };
  await expect(result.current([skill], options)).resolves.toEqual([]);
  expect(uploadAttachments).not.toHaveBeenCalled();
  await expect(result.current([skill, notes], options)).resolves.toEqual([attached]);
  await expect(result.current([notes])).resolves.toEqual([attached]);
  expect(proposeFiles.mock.calls).toEqual([[[skill]], [[skill]]]);
  expect(uploadAttachments.mock.calls).toEqual([[[notes], options], [[notes]]]);
});

it("passes the draft reference validation contract into a stable kit validator", async () => {
  const staged = { path: "/files/kept.txt", name: "kept.txt", kind: "file" } as const;
  const removed = { path: "/files/pruned.txt", name: "pruned.txt", kind: "file" } as const;
  const input: Parameters<typeof useAttachmentValidator>[0]["input"] = {
    endpoint: ({ ref }) => `/check-attachments/${encodeURIComponent(ref)}`, fetch: vi.fn(), isSupportedRef: ({ ref }) => ref.startsWith("/files/"), maxProbedAttachments: 3,
  };
  const validate = vi.fn(async (attachments: readonly { path: string }[]) => attachments.filter(file => file.path === staged.path).map(() => staged));
  const createChatAttachmentValidator = vi.fn(() => validate);
  const kit = fakeAdminKit({ chat: { createChatAttachmentValidator } });
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  const { result, rerender } = renderHook(() => useAttachmentValidator({ input }), { wrapper });
  const first = result.current;
  rerender();
  expect(result.current).toBe(first);
  expect(createChatAttachmentValidator).toHaveBeenCalledExactlyOnceWith(input);
  await expect(result.current([removed, staged])).resolves.toEqual([staged]);
  expect(validate).toHaveBeenCalledExactlyOnceWith([removed, staged]);
});

it("omits working directory access without native support and binds native selection to the requested storage key", async () => {
  const storageKey = "draft-owner.recent-directory";
  window.localStorage.removeItem(storageKey);
  const mount = () => renderHook(() => useWorkingDirectoryAccess({ recentDirectoryNamesStorageKey: storageKey, orFallbackSync }));
  vi.stubGlobal("showDirectoryPicker", undefined);
  expect(mount().result.current).toBeUndefined();
  const showDirectoryPicker = vi.fn(async () => ({ name: "workspace-docs" }));
  vi.stubGlobal("showDirectoryPicker", showDirectoryPicker);
  const { result } = mount();
  try {
    await expect(result.current?.pickWorkingDirectory()).resolves.toBe("workspace-docs");
    await expect(result.current?.recentDirectories()).resolves.toEqual(["workspace-docs"]);
    expect(window.localStorage.getItem(storageKey)).toBe('["workspace-docs"]');
  } finally { window.localStorage.removeItem(storageKey); }
});

it("publishes the live folder capture handler and leaves ordinary drops with the host fallback", () => {
  const input = { composerHandle: { current: null } };
  const folderDropDeps = { getPort: () => null, setCustomRoot: vi.fn(async () => {}), getCustomRoot: async () => ({ path: null }),
    folderPathsFromDataTransfer: () => [], readFailure: () => null };
  const onReady = vi.fn();
  const handleDropCapture = vi.fn();
  const proposeSkillFiles = vi.fn(async () => {});
  const useFolder = vi.fn(() => ({ notice: null, dismiss: vi.fn(), retry: vi.fn(), handleDropCapture, insertFolderPath: vi.fn(), showPathHint: vi.fn() }));
  function Dock() {
    const drop = useFolderDropBridge({ input, onReady, folderDropDeps }, { proposeSkillFiles, useFolder });
    return <div role="region" aria-label="Assistant" onDropCapture={drop.handleDropCapture} />;
  }
  render(<Dock />);
  expect(useFolder).toHaveBeenCalledExactlyOnceWith(input, folderDropDeps);
  expect(onReady).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
  const target = screen.getByRole("region", { name: "Assistant" });
  const file = new File(["chat"], "notes.txt");
  fireEvent.drop(target, { dataTransfer: { files: [file], items: [], types: ["Files"] } });
  expect(proposeSkillFiles).not.toHaveBeenCalled();
  expect(handleDropCapture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    target, dataTransfer: { files: [file], items: [], types: ["Files"] },
  }));
});

it("captures a skill folder before ordinary drop handling and reports a refused install proposal", async () => {
  const skill = new File(["skill data"], "SKILL.md");
  const leaf = {
    name: "SKILL.md", fullPath: "/digest/SKILL.md", isFile: true, isDirectory: false,
    file: (deliver: (value: File) => void) => deliver(skill),
  };
  const folder = {
    name: "digest", fullPath: "/digest", isFile: false, isDirectory: true,
    createReader: () => {
      let first = true;
      return { readEntries: (deliver: (rows: (typeof leaf)[]) => void) => {
        const rows = first ? [leaf] : [];
        first = false;
        deliver(rows);
      } };
    },
  };
  const folderDropDeps = { getPort: () => null, setCustomRoot: vi.fn(async () => {}), getCustomRoot: async () => ({ path: null }),
    folderPathsFromDataTransfer: () => [], readFailure: () => null };
  const handleDropCapture = vi.fn();
  const onSkillDropError = vi.fn();
  const proposeSkillFiles = vi.fn(async () => { throw new Error("Skill package was rejected"); });
  const useFolder = () => ({ notice: null, dismiss: vi.fn(), retry: vi.fn(), handleDropCapture, insertFolderPath: vi.fn(), showPathHint: vi.fn() });
  function Dock() {
    const drop = useFolderDropBridge({ input: { composerHandle: { current: null } }, onReady: undefined, folderDropDeps },
      { proposeSkillFiles, onSkillDropError, useFolder });
    return <div role="region" aria-label="Assistant" onDropCapture={drop.handleDropCapture} />;
  }
  render(<Dock />);
  const stillBubbles = fireEvent.drop(screen.getByRole("region", { name: "Assistant" }), {
    dataTransfer: { files: [], types: ["Files"], items: [{ kind: "file", getAsFile: () => null, webkitGetAsEntry: () => folder }] },
  });
  expect(stillBubbles).toBe(false);
  await waitFor(() => expect(onSkillDropError).toHaveBeenCalledExactlyOnceWith("Skill package was rejected"));
  expect(proposeSkillFiles).toHaveBeenCalledExactlyOnceWith([skill], ["digest/SKILL.md"]);
  expect(handleDropCapture).not.toHaveBeenCalled();
});
