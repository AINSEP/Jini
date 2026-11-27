// @vitest-environment jsdom
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FetchQueryProvider, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { expect, it, vi } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { parseMediaHtmlAttributes } from "../../../media/html-attributes.js";
import { EditMediaModal } from "../MediaEditChildren.js";
import { useEditMediaModal } from "../hooks/use-edit-media-modal.hooks.js";
import { createFakeMediaPort } from "../hooks/fake-media-port.js";
import { bindEditMediaPanel } from "../hooks/use-edit-media-panel.hooks.js";

const adminKit = fakeAdminKit();
const t = (key: string) => key;
const cover: AdminMedia = {
  id: "cover", workspaceId: "ws", title: "Cover", slug: "cover-art", alt: "A first cover", caption: "First caption",
  credit: "First credit", status: "active", sha256: "content-hash-123", version: 4,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  width: null, height: 320, cssClass: null, htmlAttributes: null, contentType: "image/png",
  publicUrl: "https://public.example/m/cover-art/image.jpg", createdBy: "staff-3",
};
const poster = { ...cover, id: "poster", title: "Poster", slug: "poster-print", width: 100, height: null, publicUrl: null };

function setup() {
  const store = createFakeMediaPort({ media: [cover, poster] });
  const updateMedia = vi.fn(store.updateMedia);
  const listUsers = vi.fn(async () => ({ users: [{ principalId: "staff-3", username: "Rae" }] }));
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const writeText = vi.fn(async (_value: string) => {});
  const useBoundEditMediaPanel = bindEditMediaPanel({
    hooks: { useFetchMutation, useFetchQuery, useLocaleHook: () => "en" },
    deps: {
      port: { ...store, listUsers, updateMedia },
      translate: ({ key }) => key, describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
      embedMarkerSnippet: ({ type, key, value }) => `<div data-embed="${type}:${key}:${value}"></div>`,
      embedPolicy: {
        allowedAttributeNames: ["title"], isAllowedAttributeName: ({ name }) => name === "title",
        parseAttributes: ({ text }) => {
          if (!text.startsWith("custom=")) return { attributes: {}, error: null, errors: [] };
          const error = { reason: "disallowed-name" as const, attribute: "custom" };
          return { attributes: {}, error, errors: [error] };
        },
      },
      parseMediaHtmlAttributes, writeText, setTimeout: globalThis.setTimeout,
    },
  });
  const view = (item: AdminMedia | null) => (
    <FetchQueryProvider>
      <EditMediaModal item={item} useEditMediaModalHook={useEditMediaModal} useAdminKitValuesHook={() => adminKit.values}
        useEditMediaPanelHook={useBoundEditMediaPanel} t={t} onSaved={onSaved} onCancel={onCancel} />
    </FetchQueryProvider>
  );
  return { view, store, updateMedia, onSaved, onCancel, writeText };
}

