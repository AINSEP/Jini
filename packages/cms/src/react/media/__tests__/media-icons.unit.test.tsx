import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ExpandIcon, EyeIcon, PlaceholderIcon, PlayIcon, UploadIcon } from "../media-icons.js";

it("draws distinct decorative media glyphs without adding accessible names to their controls", () => {
  const { container } = render(<>
    <span><PlaceholderIcon />Unsupported file</span>
    <button type="button"><EyeIcon />Edit metadata</button>
    <button type="button"><ExpandIcon />View larger</button>
    <button type="button"><UploadIcon />Upload files</button>
    <button type="button"><PlayIcon />Play video</button>
  </>);

  const file = screen.getByText("Unsupported file").querySelector("svg");
  const eye = screen.getByRole("button", { name: "Edit metadata" }).querySelector("svg");
  const expand = screen.getByRole("button", { name: "View larger" }).querySelector("svg");
  const upload = screen.getByRole("button", { name: "Upload files" }).querySelector("svg");
  const play = screen.getByRole("button", { name: "Play video" }).querySelector("svg");

  expect(file?.querySelector("path[d='M11 2v3h3']")).toBeInTheDocument();
  expect(eye?.querySelector("circle")).toHaveAttribute("r", "2.25");
  expect(expand?.querySelector("path")).toHaveAttribute("d", "M6 2H2v4M12 2h4v4M6 16H2v-4M12 16h4v-4");
  expect(upload?.querySelector("path")).toHaveAttribute("d", "M9 12V3M5.5 6.5 9 3l3.5 3.5M3 12v2.5h12V12");
  expect(play?.querySelector("path")).toHaveAttribute("d", "M6 3.5v11l9-5.5-9-5.5z");
  expect(play).toHaveAttribute("fill", "currentColor");
  expect(Array.from(container.querySelectorAll("svg"), (svg) => svg.getAttribute("aria-hidden"))).toEqual([
    "true", "true", "true", "true", "true",
  ]);
});
