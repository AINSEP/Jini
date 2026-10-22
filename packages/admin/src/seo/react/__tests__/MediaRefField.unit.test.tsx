import { fireEvent, render, screen, within } from "./harness/render.js";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaRefField } from "../components/MediaRefField.js";
import { api, type AdminMedia } from "./harness/api.js";
import { useState } from 'react';
import { isStoredMediaRef } from '../../rules.js';

/**
 * @file `MediaRefField` — the "Choose image"/preview/Remove control wrapping `MediaPickerDialog`
 * for an `ogImage`/`twitterImage`/`defaultOgImage` field. Mounts the REAL `MediaPickerDialog` and
 * spies on `api.listMedia` to feed it, per this codebase's established convention
 * (`EmbedInsertControl.unit.test.tsx`) — this suite covers the field's own contract (the text input
 * still works, "Choose image" opens the real picker, selecting an asset writes the EXACT
 * `{assetId}:public` ref, Remove clears it, the preview renders/disappears), not
 * `MediaPickerDialog`'s own internals again (already covered by its own test file).
 */

function mediaItem(overrides: Partial<AdminMedia> = {}): AdminMedia {
  return {
    id: "asset-1",
    workspaceId: "w1",
    title: "Sunset",
    slug: "sunset",
    alt: "A sunset over water",
    caption: "",
    credit: "",
    sha256: "abc",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    contentType: "image/png",
    publicUrl: null,
    ...overrides,
  };
}

function renderField(overrides: Partial<Parameters<typeof MediaRefField>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <MediaRefField
      locale="en"
      id="seo-default-og-image"
      label="Default Open Graph / Twitter image"
      value=""
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaRefField — the chosen file row", () => {
  it.each([
    ['asset-9:public', true], [' sunset:thumbnail ', true],
    ['', false], ['asset-9', false], [':public', false], ['asset-9:', false],
    ['https:', false], ['https:/', false], ['https://images.example/picture.png', false],
    ['//images.example/picture.png', false],
  ] as const)('uses selected-image presentation only for a complete library reference (%s)', (value, stored) => {
    expect(isStoredMediaRef({ value })).toBe(stored);
  });

  it('leaves a malformed caller value unselected, matching the preview guard', () => {
    expect(isStoredMediaRef({ value: null as unknown as string })).toBe(false);
  });
  // 2026-10-15: the text box is gone (owner: a read-only "Selected image" box "looks useless").
  it("names the chosen file instead of showing a text box", () => {
    renderField({ value: "sunset:public" });
    const row = screen.getByRole("group", { name: "Default Open Graph / Twitter image" });
    expect(within(row).getByText("sunset")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("empty state is just Choose image", () => {
    renderField({ value: "" });
    const row = screen.getByRole("group", { name: "Default Open Graph / Twitter image" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Choose image"]);
    expect(within(row).queryByRole("img")).not.toBeInTheDocument();
  });

  it("saves the exact stored selection through a hidden input without painting the reference", () => {
    const ref = "b4879dd4-1be6-4a51-b1a9-1446ec2dc144:public";
    const { container } = render(<form><MediaRefField locale="en" id="social-image" name="defaultOgImage"
      label="Social image" value={ref} onChange={vi.fn()} /></form>);
    expect(within(screen.getByRole("group", { name: "Social image" })).getByText("Image")).toBeInTheDocument();
    expect(screen.queryByText(ref)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/media/b4879dd4-1be6-4a51-b1a9-1446ec2dc144/original");
    expect(new FormData(container.querySelector('form')!).getAll('defaultOgImage')).toEqual([ref]);
  });

  it("Remove empties the saved value and leaves only Choose image", async () => {
    const user = userEvent.setup();
    function ControlledField() {
      const [value, setValue] = useState("asset-9:public");
      return <form><MediaRefField locale="en" id="social-image" name="defaultOgImage"
        label="Social image" value={value} onChange={setValue} /></form>;
    }
    const { container } = render(<ControlledField />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("asset-9")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(new FormData(container.querySelector('form')!).getAll('defaultOgImage')).toEqual(['']);
  });

  it("shows the decoded preview's pixel size beside the name", () => {
    renderField({ value: "https://cdn.example/a/pic.png" });
    const img = screen.getByRole("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 1200 });
    Object.defineProperty(img, "naturalHeight", { value: 630 });
    fireEvent.load(img);
    expect(screen.getByText("pic.png")).toBeInTheDocument();
    expect(screen.getByText("1200 × 630")).toBeInTheDocument();
  });
});

describe("MediaRefField — Choose image", () => {
  it("opens the real MediaPickerDialog", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem()] });
    const user = userEvent.setup();
    renderField();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose image" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // 2026-10-05: an og:image/twitter:image must be an image, so the picker hides videos (same
  // `accept` the post featured-image chooser passes).
  it("offers images only — a video in the library is not listed", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({
      media: [mediaItem(), mediaItem({ id: "asset-2", slug: "clip", title: "Clip", contentType: "video/mp4" })],
    });
    const user = userEvent.setup();
    renderField();

    await user.click(screen.getByRole("button", { name: "Choose image" }));
    expect(await screen.findByTitle("Sunset")).toBeInTheDocument();
    expect(screen.queryByTitle("Clip")).not.toBeInTheDocument();
  });

  // readable-slugs S5b: buildMediaRef prefers the slug — id and slug are distinct here so a passing
  // assertion proves the SLUG was used, not just any field.
  it("selecting an asset writes the EXACT '{slug}:public' ref and closes the dialog", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem({ id: "asset-1", slug: "asset-1-slug" })] });
    const user = userEvent.setup();
    const { onChange } = renderField();

    await user.click(screen.getByRole("button", { name: "Choose image" }));
    await user.click(await screen.findByTitle("Sunset"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("asset-1-slug:public");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel in the dialog closes it without calling onChange", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem()] });
    const user = userEvent.setup();
    const { onChange } = renderField();

    await user.click(screen.getByRole("button", { name: "Choose image" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MediaRefField — Remove", () => {
  it("is not rendered when the field is empty", () => {
    renderField({ value: "" });
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("is rendered when the field has a value, and clicking it clears the field to ''", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ value: "asset-1:public" });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("MediaRefField — preview", () => {
  it("renders no preview image when the field is empty", () => {
    renderField({ value: "" });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a preview image resolved off the current '{assetId}:transform' value", () => {
    renderField({ value: "asset-1:public" });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", expect.stringContaining("/media/asset-1/original"));
  });

  it("renders an absolute URL value directly as the preview src", () => {
    renderField({ value: "https://cdn.example/pic.png" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/pic.png");
  });
});
