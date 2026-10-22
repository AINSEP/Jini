import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MiddleTruncate } from "../components/MiddleTruncate.js";
import { splitMiddleTruncation } from "../components/MiddleTruncate.rules.js";

describe("splitMiddleTruncation", () => {
  it("keeps the extension plus three stem characters in the never-shrinking tail", () => {
    expect(splitMiddleTruncation({ text: "woodnest-cabin-booking.mp4" })).toEqual({ head: "woodnest-cabin-book", tail: "ing.mp4" });
  });

  it("always keeps the whole extension visible, whatever its length", () => {
    for (const name of ["a-very-long-photo-name.jpeg", "notes-for-the-quarterly-review.markdown", "short-clip.webm"]) {
      const { head, tail } = splitMiddleTruncation({ text: name });
      expect(head + tail).toBe(name);
      expect(tail.endsWith(name.slice(name.lastIndexOf(".")))).toBe(true);
    }
  });

  it("leaves a name with no extension whole — a leading dot or an over-long dotted tail is not one", () => {
    expect(splitMiddleTruncation({ text: "a-plain-title-with-no-extension" })).toEqual({ head: "a-plain-title-with-no-extension", tail: "" });
    expect(splitMiddleTruncation({ text: ".environment-file" })).toEqual({ head: ".environment-file", tail: "" });
    expect(splitMiddleTruncation({ text: "release.notes-for-everyone" })).toEqual({ head: "release.notes-for-everyone", tail: "" });
  });

  it("does not split a name too short to cut", () => {
    expect(splitMiddleTruncation({ text: "a.png" })).toEqual({ head: "a.png", tail: "" });
  });

  it("honours a custom keepChars", () => {
    expect(splitMiddleTruncation({ text: "holiday-photo.png" }, { keepChars: 5 })).toEqual({ head: "holiday-", tail: "photo.png" });
  });
});

describe("MiddleTruncate", () => {
  it("renders the shrinking head and the fixed tail, and the full text in order", () => {
    const { container } = render(<MiddleTruncate text="woodnest-cabin-booking.mp4" className="extra" />);
    const root = container.querySelector(".jini-middle-truncate.extra")!;
    expect(root.querySelector(".jini-middle-truncate__head")).toHaveTextContent("woodnest-cabin-book");
    expect(root.querySelector(".jini-middle-truncate__tail")).toHaveTextContent("ing.mp4");
    expect(root.textContent).toBe("woodnest-cabin-booking.mp4");
  });

  it("passes a custom keepChars through to the split", () => {
    const { container } = render(<MiddleTruncate text="holiday-photo.png" keepChars={5} />);
    expect(container.querySelector(".jini-middle-truncate__head")).toHaveTextContent("holiday-");
    expect(container.querySelector(".jini-middle-truncate__tail")).toHaveTextContent("photo.png");
  });

  it("omits the tail element when there is nothing to cut", () => {
    const { container } = render(<MiddleTruncate text="a.png" />);
    expect(container.querySelector(".jini-middle-truncate__tail")).toBeNull();
  });
});
