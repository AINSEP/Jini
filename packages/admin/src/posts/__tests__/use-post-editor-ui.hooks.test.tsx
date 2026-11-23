// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { ToolbarOverflowMenu } from "../editor/toolbar/ToolbarOverflowMenu.js";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { primaryControlsThatFit, usePostEditorUi, usePostPreviewIframeEscape, usePostSettingsDialog, useToolbarOverflow } from "../hooks/use-post-editor-ui.hooks.js";

afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll("iframe").forEach((node) => node.remove()); });

// Author Checklist: F2.3/F2.5/F6.2/F7.6. Real hooks and DOM listeners, exact callback
// payloads, state readback, and rerender/unmount controls. Source mutations are forbidden.
it("saves with the requested status and opens and closes each dialog independently", async () => {
  // Reject: onPublish calls save() or cancel sets true instead of false.
  const save = vi.fn(async (_input: Record<string, never>, _options?: { statusOverride?: "draft" | "published" }) => {});
  const { result } = renderHook(() => {
    const [deleting, setConfirmingDelete] = useState(false);
    const [template, setShowTemplateModal] = useState(false);
    const [, setConfirmingUnchangedSave] = useState(false);
    return { deleting, template, ...usePostEditorUi({ save, setConfirmingDelete, setShowTemplateModal, dirty: true, setConfirmingUnchangedSave }) };
  });
  await act(async () => { await result.current.onPublish(); });
  await act(async () => { await result.current.onSave(); });
  expect(save.mock.calls).toEqual([[{}, { statusOverride: "published" }], [{}]]);
  act(() => result.current.onDeleteClick());
  expect([result.current.deleting, result.current.template]).toEqual([true, false]);
  act(() => result.current.onDeleteCancel());
  act(() => result.current.onViewTemplateClick());
  expect([result.current.deleting, result.current.template]).toEqual([false, true]);
  act(() => result.current.onCloseTemplateModal());
  expect([result.current.deleting, result.current.template]).toEqual([false, false]);
});

// Owner, 2026-10-10: Save is never disabled. With nothing changed it opens a warning instead of
// saving; "Save anyway" closes it and saves (the server writes nothing if it's truly identical).
it("with nothing changed, Save opens the warning; Save anyway saves once; Cancel saves nothing", async () => {
  const save = vi.fn(async (_input: Record<string, never>, _options?: { statusOverride?: "draft" | "published" }) => {});
  const { result } = renderHook(() => {
    const [, setConfirmingDelete] = useState(false);
    const [, setShowTemplateModal] = useState(false);
    const [warning, setConfirmingUnchangedSave] = useState(false);
    return { warning, ...usePostEditorUi({ save, setConfirmingDelete, setShowTemplateModal, dirty: false, setConfirmingUnchangedSave }) };
  });
  act(() => { void result.current.onSave(); });
  expect(result.current.warning).toBe(true);
  expect(save).not.toHaveBeenCalled();
  act(() => result.current.onUnchangedSaveCancel());
  expect(result.current.warning).toBe(false);
  expect(save).not.toHaveBeenCalled();
  act(() => { void result.current.onSave(); });
  await act(async () => { result.current.onUnchangedSaveConfirm(); });
  expect(result.current.warning).toBe(false);
  expect(save.mock.calls).toEqual([[{}]]);
});

it("rebinds Escape after frame navigation and callback changes, and detaches on collapse and unmount", async () => {
  // Reject: omit old-document removal, expanded gating, load listener or callback dependency.
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const firstDocument = frame.contentDocument!;
  const first = vi.fn();
  const second = vi.fn();
  const { result, rerender, unmount } = renderHook(({ expanded, collapse }) => usePostPreviewIframeEscape({ expanded: expanded, onCollapse: collapse }), {
    initialProps: { expanded: false, collapse: first },
  });
  act(() => result.current(frame));
  const key = (doc: Document, value = "Escape") => act(() => { doc.dispatchEvent(new KeyboardEvent("keydown", { key: value })); });
  key(firstDocument);
  expect(first).not.toHaveBeenCalled();
  rerender({ expanded: true, collapse: first });
  key(firstDocument, "Enter");
  expect(first).not.toHaveBeenCalled();
  key(firstDocument);
  expect(first.mock.calls).toEqual([[]]);
  // F3.5: let jsdom replace the iframe document and deliver its real load event.
  // about:blank needs no network or listening port.
  const navigated = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  await act(async () => { frame.src = "about:blank"; await navigated; });
  const nextDocument = frame.contentDocument!;
  expect(nextDocument).not.toBe(firstDocument);
  key(firstDocument);
  expect(first.mock.calls).toEqual([[]]);
  key(nextDocument);
  expect(first.mock.calls).toEqual([[], []]);
  rerender({ expanded: true, collapse: second });
  key(nextDocument);
  expect(second.mock.calls).toEqual([[]]);
  expect(first.mock.calls).toEqual([[], []]);
  rerender({ expanded: false, collapse: second });
  act(() => { frame.dispatchEvent(new Event("load")); });
  key(nextDocument);
  expect(second.mock.calls).toEqual([[]]);
  rerender({ expanded: true, collapse: second });
  key(nextDocument);
  expect(second.mock.calls).toEqual([[], []]);
  unmount();
  act(() => { frame.dispatchEvent(new Event("load")); });
  key(nextDocument);
  expect(second.mock.calls).toEqual([[], []]);
});

