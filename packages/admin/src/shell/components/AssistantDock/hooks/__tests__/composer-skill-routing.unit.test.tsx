// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { resolveSkillsAvailable, useSkillAwareAttachmentUploader } from "../composer-files.hooks.js";

// jsdom's Blob has no arrayBuffer(), which the folder zipper and the package classifier both read.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/** The host injects its legacy manifest alias names; any name proves the alias path. */
const legacyManifestNames = ["legacy.plugin.json"] as const;

describe("skill-aware attachment routing", () => {
  it("awaits a mixed-batch skill proposal before uploading with the exact composer options", async () => {
    let settleProposal!: () => void;
    const proposal = new Promise<void>((resolve) => { settleProposal = resolve; });
    const proposeFiles = vi.fn(() => proposal);
    const attachments = [{ name: "note.txt", path: "attachment:note", kind: "file" as const }];
    const uploadAttachments = vi.fn<ReturnType<typeof useSkillAwareAttachmentUploader>>(async () => attachments);
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    const skill = new File(["skill"], "SKILL.md"), note = new File(["note"], "note.txt");
    const options = { batchId: "mixed-batch", signal: new AbortController().signal };
    const upload = result.current([skill, note], options);
    await waitFor(() => expect(proposeFiles).toHaveBeenCalledWith([skill]));
    expect(uploadAttachments).not.toHaveBeenCalled();
    settleProposal();
    await expect(upload).resolves.toBe(attachments);
    expect(uploadAttachments).toHaveBeenCalledExactlyOnceWith([note], options);
    expect(uploadAttachments.mock.calls[0]![1]).toBe(options);
  });

  it("preserves one message batch and its abort signal across two attach actions", async () => {
    const uploadAttachments = vi.fn(async () => []);
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles: vi.fn(), legacyManifestNames }));
    const options = { batchId: "message-batch", signal: new AbortController().signal };
    const green = [new File(["green"], "green-square.png")];
    const yellow = [new File(["yellow"], "yellow-square.png")];
    await result.current(green, options);
    await result.current(yellow, options);
    expect(uploadAttachments.mock.calls).toEqual([[green, options], [yellow, options]]);
  });
  it("returns ordinary attachment results unchanged", async () => {
    const attachments = [{ name: "notes.txt", path: "attachment:notes", kind: "file" as const }];
    const uploadAttachments = vi.fn(async () => attachments);
    const proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    const files = [new File(["notes"], "notes.txt")];
    await expect(result.current(files)).resolves.toBe(attachments);
    expect(uploadAttachments).toHaveBeenCalledWith(files);
    expect(proposeFiles).not.toHaveBeenCalled();
  });

  it.each(["SKILL.md"])("proposes loose %s before attachment upload", async name => {
    const uploadAttachments = vi.fn(async () => []);
    const proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    const files = [new File(["skill"], name)];
    await expect(result.current(files)).resolves.toEqual([]);
    expect(proposeFiles).toHaveBeenCalledWith(files);
    expect(uploadAttachments).not.toHaveBeenCalled();
  });

  it.each(["legacy.plugin.json", "plugin.json", "README.md"])("uploads %s ZIPs as ordinary attachments, preserving options", async manifest => {
    const { zipFolderFiles } = await import("@jini-ai/agent-plugins/folder-zip");
    const zip = await zipFolderFiles({ files: [new File(["{}"], manifest)], maxBytes: 1024 * 1024 });
    const attachments = [{ name: zip.name, path: "attachment:plugin123", kind: "file" as const }];
    const uploadAttachments = vi.fn(async () => attachments), proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    const options = { batchId: "plugin-batch", signal: new AbortController().signal };
    await expect(result.current([zip], options)).resolves.toBe(attachments);
    expect(uploadAttachments).toHaveBeenCalledWith([zip], options);
    expect(proposeFiles).not.toHaveBeenCalled();
  });

  it("proposes a real skill ZIP and uploads other files in the same selection", async () => {
    const { zipFolderFiles } = await import("@jini-ai/agent-plugins/folder-zip");
    const zip = await zipFolderFiles({ files: [new File(["skill"], "SKILL.md")], maxBytes: 1024 * 1024 });
    const note = new File(["note"], "note.txt");
    const uploadAttachments = vi.fn(async () => []), proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    await result.current([zip, note]);
    expect(proposeFiles).toHaveBeenCalledWith([zip]);
    expect(uploadAttachments).toHaveBeenCalledWith([note]);
  });

  it("a malformed ZIP is delivered to chat", async () => {
    const uploadAttachments = vi.fn(async () => []), proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    const files = [new File(["not zip"], "broken.zip")];
    await result.current(files);
    expect(uploadAttachments).toHaveBeenCalledWith(files);
    expect(proposeFiles).not.toHaveBeenCalled();
  });

  it("expanded skill folders retain reference files; plugin folders with bundled skills reach chat", async () => {
    const picked = (relativePath: string) => Object.assign(new File(["content"], relativePath.split("/").at(-1)!), { relativePath });
    const skill = [picked("notes/SKILL.md"), picked("notes/references/guide.md")];
    const plugin = [picked("plugin/plugin.json"), picked("plugin/skills/help/SKILL.md")];
    const uploadAttachments = vi.fn(async () => []), proposeFiles = vi.fn(async () => {});
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }));
    await result.current([...skill, ...plugin]);
    expect(proposeFiles).toHaveBeenCalledWith(skill);
    expect(uploadAttachments).toHaveBeenCalledWith(plugin);
  });

  it("propagates an ordinary upload rejection", async () => {
    const failure = new Error("Upload unavailable");
    const uploadAttachments = vi.fn(async () => { throw failure; });
    const { result } = renderHook(() => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles: vi.fn(), legacyManifestNames }));
    await expect(result.current([new File(["notes"], "notes.txt")])).rejects.toBe(failure);
  });

  it("uses the current proposal callback after rerender", async () => {
    const uploadAttachments = vi.fn(async () => []);
    const first = vi.fn(async () => {}), second = vi.fn(async () => {});
    const { result, rerender } = renderHook(({ proposeFiles }) => useSkillAwareAttachmentUploader({ uploadAttachments, proposeFiles, legacyManifestNames }), { initialProps: { proposeFiles: first } });
    const original = result.current;
    rerender({ proposeFiles: first });
    expect(result.current).toBe(original);
    rerender({ proposeFiles: second });
    const files = [new File(["skill"], "SKILL.md")];
    await result.current(files);
    expect(second).toHaveBeenCalledWith(files);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("runtime skill availability", () => {
  it.each([
    { executionMode: "byok" as const, selectedAgentId: "aider", agents: [{ id: "aider", supportsTools: false }], expected: true },
    { executionMode: "local-cli" as const, selectedAgentId: "aider", agents: [{ id: "aider", supportsTools: false }], expected: false },
    { executionMode: "local-cli" as const, selectedAgentId: "claude", agents: [{ id: "aider", supportsTools: false }, { id: "claude", supportsTools: true }], expected: true },
    { executionMode: "local-cli" as const, selectedAgentId: "claude", agents: [{ id: "claude" }], expected: true },
    { executionMode: "local-cli" as const, selectedAgentId: "claude", agents: undefined, expected: true },
  ])("resolves $executionMode / $selectedAgentId to $expected", ({ expected, ...input }) => {
    expect(resolveSkillsAvailable(input)).toBe(expected);
  });
});
