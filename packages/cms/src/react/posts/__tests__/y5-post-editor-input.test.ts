import { expect, test, vi } from "vitest";
import { handleImageDrop, hexOrDefault, overridesThemePageFromSelectValue, overridesThemePageSelectValue, readFileAsDataUrl, showsCoverImageSlot, showsHideCoverInBodyToggle, toolbarBtnClass, withTitleNode } from "../post-editor-input.rules.js";

test("file read errors reject with the reader error", async () => {
  const error = new Error("read failure");
  const reader = { result: null, error, onerror: null as ((event: ProgressEvent<FileReader>) => void) | null, onload: null as ((event: ProgressEvent<FileReader>) => void) | null, readAsDataURL: vi.fn() };
  const pending = readFileAsDataUrl({ file: { name: "image.png" } as File, deps: { createReader: () => reader } });
  expect(reader.readAsDataURL).toHaveBeenCalledOnce();
  reader.onerror!({} as ProgressEvent<FileReader>);
  await expect(pending).rejects.toBe(error);
});

test("external URL drop inserts once while internal reordering stays unhandled", () => {
  const insertImageAtDrop = vi.fn(() => true);
  const preventDefault = vi.fn();
  const event = { dataTransfer: { getData: (kind: string) => kind === "text/uri-list" ? " https://example.test/image.png " : "" }, preventDefault, clientX: 1, clientY: 2 } as unknown as DragEvent;
  const view = {};
  expect(handleImageDrop({ view, event, moved: false, deps: { insertImageAtDrop } })).toBe(true);
  expect(insertImageAtDrop).toHaveBeenCalledExactlyOnceWith({ view, event, src: "https://example.test/image.png" });
  expect(preventDefault).toHaveBeenCalledOnce();
  insertImageAtDrop.mockClear();
  preventDefault.mockClear();
  expect(handleImageDrop({ view, event, moved: true, deps: { insertImageAtDrop } })).toBe(false);
  expect(insertImageAtDrop).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
});

test("title replacement retains title attributes and the rest of the authored document", () => {
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "body" }] };
  const bodyJson = { type: "doc", attrs: { custom: true }, content: [{ type: "title", attrs: { textAlign: "center" }, content: [{ type: "text", text: "old" }] }, paragraph] };
  expect(withTitleNode({ bodyJson, title: "new" })).toEqual({ ...bodyJson, content: [{ ...bodyJson.content[0], content: [{ type: "text", text: "new" }] }, paragraph] });
  expect(bodyJson.content[0]?.content?.[0]?.text).toBe("old");
});

test("theme-collision choices retain the distinction between default, post and theme", () => {
  expect(["default", "post", "theme"].map(value => overridesThemePageFromSelectValue({ value }))).toEqual([null, true, false]);
  expect([null, true, false].map(overridesThemePage => overridesThemePageSelectValue({ overridesThemePage }))).toEqual(["default", "post", "theme"]);
});

test("toolbar controls signal active formatting and only display six-digit hex colors", () => {
  expect(toolbarBtnClass({ active: true })).toBe("tb-btn on");
  expect(toolbarBtnClass({ active: false })).toBe("tb-btn");
  const fallback = "#171717";
  expect([null, "#f00", "red", "#12345g", "x#123456", "#123456ff", "#a1B2c3"].map(value => hexOrDefault({ value, fallback })))
    .toEqual([fallback, fallback, fallback, fallback, fallback, fallback, "#a1B2c3"]);
});

test("an external non-HTTP drop is left to the editor’s default handler", () => {
  const insertImageAtDrop = vi.fn();
  const preventDefault = vi.fn();
  const event = { dataTransfer: { getData: (format: string) => format === "text/plain" ? "/relative.png" : "" }, preventDefault } as unknown as DragEvent;
  expect(handleImageDrop({ view: {}, event, moved: false, deps: { insertImageAtDrop } })).toBe(false);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(insertImageAtDrop).not.toHaveBeenCalled();
});

test("only document bodies get a cover slot and only posts get the in-body toggle", () => {
  expect(showsCoverImageSlot({ bodyFormat: "doc" })).toBe(true);
  expect(showsCoverImageSlot({ bodyFormat: undefined })).toBe(true);
  expect(showsCoverImageSlot({ bodyFormat: "html" })).toBe(false);
  expect(showsHideCoverInBodyToggle({ kind: "page" })).toBe(false);
  expect(showsHideCoverInBodyToggle({ kind: "post" })).toBe(true);
});
