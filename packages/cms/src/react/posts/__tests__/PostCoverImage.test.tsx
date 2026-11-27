import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { afterEach, expect, it, vi } from "vitest";
import { PostCoverImage, type PostCoverImageBindings } from "../PostCoverImage.js";
import { usePostFeaturedImage, type PostFeaturedImageController } from "../hooks/use-post-featured-image.hooks.js";

afterEach(cleanup);

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

it("the cover preview falls back on load errors, opens a picker, and clears the selected asset", () => {
  const selected: AdminMedia = {
    id: "selected", workspaceId: "workspace", title: "Selected", slug: "selected", alt: "", caption: "", credit: "",
    sha256: "hash", status: "active", createdAt: "created", updatedAt: "updated", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null,
  };
  const testBindings: PostCoverImageBindings = { ...bindings, MediaPickerDialog: ({ onCancel, onSelect, accept, agentHandle }) =>
    <div role="dialog" aria-label="Media library" data-agent-element={agentHandle}>
      <output>{accept.join(",")}</output>
      <button onClick={() => onSelect(selected)}>Choose Selected</button>
      <button onClick={onCancel}>Cancel</button>
    </div> };
  const paths = { port: { mediaOriginalUrl: ({ id }: { id: string }) => `/original/${id}` },
    renditionUrl: ({ id }: { id: string }) => `/rendition/${id}` };
  function Probe() {
    const [featuredMediaId, setFeaturedMediaId] = useState<string | null>("before");
    const [hideCoverImageInBody, setHideCoverImageInBody] = useState(false);
    return <PostCoverImage {...props} {...{ featuredMediaId, setFeaturedMediaId, hideCoverImageInBody, setHideCoverImageInBody }}
      bindings={testBindings} bodyFormat="doc" useFeaturedImage={input => usePostFeaturedImage({ ...input, deps: paths })} />;
  }
  render(<Probe />);
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Hide the cover image in the body" });
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  const preview = screen.getByRole("img", { name: "Cover image" });
  expect(preview.getAttribute("src")).toBe("/rendition/before");
  fireEvent.error(preview);
  expect(screen.getByRole("img", { name: "Cover image" }).getAttribute("src")).toBe("/original/before");
  fireEvent.error(screen.getByRole("img", { name: "Cover image" }));
  expect(screen.getByRole("img", { name: "Cover image unavailable" }).getAttribute("title")).toBe("Cover image unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  const dialog = screen.getByRole("dialog", { name: "Media library" });
  expect(dialog.getAttribute("data-agent-element")).toBe("post-cover-dialog");
  expect(dialog.textContent).toContain("image/*");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Media library" })).toBeNull();
  expect(screen.getByRole("img", { name: "Cover image unavailable" }).getAttribute("title")).toBe("Cover image unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Selected" }));
  expect(screen.queryByRole("dialog", { name: "Media library" })).toBeNull();
  expect(screen.getByRole("img", { name: "Cover image" }).getAttribute("src")).toBe("/rendition/selected");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add cover image" }));
  expect(screen.getByRole("dialog", { name: "Media library" }).getAttribute("data-agent-element")).toBe("post-cover-dialog");
});

it("the document cover slot on a page has no post body-hide toggle", () => {
  render(<PostCoverImage {...props} kind="page" bodyFormat="doc" useFeaturedImage={() => picker} />);
  expect(screen.getByRole("button", { name: "Add cover image" }).textContent).toBe("Add cover image");
  expect(screen.queryByRole("checkbox")).toBeNull();
});
