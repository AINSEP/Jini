import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PostCoverImage, type PostCoverImageBindings } from "../PostCoverImage.js";
import type { PostFeaturedImageController } from "../hooks/use-post-featured-image.hooks.js";

const bindings: PostCoverImageBindings = {
  Icon: () => <span />,
  InfoTip: ({ label, descriptionId, agentHandle }) => <button id={descriptionId} data-agent-element={agentHandle}>{label}</button>,
  MediaPickerDialog: () => <div />,
  agentHandle: ({ handle }) => ({ "data-agent-element": handle }),
  showsCoverImageSlot: ({ bodyFormat }) => bodyFormat !== "html",
  showsHideCoverInBodyToggle: ({ kind }) => kind === "post",
};
const picker: PostFeaturedImageController = {
  pickerOpen: false,
  openPicker: vi.fn(),
  closePicker: vi.fn(),
  handleSelect: vi.fn(),
  clear: vi.fn(),
  previewUrl: null,
  accept: ["image/*"],
  previewFailed: false,
  onPreviewError: vi.fn(),
};
const props = {
  featuredMediaId: null,
  setFeaturedMediaId: vi.fn(),
  kind: "post" as const,
  hideCoverImageInBody: false,
  setHideCoverImageInBody: vi.fn(),
  t: (key: string) => key,
  bindings,
};

it("suppresses the HTML cover after calling the supplied hook", () => {
  const useFeaturedImage = vi.fn(() => picker);
  const { container } = render(<PostCoverImage {...props} bodyFormat="html" useFeaturedImage={useFeaturedImage} />);
  expect(container.innerHTML).toBe("");
  expect(useFeaturedImage).toHaveBeenCalledExactlyOnceWith({ value: null, onChange: props.setFeaturedMediaId });
});

it("keeps the tooltip outside the checkbox label", () => {
  render(<PostCoverImage {...props} bodyFormat="doc" useFeaturedImage={() => picker} />);
  const checkbox = screen.getByRole("checkbox", { name: "Hide the cover image in the body" });
  const tooltip = screen.getByRole("button", { name: "Applies when the cover comes from the first image in the post" });
  expect(tooltip.closest("label")).toBeNull();
  expect(tooltip.parentElement).toBe(checkbox.closest("label")?.parentElement);
  expect(checkbox).toHaveAttribute("aria-describedby", tooltip.id);
  fireEvent.click(tooltip);
  expect(props.setHideCoverImageInBody).not.toHaveBeenCalled();
});