it("tolerates an inaccessible frame document and binds when a same-origin document becomes available", () => {
  // Reject: remove the nullable-document guards.
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const getter = vi.spyOn(frame, "contentDocument", "get").mockReturnValue(null);
  const collapse = vi.fn();
  const { result } = renderHook(() => usePostPreviewIframeEscape({ expanded: true, onCollapse: collapse }));
  act(() => result.current(frame));
  act(() => { doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(collapse).not.toHaveBeenCalled();
  getter.mockReturnValue(doc);
  act(() => { frame.dispatchEvent(new Event("load")); });
  act(() => { doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(collapse.mock.calls).toEqual([[]]);
});

it("starts the toolbar overflow closed and toggles it open and closed again", () => {
  // Reject: starts open (phones would show every control again) or toggle only ever opens.
  const { result } = renderHook(() => useToolbarOverflow());
  expect(result.current.open).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.open).toBe(true);
  act(() => result.current.toggle());
  expect(result.current.open).toBe(false);
});

it("keeps More on the top row by moving the lowest-ranked controls into the overflow", () => {
  // Reject: More's own width or the gaps are left out (More wraps), or controls drop from the front.
  const widths = [44, 44, 44, 44, 44, 60];
  expect(primaryControlsThatFit({ available: 263, widths, moreWidth: 44, gap: 2 })).toBe(4);
  expect(primaryControlsThatFit({ available: 275, widths, moreWidth: 44, gap: 2 })).toBe(5);
  expect(primaryControlsThatFit({ available: 335, widths, moreWidth: 44, gap: 2 })).toBe(5);
  expect(primaryControlsThatFit({ available: 336, widths, moreWidth: 44, gap: 2 })).toBe(6);
  expect(primaryControlsThatFit({ available: 40, widths, moreWidth: 44, gap: 2 })).toBe(0);
});

it("measures a narrow toolbar and marks only the controls that fit as primary", () => {
  // Reject: the hook ignores the measured width (all six stay primary) or keeps a hidden control's 0 width.
  let notify: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  const toolbar = document.createElement("div");
  toolbar.style.paddingLeft = "8px";
  toolbar.style.paddingRight = "8px";
  toolbar.style.columnGap = "2px";
  const sized = (element: HTMLElement, width: () => number) => Object.defineProperty(element, "offsetWidth", { configurable: true, get: width });
  const ranked = [44, 44, 44, 44, 44, 60].map((width, rank) => {
    const button = document.createElement("button");
    button.dataset.tbRank = String(rank);
    sized(button, () => (button.dataset.hidden ? 0 : width));
    toolbar.append(button);
    return button;
  });
  const more = document.createElement("button");
  more.dataset.toolbarMore = "";
  sized(more, () => 44);
  toolbar.append(more);
  document.body.append(toolbar);
  let clientWidth = 280;
  Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => clientWidth });

  const { result } = renderHook(() => useToolbarOverflow());
  act(() => result.current.toolbarRef(toolbar));
  const primaries = () => ranked.map((_, rank) => result.current.slot({ rank: rank })["data-tb"] === "primary");
  expect(primaries()).toEqual([true, true, true, true, false, false]);
  expect(result.current.slot({ rank: 4 })).toEqual({ "data-tb-rank": 4, "data-tb": undefined });

  // The demoted controls are now display:none (0 wide); widening uses their remembered widths.
  ranked[4]!.dataset.hidden = ranked[5]!.dataset.hidden = "1";
  clientWidth = 360;
  act(() => notify());
  expect(primaries()).toEqual([true, true, true, true, true, true]);
  toolbar.remove();
  vi.unstubAllGlobals();
});

it("finds the real Jini overflow toggle at phone width and demotes what no longer fits beside it", () => {
  // Pins the component/hook contract: the hook must locate the button `ToolbarOverflowMenu` actually
  // renders. Reject: the hook queries a selector the button no longer carries (e.g. the old `.tb-more`
  // class), so More reads as hidden and all six controls stay primary, wrapping More off the row.
  vi.stubGlobal("ResizeObserver", undefined);
  const toolbar = document.createElement("div");
  toolbar.style.paddingLeft = toolbar.style.paddingRight = "8px";
  toolbar.style.columnGap = "2px";
  [44, 44, 44, 44, 44, 60].forEach((width, rank) => {
    const button = document.createElement("button");
    button.dataset.tbRank = String(rank);
    Object.defineProperty(button, "offsetWidth", { value: width });
    toolbar.append(button);
  });
  document.body.append(toolbar);
  const host = document.createElement("span");
  toolbar.append(host);
  render(<ToolbarOverflowMenu overflow={{ open: false, toggle: () => {} }} t={(text: string) => text} />, { container: host });
  Object.defineProperty(host.querySelector("button")!, "offsetWidth", { value: 44 });
  Object.defineProperty(toolbar, "clientWidth", { value: 280 });
  const { result, unmount } = renderHook(() => useToolbarOverflow());
  try {
    act(() => result.current.toolbarRef(toolbar));
    expect(Array.from({ length: 6 }, (_, rank) => result.current.slot({ rank: rank })["data-tb"]))
      .toEqual(["primary", "primary", "primary", "primary", undefined, undefined]);
  } finally {
    unmount();
    toolbar.remove();
    vi.unstubAllGlobals();
  }
});

it("retains the chosen settings tab when the dialog is reopened", () => {
  const { result } = renderHook(() => usePostSettingsDialog());
  expect([result.current.open, result.current.tab]).toEqual([false, "author"]);
  act(() => result.current.openDialog());
  act(() => result.current.setTab("publish"));
  expect([result.current.open, result.current.tab]).toEqual([true, "publish"]);
  act(() => result.current.closeDialog());
  expect([result.current.open, result.current.tab]).toEqual([false, "publish"]);
  act(() => result.current.openDialog());
  expect([result.current.open, result.current.tab]).toEqual([true, "publish"]);
});

it.each(["absent", "hidden"])("keeps all controls primary when More is %s and ResizeObserver is unavailable", (visibility) => {
  vi.stubGlobal("ResizeObserver", undefined);
  try {
    const toolbar = document.createElement("div");
    if (visibility === "hidden") {
      const more = document.createElement("button");
      more.dataset.toolbarMore = "";
      toolbar.append(more); // jsdom reports offsetWidth 0, as display:none does in the browser.
    }
    const { result, unmount } = renderHook(() => useToolbarOverflow());
    act(() => result.current.toolbarRef(toolbar));
    expect(Array.from({ length: 6 }, (_, rank) => result.current.slot({ rank: rank })["data-tb"]))
      .toEqual(["primary", "primary", "primary", "primary", "primary", "primary"]);
    unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("measures an initially hidden control on its first appearance with no column gap", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  try {
    const toolbar = document.createElement("div");
    toolbar.style.paddingLeft = toolbar.style.paddingRight = "0px";
    toolbar.style.columnGap = "normal";
    Object.defineProperty(toolbar, "clientWidth", { value: 101 });
    const more = document.createElement("button");
    more.dataset.toolbarMore = "";
    Object.defineProperty(more, "offsetWidth", { value: 40 });
    const control = document.createElement("button");
    control.dataset.tbRank = "0";
    let width = 0;
    Object.defineProperty(control, "offsetWidth", { get: () => width });
    toolbar.append(control, more);
    const { result, unmount } = renderHook(() => useToolbarOverflow());
    act(() => result.current.toolbarRef(toolbar));
    expect(result.current.slot({ rank: 0 })["data-tb"]).toBe("primary");

    width = 80;
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(result.current.slot({ rank: 0 })["data-tb"]).toBeUndefined();
    unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("cleans up an opaque preview and ignores navigation after unmount", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  vi.spyOn(frame, "contentDocument", "get").mockReturnValue(null);
  const collapse = vi.fn();
  const { result, unmount } = renderHook(() => usePostPreviewIframeEscape({ expanded: true, onCollapse: collapse }));
  act(() => result.current(frame));
  unmount();
  frame.dispatchEvent(new Event("load"));
  doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(collapse).not.toHaveBeenCalled();
});
