import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { Dialog } from "@jini-ai/ui-kit/react";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { acceptedMediaItems, useMediaPickerItems } from "../../../media/MediaPickerDialog/MediaPickerDialog.hooks.js";
import { bindMediaContentEditor, type MediaContentEditorProps } from "../MediaContentEditor.js";
import { useMediaContentEditor } from "../MediaContentEditor.hooks.js";

function asset(slug: string, title: string, contentType: string): AdminMedia {
  return {
    id: `id-${slug}`, workspaceId: "library", slug, title, contentType, alt: `${title} alt`, caption: `${title} caption`, credit: "",
    status: "active", sha256: "0".repeat(64), createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, publicUrl: `/m/${slug}`,
  };
}

const assets = [
  asset("sweet-pea", "Sweet pea", "image/png"), asset("ink-animation", "Ink animation", "video/webm"),
  asset("wind-chime", "Wind chime", "audio/mpeg"), asset("instructions", "Instructions", "application/pdf"),
];
const acceptsMedia: MediaContentEditorProps["deps"]["acceptsMedia"] = ({ item, accept }) =>
  accept.some((pattern) => item.contentType?.startsWith(pattern.slice(0, -1)));

const kit: MediaContentEditorProps["kit"] = {
  Icon: ({ name, size, ...aria }) => <svg role="img" data-glyph={name} width={size} height={size} {...aria} />,
  InfoTip: () => null,
  DockHeaderTip: ({ children }) => <>{children}</>,
  Dialog,
  DevicePreviewFrame: ({ children }) => <div>{children}</div>,
  HtmlAttributeRows: () => null,
};

const hooks: MediaContentEditorProps["hooks"] = {
  useEffect, useMemo, useRef, useState, useEditor: useMediaContentEditor,
  useMediaPickerItems: ({ port }, { locale }) => useMediaPickerItems({
    port, locale, useFetchQueryHook: useFetchQuery, describeError: ({ fallback }) => fallback, translate: ({ key }) => key,
  }),
  useTabBarKeyboard: () => ({ onKeyDown: () => {} }),
  usePreview: ({ config }) => ({ loading: false, error: null, document: JSON.stringify(config), paneWidth: 400, frameRef: () => {} }),
};

type Config = Record<string, unknown>;
type ListMedia = MediaContentEditorProps["deps"]["port"]["listMedia"];
function renderEditor(initial: Config, listMedia: ListMedia = async () => ({ media: assets })) {
  const port = { listMedia, mediaOriginalUrl: ({ id }: { id: string }) => `/original/${id}` };
  const Editor = bindMediaContentEditor({
    hooks, kit, deps: { acceptedMediaItems, port, locale: "en", acceptsMedia, resolveTabBarTabIndex: ({ activeId, tab }) => activeId === tab.id ? 0 : -1 },
  });
  const changes = vi.fn<(config: Config) => void>();
  function Harness() {
    const [config, setConfig] = useState(initial);
    return <FetchQueryProvider><Editor widgetType="media" config={config} onChange={(next) => { changes(next); setConfig(next); }} agentHandle="widget-media" /></FetchQueryProvider>;
  }
  render(<Harness />);
  return { changes };
}

const savedConfig = () => JSON.parse(screen.getByTitle("Preview").getAttribute("srcdoc") ?? "null") as unknown;

