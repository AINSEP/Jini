// @vitest-environment jsdom
import { File as NativeFile } from "node:buffer";
import type { DragEvent } from "react";
import { expect, it, vi } from "vitest";
import { captureSkillDrop } from "../skill-drop.js";

/** `captureSkillDrop` over hand-built drag events: the host's `proposeFiles`/`fallback` are spies. */

const file = (name: string, body = "x") => new NativeFile([body], name) as unknown as File;
const leaf = (name: string, fullPath: string) => ({ name, fullPath, isFile: true, isDirectory: false, file: (resolve: (f: File) => void) => resolve(file(name)) });
function folder(children: unknown[]) {
  return { name: "skill", fullPath: "/skill", isFile: false, isDirectory: true, createReader: () => {
    let read = false;
    return { readEntries: (resolve: (entries: unknown[]) => void) => { resolve(read ? [] : children); read = true; } };
  } };
}
function drop(items: unknown[], files: File[] = []) {
  return { dataTransfer: { items, files, types: ["Files"] }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}
const dir = (root: unknown) => ({ kind: "file", getAsFile: () => null, webkitGetAsEntry: () => root });

it("a file-only drop is not captured, so ordinary attachments keep their own uploader", () => {
  const event = drop([], [file("photo.png")]);
  expect(captureSkillDrop({ event: event as unknown as DragEvent<HTMLElement>, proposeFiles: vi.fn(), fallback: vi.fn() })).toBe(false);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it("a folder holding SKILL.md is proposed with its relative paths", async () => {
  const proposeFiles = vi.fn(async (_files: readonly File[], _paths?: readonly string[]) => {}), fallback = vi.fn();
  const event = drop([dir(folder([leaf("SKILL.md", "/skill/SKILL.md"), leaf("a.md", "/skill/refs/a.md")]))]);
  expect(captureSkillDrop({ event: event as unknown as DragEvent<HTMLElement>, proposeFiles, fallback })).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(proposeFiles).toHaveBeenCalledTimes(1));
  expect(proposeFiles.mock.calls[0]?.[1]).toEqual(["skill/SKILL.md", "skill/refs/a.md"]);
  expect(fallback).not.toHaveBeenCalled();
});

it("a folder without SKILL.md, or too large to be a skill, keeps the host's folder action", async () => {
  const fallback = vi.fn(), proposeFiles = vi.fn(), onError = vi.fn();
  captureSkillDrop({ event: drop([dir(folder([leaf("notes.md", "/f/notes.md")]))]) as unknown as DragEvent<HTMLElement>, proposeFiles, fallback }, { onError });
  const big = folder(Array.from({ length: 600 }, (_, i) => leaf(`a${i}.png`, `/f/a${i}.png`)));
  captureSkillDrop({ event: drop([dir(big)]) as unknown as DragEvent<HTMLElement>, proposeFiles, fallback }, { onError });
  await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(2));
  expect(proposeFiles).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("once a SKILL.md was seen, a walk limit is reported through onError instead", async () => {
  const children = [leaf("SKILL.md", "/skill/SKILL.md"), ...Array.from({ length: 600 }, (_, i) => leaf(`a${i}.md`, `/skill/a${i}.md`))];
  const onError = vi.fn(), fallback = vi.fn();
  captureSkillDrop({ event: drop([dir(folder(children))]) as unknown as DragEvent<HTMLElement>, proposeFiles: vi.fn(), fallback }, { onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Choose up to 256 files, 8 MiB total."));
  expect(fallback).not.toHaveBeenCalled();
});
