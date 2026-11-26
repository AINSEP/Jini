import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { MediaContentEditor, type MediaContentEditorProps } from "../MediaContentEditor.js";
import { useMediaContentEditor } from "../MediaContentEditor.hooks.js";

afterEach(cleanup);

const kit: MediaContentEditorProps["kit"] = {
  Icon: () => null,
  InfoTip: ({ label }) => <span>{label}</span>,
  DockHeaderTip: ({ children }) => <>{children}</>,
  Dialog: ({ children }) => <div>{children}</div>,
  DevicePreviewFrame: ({ children }) => <div>{children}</div>,
  HtmlAttributeRows: () => null,
};
const deps: MediaContentEditorProps["deps"] = {
  port: { listMedia: async () => ({ media: [] }), mediaOriginalUrl: ({ id }) => `/media/${id}` }, locale: "en",
  acceptsMedia: () => true,
  resolveTabBarTabIndex: ({ activeId, tab }) => activeId === tab.id ? 0 : -1,
};
const hooks: MediaContentEditorProps["hooks"] = {
  useEditor: useMediaContentEditor,
  useMediaPickerItems: () => ({ items: [], error: null }),
  useTabBarKeyboard: () => ({ onKeyDown: () => {} }),
  usePreview: ({ config }) => ({ loading: false, error: null, document: JSON.stringify(config), paneWidth: 400, frameRef: () => {} }),
};

test("structured edits retain the rest of the config and update preview", () => {
  function Editor() {
    const [config, onChange] = useState<Record<string, unknown>>({ mode: "media", layout: "grid", columns: 2, items: [{ slug: "one", alt: "original" }], cssClass: "custom" });
    return <MediaContentEditor widgetType="gallery" config={config} onChange={onChange} kit={kit} hooks={hooks} deps={deps} />;
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Alt text 1"), { target: { value: "edited" } });
  expect(JSON.parse(screen.getByTitle("Preview").getAttribute("srcdoc")!)).toEqual({ mode: "media", layout: "grid", columns: 2, items: [{ slug: "one", alt: "edited" }], cssClass: "custom" });
  expect(screen.getByText("Not in the media library")).toBeTruthy();
});

test("HTML edits preserve raw markup in config and preview, with keyboard tab wiring", () => {
  function Editor() {
    const [config, onChange] = useState<Record<string, unknown>>({ mode: "html", html: "<p>before</p>" });
    return <MediaContentEditor widgetType="media" config={config} onChange={onChange} kit={kit} hooks={hooks} deps={deps} />;
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("HTML source"), { target: { value: "<b>after</b>" } });
  expect(JSON.parse(screen.getByTitle("Preview").getAttribute("srcdoc")!)).toEqual({ mode: "html", html: "<b>after</b>" });
  expect(screen.getByRole("tab", { name: "Raw HTML" }).getAttribute("tabindex")).toBe("0");
  expect(screen.getByRole("tab", { name: "Media" }).getAttribute("tabindex")).toBe("-1");
});