it("reuses the dialog but reseeds the draft on an asset switch before saving to the new ID", async () => {
  const user = userEvent.setup();
  const { view, store, updateMedia, onSaved, onCancel } = setup();
  const { rerender } = render(view(null));
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(view(cover));
  const dialog = screen.getByRole("dialog", { name: 'Editing "Cover"' });
  const first = within(dialog);
  expect(first.getByRole("textbox", { name: "Slug" })).toHaveValue("cover-art");
  expect(await first.findByText("Rae")).toBeVisible();
  await user.type(first.getByRole("textbox", { name: "Title" }), " draft");
  expect(first.getByRole("textbox", { name: "Title" })).toHaveValue("Cover draft");
  rerender(view(poster));
  expect(screen.getByRole("dialog", { name: 'Editing "Poster"' })).toBe(dialog);
  expect(first.getByRole("textbox", { name: "Title" })).toHaveValue("Poster");
  expect(first.getByRole("textbox", { name: "Slug" })).toHaveValue("poster-print");
  expect(first.queryByRole("link", { name: cover.publicUrl! })).toBeNull();
  await user.type(first.getByRole("textbox", { name: "Title" }), " proof");
  await user.click(first.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved.mock.calls).toEqual([[]]));
  expect(updateMedia.mock.calls).toEqual([[{ id: "poster" }, { title: "Poster proof" }]]);
  expect((await store.listMedia()).media.map(({ id, title }) => [id, title])).toEqual([
    ["cover", "Cover"], ["poster", "Poster proof"],
  ]);
  await user.click(first.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
  rerender(view(null));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("wires each editable field to its own patch key and surfaces the server error while preserving the draft for retry", async () => {
  const user = userEvent.setup();
  const { view, store, updateMedia, onSaved } = setup();
  let rejectFirst!: (reason: Error) => void;
  updateMedia.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
  render(view(cover));
  const dialog = within(screen.getByRole("dialog", { name: 'Editing "Cover"' }));
  const edit = async (name: string, value: string, role = "textbox") => {
    const input = dialog.getByRole(role, { name });
    await user.clear(input);
    if (value) await user.type(input, value);
  };
  await edit("Title", "Spring cover");
  await edit("Alt", "Two flowers");
  await edit("Slug", "spring");
  await edit("Caption", "Tulips");
  await edit("Credit", "Photographer");
  await edit("Width (px)", "640", "spinbutton");
  await edit("Height (px)", "", "spinbutton");
  await edit("CSS class (optional)", "wide");
  await edit("HTML attributes (optional)", 'custom="x"');
  const attributes = dialog.getByRole("textbox", { name: "HTML attributes (optional)" });
  expect(attributes).toHaveAttribute("aria-invalid", "true");
  expect(dialog.getByText("'custom' is not an allowed HTML attribute.")).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "Save" }));
  const patch = { title: "Spring cover", alt: "Two flowers", slug: "spring", caption: "Tulips", credit: "Photographer",
    width: 640, height: null, cssClass: "wide", htmlAttributes: 'custom="x"' };
  expect(updateMedia.mock.calls).toEqual([[{ id: "cover" }, patch]]);
  expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => rejectFirst(new Error("Attribute rejected by server")));
  expect(dialog.getByRole("alert")).toHaveTextContent("Attribute rejected by server");
  expect((await store.listMedia()).media.find(({ id }) => id === "cover")).toEqual(cover);
  expect(onSaved.mock.calls).toEqual([]);
  expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Spring cover");
  await edit("HTML attributes (optional)", 'title="Flowers"');
  expect(attributes).not.toHaveAttribute("aria-invalid");
  await user.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved.mock.calls).toEqual([[]]));
  expect((await store.listMedia()).media.find(({ id }) => id === "cover")).toEqual({
    ...cover, ...patch, htmlAttributes: 'title="Flowers"',
  });
});

it("copies the public URL, stored embed slug and hash from their own read-only rows", async () => {
  vi.useFakeTimers();
  try {
    const user = userEvent.setup({ advanceTimers: (ms) => { vi.advanceTimersByTime(ms); } });
    const { view, writeText } = setup();
    const { unmount } = render(view(cover));
    const dialog = within(screen.getByRole("dialog", { name: 'Editing "Cover"' }));
    const publicUrl = "https://public.example/m/cover-art/image.jpg";
    const embed = '<div data-embed="media:slug:cover-art"></div>';
    expect(dialog.getByRole("link", { name: publicUrl })).toHaveAttribute("href", publicUrl);
    for (const value of [publicUrl, embed, "content-hash-123"]) {
      const field = dialog.getByText(value).closest<HTMLElement>(".field")!;
      const copy = within(field).getByRole("button", { name: "Copy" });
      await user.click(copy);
      expect(copy).toHaveAccessibleName("Copied");
    }
    expect(writeText.mock.calls).toEqual([[publicUrl], [embed], ["content-hash-123"]]);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

it("routes native cancel and backdrop dismissal through the owner without treating an inside click as dismissal", async () => {
  const user = userEvent.setup();
  const { view, onCancel } = setup();
  render(view(cover));
  const dialog = screen.getByRole("dialog", { name: 'Editing "Cover"' });
  await user.click(within(dialog).getByRole("textbox", { name: "Title" }));
  expect(onCancel.mock.calls).toEqual([]);
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onCancel.mock.calls).toEqual([[]]);
  await user.click(dialog);
  expect(onCancel.mock.calls).toEqual([[], []]);
});
