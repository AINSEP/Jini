// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { captureSkillDrop } from "../skill-drop.js";

type Drop = Parameters<typeof captureSkillDrop>[0];
interface Entry {
  name: string;
  fullPath: string;
  isFile: boolean;
  isDirectory: boolean;
  file?(resolve: (file: File) => void, reject: (error: Error) => void): void;
  createReader?(): { readEntries(resolve: (entries: Entry[]) => void, reject: (error: Error) => void): void };
}

function leaf(file: File, fullPath: string): Entry {
  return { name: file.name, fullPath, isFile: true, isDirectory: false, file: (resolve) => resolve(file) };
}

function folder(name: string, ...batches: Entry[][]): Entry {
  return {
    name, fullPath: `/${name}`, isFile: false, isDirectory: true,
    createReader() {
      let next = 0;
      return { readEntries: (resolve) => resolve(batches[next++] ?? []) };
    },
  };
}

function drop({ entries = [], files = [] }: { entries?: Entry[]; files?: File[] }) {
  const proposeFiles = vi.fn<Drop["proposeFiles"]>().mockResolvedValue(undefined);
  const fallback = vi.fn<Drop["fallback"]>();
  const onError = vi.fn<(message: string) => void>();
  const bubble = vi.fn();
  const capture = vi.fn<(captured: boolean) => void>();
  render(<div onDrop={bubble}><div aria-label="Chat drop target" onDrop={event => capture(captureSkillDrop({ event, proposeFiles, fallback }, { onError }))} /></div>);
  const target = screen.getByLabelText("Chat drop target");
  const dispatch = () => fireEvent.drop(target, { dataTransfer: {
    types: ["Files"], files,
    items: [
      { kind: "string" },
      ...entries.map(entry => ({ kind: "file", getAsFile: () => null, webkitGetAsEntry: () => entry })),
      ...files.map(file => ({ kind: "file", getAsFile: () => file })),
    ],
  } });
  return { dispatch, proposeFiles, fallback, onError, bubble, capture };
}

afterEach(cleanup);

it("leaves file-only ZIP drops for the normal attachment handler", () => {
  const h = drop({ files: [new File(["zip"], "skill.zip")] });
  expect(h.dispatch()).toBe(true);
  expect(h.capture.mock.calls).toEqual([[false]]);
  expect(h.bubble).toHaveBeenCalledTimes(1);
  expect(h.proposeFiles).not.toHaveBeenCalled();
  expect(h.fallback).not.toHaveBeenCalled();
});

it("walks nested and later directory batches and preserves each browser-relative path", async () => {
  const doc = new File(["instructions"], "SKILL.md");
  const asset = new File(["reference"], "topics.txt");
  const ignored: Entry = { name: "unknown", fullPath: "/draft/unknown", isFile: false, isDirectory: false };
  const h = drop({ entries: [folder("draft", [folder("refs", [leaf(asset, "/draft/refs/topics.txt")]), ignored], [leaf(doc, "//draft/SKILL.md")])] });
  expect(h.dispatch()).toBe(false);
  expect(h.capture.mock.calls).toEqual([[true]]);
  expect(h.bubble).not.toHaveBeenCalled();
  await waitFor(() => expect(h.proposeFiles.mock.calls).toEqual([[[asset, doc], ["draft/refs/topics.txt", "draft/SKILL.md"]]]));
  expect(h.fallback).not.toHaveBeenCalled();
  expect(h.onError).not.toHaveBeenCalled();
});

it("passes a captured ordinary folder to fallback with its snapshotted attachment metadata", async () => {
  const note = new File(["note"], "notes.txt");
  const entry = folder("notes", [leaf(note, "/notes/notes.txt")]);
  const h = drop({ entries: [entry], files: [note] });
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.fallback).toHaveBeenCalledTimes(1));
  const transfer = h.fallback.mock.calls[0]?.[0].dataTransfer;
  expect(Array.from(transfer?.files ?? [])).toEqual([note]);
  expect(Array.from(transfer?.types ?? [])).toEqual(["Files"]);
  expect(Array.from(transfer?.items ?? []).map(item => ({ file: item.getAsFile(), entry: item.webkitGetAsEntry?.() })))
    .toEqual([{ file: null, entry }, { file: note, entry: undefined }]);
  expect(h.proposeFiles).not.toHaveBeenCalled();
});

it("keeps the host folder action when traversal exceeds the depth limit before identifying a skill", async () => {
  let entry = folder("leaf");
  for (let i = 0; i < 17; i += 1) entry = folder(`parent-${i}`, [entry]);
  const h = drop({ entries: [entry] });
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.fallback).toHaveBeenCalledTimes(1));
  expect(h.onError).not.toHaveBeenCalled();
  expect(h.proposeFiles).not.toHaveBeenCalled();
});

it("refuses to propose an identified skill when it contains a 257th file", async () => {
  const doc = new File([], "SKILL.md");
  const asset = new File([], "asset.txt");
  const entries = [leaf(doc, "/draft/SKILL.md"), ...Array.from({ length: 256 }, (_, i) => leaf(asset, `/draft/${i}/asset.txt`))];
  const h = drop({ entries: [folder("draft", entries)] });
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.onError.mock.calls).toEqual([["Choose up to 256 files, 8 MiB total."]]));
  expect(h.proposeFiles).not.toHaveBeenCalled();
  expect(h.fallback).not.toHaveBeenCalled();
});

it.each([
  { item: { name: "SKILL.md", fullPath: "/draft/SKILL.md", isFile: true, isDirectory: false }, message: "skill file SKILL.md cannot be read" },
  { item: { name: "data", fullPath: "/draft/data", isFile: false, isDirectory: true }, message: "skill folder data cannot be read" },
])("reports an unreadable entry: $message", async ({ item, message }) => {
  const h = drop({ entries: [folder("draft", [item])] });
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.onError.mock.calls).toEqual([[message]]));
  expect(h.proposeFiles).not.toHaveBeenCalled();
  expect(h.fallback).not.toHaveBeenCalled();
});

it.each([
  { rejection: new Error("Folder review was refused"), message: "Folder review was refused" },
  { rejection: "internal details", message: "Could not read skill folder." },
])("reports a failed installation proposal: $message", async ({ rejection, message }) => {
  const doc = new File([], "SKILL.md");
  const h = drop({ entries: [folder("draft", [leaf(doc, "/draft/SKILL.md")])] });
  h.proposeFiles.mockRejectedValueOnce(rejection);
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.onError.mock.calls).toEqual([[message]]));
  expect(h.proposeFiles.mock.calls).toEqual([[[doc], ["draft/SKILL.md"]]]);
  expect(h.fallback).not.toHaveBeenCalled();
});

it("enforces the aggregate byte limit even for a skill folder with only a few files", async () => {
  const doc = new File(["x"], "SKILL.md");
  const asset = new File([new Uint8Array(4 * 1024 * 1024)], "sample.bin");
  const h = drop({ entries: [folder("bundle", [leaf(doc, "/bundle/SKILL.md"), leaf(asset, "/bundle/a/sample.bin"), leaf(asset, "/bundle/b/sample.bin")])] });
  expect(h.dispatch()).toBe(false);
  await waitFor(() => expect(h.onError.mock.calls).toEqual([["Choose up to 256 files, 8 MiB total."]]));
  expect(h.proposeFiles).not.toHaveBeenCalled();
  expect(h.fallback).not.toHaveBeenCalled();
});