it("starts with an empty Single layout and clamps or clears columns in Grid", () => {
  renderEditor({ mode: "media", layout: "single", items: [] }, () => new Promise(() => {}));
  expect(screen.getByText("No media yet. Choose from the library or add one by slug.")).toBeVisible();
  expect(screen.getByRole("radio", { name: "Single" })).toBeChecked();
  expect(screen.queryByRole("spinbutton", { name: "Columns" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
  const columns = screen.getByRole("spinbutton", { name: "Columns" });
  expect(columns).toHaveAttribute("data-agent-element", "widget-media-columns");
  fireEvent.change(columns, { target: { value: "14" } });
  expect(columns).toHaveValue(6);
  expect(savedConfig()).toEqual({ mode: "media", layout: "grid", columns: 6, items: [] });
  fireEvent.change(columns, { target: { value: "0" } });
  expect(columns).toHaveValue(1);
  fireEvent.change(columns, { target: { value: "" } });
  expect(columns).toHaveValue(3);
  expect(savedConfig()).toEqual({ mode: "media", layout: "grid", items: [] });
});

it.each([
  { reason: "empty", slug: "", message: "Type a media slug." },
  { reason: "invalid", slug: "bad/slug", message: "Slugs can't contain spaces or slashes." },
  { reason: "duplicate", slug: " sweet-pea ", message: "Already in this list." },
  { reason: "unknown", slug: "not-in-library", message: 'No media with the slug "not-in-library".' },
])("shows the $reason slug refusal without changing saved items", async ({ slug, message }) => {
  const { changes } = renderEditor({ mode: "media", layout: "single", items: [{ slug: "sweet-pea" }] });
  await screen.findByPlaceholderText("Sweet pea alt");
  const input = screen.getByLabelText("Add by slug");
  fireEvent.change(input, { target: { value: slug } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(changes).not.toHaveBeenCalled();
  expect(savedConfig()).toEqual({ mode: "media", layout: "single", items: [{ slug: "sweet-pea" }] });
  fireEvent.change(input, { target: { value: "wind-chime" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(input).not.toHaveAttribute("aria-invalid");
});

it("adds a trimmed slug by keyboard, shows the library fallback text, and reorders the stored rows", async () => {
  renderEditor({ mode: "media", layout: "single", items: [{ slug: "sweet-pea", alt: "Authored alt" }] });
  await screen.findByPlaceholderText("Sweet pea alt");
  const input = screen.getByLabelText("Add by slug");
  fireEvent.change(input, { target: { value: " wind-chime " } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(input).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Media slug 2" })).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("textbox", { name: "Caption 2" })).toHaveAttribute("placeholder", "Wind chime caption");
  expect(screen.getByRole("img", { name: "Audio file" })).toHaveAttribute("data-glyph", "volume");
  expect(screen.getByRole("button", { name: "Move up 1" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move up 2" }));
  expect(savedConfig()).toEqual({ mode: "media", layout: "single", items: [{ slug: "wind-chime" }, { slug: "sweet-pea", alt: "Authored alt" }] });
});

it("preserves both drafts during editing and warns when saving Raw HTML will drop structured content", () => {
  const { changes } = renderEditor({ mode: "media", layout: "single", items: [{ slug: "sweet-pea" }] }, () => new Promise(() => {}));
  fireEvent.click(screen.getByRole("tab", { name: "Raw HTML" }));
  expect(changes).not.toHaveBeenCalled();
  const source = screen.getByRole("textbox", { name: "HTML source" });
  fireEvent.change(source, { target: { value: "<p>A new draft</p>" } });
  expect(screen.getByText("Saving keeps only this tab. The other tab's content will be dropped.")).toHaveAttribute("role", "status");
  expect(savedConfig()).toEqual({ mode: "html", html: "<p>A new draft</p>" });
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  expect(screen.getByRole("textbox", { name: "Media slug 1" })).toHaveValue("sweet-pea");
  fireEvent.click(screen.getByRole("tab", { name: "Raw HTML" }));
  expect(screen.getByRole("textbox", { name: "HTML source" })).toHaveValue("<p>A new draft</p>");
});

it("warns and marks only Raw HTML over the size limit as invalid", () => {
  renderEditor({ mode: "html", html: "x".repeat(65_536) }, () => new Promise(() => {}));
  const source = screen.getByRole("textbox", { name: "HTML source" });
  expect(source).not.toHaveAttribute("aria-invalid");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  fireEvent.change(source, { target: { value: "x".repeat(65_537) } });
  expect(source).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent(`HTML is longer than ${(65_536).toLocaleString()} characters and won't save.`);
});

it("renders the library loading and populated states, discards cancelled checks, and appends media in selection order", async () => {
  let displayLibrary!: (answer: { media: AdminMedia[] }) => void;
  const loading = new Promise<{ media: AdminMedia[] }>((resolve) => { displayLibrary = resolve; });
  renderEditor({ mode: "media", layout: "grid", items: [{ slug: "instructions" }] }, () => loading);
  const choose = screen.getByRole("button", { name: "Choose from library" });
  fireEvent.click(choose);
  let dialog = screen.getByRole("dialog", { name: "Choose media" });
  expect(within(dialog).getByText("Loading media…")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Add selected" })).toBeDisabled();
  await act(async () => displayLibrary({ media: assets }));
  const check = await within(dialog).findByRole("checkbox", { name: "Ink animation" });
  expect(check.closest("label")?.querySelector("[data-glyph]")).toHaveAttribute("data-glyph", "play");
  expect(within(dialog).getByRole("checkbox", { name: "Wind chime" }).closest("label")?.querySelector("[data-glyph]")).toHaveAttribute("data-glyph", "volume");
  expect(within(dialog).getByRole("checkbox", { name: "Sweet pea" }).closest("label")?.querySelector("img")).toHaveAttribute("src", "/original/id-sweet-pea");
  expect(within(dialog).queryByRole("checkbox", { name: "Instructions" })).not.toBeInTheDocument();
  fireEvent.click(check);
  expect(check).toBeChecked();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(savedConfig()).toEqual({ mode: "media", layout: "grid", items: [{ slug: "instructions" }] });
  expect(screen.getByRole("textbox", { name: "Media slug 1" }).closest("li")?.querySelector("[data-glyph='image']")).toBeInTheDocument();

  fireEvent.click(choose);
  dialog = screen.getByRole("dialog", { name: "Choose media" });
  const video = within(dialog).getByRole("checkbox", { name: "Ink animation" });
  const image = within(dialog).getByRole("checkbox", { name: "Sweet pea" });
  expect(video).not.toBeChecked();
  expect(image).not.toBeChecked();
  fireEvent.click(video);
  fireEvent.click(image);
  const confirm = within(dialog).getByRole("button", { name: "Add selected" });
  expect(confirm).toHaveAttribute("data-agent-element", "widget-media-picker-add");
  fireEvent.click(confirm);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Video file" })).toHaveAttribute("data-glyph", "play");
  expect(savedConfig()).toEqual({ mode: "media", layout: "grid", items: [{ slug: "instructions" }, { slug: "ink-animation" }, { slug: "sweet-pea" }] });
});

it("inserts selected audio and image snippets at the Raw HTML selection and restores focus and caret", async () => {
  renderEditor({ mode: "html", html: "headREPLACEtail" });
  const source = screen.getByRole("textbox", { name: "HTML source" });
  if (!(source instanceof HTMLTextAreaElement)) throw new Error("expected HTML textarea");
  source.focus();
  source.setSelectionRange(4, 11);
  const openPicker = screen.getByRole("button", { name: "Insert media…" });
  openPicker.focus();
  fireEvent.click(openPicker);
  const dialog = screen.getByRole("dialog", { name: "Choose media" });
  fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Wind chime" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Sweet pea" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add selected" }));
  const inserted = '<audio data-media-slug="wind-chime" controls></audio>\n<img data-media-slug="sweet-pea" alt="Sweet pea alt">';

  expect(savedConfig()).toEqual({ mode: "html", html: `head${inserted}tail` });
  expect(source).toHaveValue(`head${inserted}tail`);
  expect(source).toHaveFocus();
  expect([source.selectionStart, source.selectionEnd]).toEqual([4 + inserted.length, 4 + inserted.length]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("appends at the end when no textarea is attached and skips a selected asset that left the library", () => {
  const stillAvailable = asset("kept", "Kept", "image/png");
  const removed = asset("removed", "Removed", "video/mp4");
  const port = { listMedia: async () => ({ media: [] }), mediaOriginalUrl: () => "/unused" };
  const { result, rerender } = renderHook(({ items }) => {
    const [config, onChange] = useState<Config>({ mode: "html", html: "<hr>" });
    return useMediaContentEditor({ config, onChange, widgetType: "media", port, locale: "en", useEffect, useMemo, useRef, useState, acceptedMediaItems, acceptsMedia,
      useMediaPickerItems: () => ({ items, error: null }),
    });
  }, { initialProps: { items: [stillAvailable, removed] } });

  act(() => result.current.openPicker({ target: "html" }));
  act(() => result.current.togglePicked({ slug: "removed" }));
  act(() => result.current.togglePicked({ slug: "kept" }));
  rerender({ items: [stillAvailable] });
  act(() => result.current.confirmPicker());

  expect(result.current.html).toBe('<hr><img data-media-slug="kept" alt="Kept alt">');
  expect(result.current.picker).toBeNull();
});

it("disables both adding methods at the 50-item limit without changing the stored rows", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({ slug: `asset-${index}` }));
  const { changes } = renderEditor({ mode: "media", layout: "grid", items }, () => new Promise(() => {}));

  expect(screen.getByRole("button", { name: "Choose from library" })).toBeDisabled();
  expect(screen.getByLabelText("Add by slug")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  expect(screen.getByText("50 / 50")).toBeVisible();
  expect(changes).not.toHaveBeenCalled();
});

it("does not emit a configuration write for a move already at an editor boundary", () => {
  const onChange = vi.fn();
  const config = { mode: "media", items: [{ slug: "edge" }] };
  const { result } = renderHook(() => useMediaContentEditor({
    config, onChange, widgetType: "media", locale: "en", acceptedMediaItems, acceptsMedia,
    useEffect, useMemo, useRef, useState, useMediaPickerItems: () => ({ items: null, error: null }),
    port: { listMedia: async () => ({ media: [] }), mediaOriginalUrl: () => "/unused" },
  }));

  act(() => result.current.moveItem({ index: 0, delta: -1 }));
  expect(result.current.rows.map(({ item }) => item.slug)).toEqual(["edge"]);
  expect(onChange).not.toHaveBeenCalled();
});
