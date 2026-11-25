// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlainTextBlocks } from "../PlainTextBlocks.js";

/**
 * @file `PlainTextBlocks` — the one renderer for plugin/skill descriptions: paragraphs keep their
 * single line breaks as `<br>`, all-bullet blocks become a `<ul>`, and empty text renders nothing.
 * The block splitting itself is `lib/plain-text-blocks.ts`'s (tested there).
 */

afterEach(cleanup);

describe("PlainTextBlocks", () => {
  it.each([null, undefined, "", "  \n\n "])("renders nothing for empty text (%j)", (text) => {
    const { container } = render(<PlainTextBlocks text={text} className="desc" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders paragraphs with in-paragraph line breaks, and bullet blocks as a list", () => {
    const { container } = render(<PlainTextBlocks text={"First line\nsecond line\n\n- one\n- two"} className="desc" />);
    const root = container.firstElementChild!;
    expect(root).toHaveClass("desc");
    expect(root.innerHTML).toBe("<p>First line<br>second line</p><ul><li>one</li><li>two</li></ul>");
  });

  it("escapes markup in the text rather than rendering it", () => {
    const { container } = render(<PlainTextBlocks text="<b>not bold</b>" />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>not bold</b>");
  });
});
