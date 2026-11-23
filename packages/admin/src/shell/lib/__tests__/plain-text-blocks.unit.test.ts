import { describe, expect, it } from "vitest";

import { toPlainTextBlocks } from "../plain-text-blocks.js";

describe("toPlainTextBlocks", () => {
  it("splits on blank lines into paragraphs, keeping single newlines as line breaks", () => {
    expect(toPlainTextBlocks({ text: "First line\nsame paragraph\n\nSecond paragraph" })).toEqual([
      { kind: "paragraph", lines: ["First line", "same paragraph"] },
      { kind: "paragraph", lines: ["Second paragraph"] },
    ]);
  });

  it("turns a block whose every line starts with a dash or bullet into a list", () => {
    expect(toPlainTextBlocks({ text: "Intro\n\n- one\n* two\n• three" })).toEqual([
      { kind: "paragraph", lines: ["Intro"] },
      { kind: "list", items: ["one", "two", "three"] },
    ]);
  });

  it("keeps a block with only some dashed lines as a paragraph", () => {
    expect(toPlainTextBlocks({ text: "- one\nnot a bullet" })).toEqual([{ kind: "paragraph", lines: ["- one", "not a bullet"] }]);
  });

  it("normalizes CRLF, trims lines, and ignores runs of blank lines and whitespace-only lines", () => {
    expect(toPlainTextBlocks({ text: "  A  \r\n\r\n \n\n\tB\r\n" })).toEqual([
      { kind: "paragraph", lines: ["A"] },
      { kind: "paragraph", lines: ["B"] },
    ]);
  });

  it("returns no blocks for empty, blank, null or undefined text", () => {
    expect(toPlainTextBlocks({ text: "" })).toEqual([]);
    expect(toPlainTextBlocks({ text: " \n\n " })).toEqual([]);
    expect(toPlainTextBlocks({ text: null })).toEqual([]);
    expect(toPlainTextBlocks({ text: undefined })).toEqual([]);
  });

  it("leaves a one-paragraph wall of text as a single paragraph", () => {
    expect(toPlainTextBlocks({ text: "One long sentence. Another." })).toEqual([{ kind: "paragraph", lines: ["One long sentence. Another."] }]);
  });
});
