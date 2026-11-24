// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findEditorBlockOpening } from "@jini-ai/ui/html-editor";
import { measureTextareaCaretTop, useEditorHtmlJump } from "../hooks/use-editor-html-jump.hooks.js";

const textareas: HTMLTextAreaElement[] = [];
afterEach(() => {
  textareas.splice(0).forEach(node => node.remove());
  vi.restoreAllMocks();
});
const source = '\n<p>before</p>\n<div id="same" data-kui title="a > b"></div>\n<div id="same" data-kui title="a > b"></div>';
function harness(flush: () => Promise<string | undefined> = async () => source, measureCaretTop?: typeof measureTextareaCaretTop) {
  const setView = vi.fn();
  const setDraftHtml = vi.fn();
  const onError = vi.fn();
  const scrollTop = { current: 17 };
  const hook = renderHook(({ revision }) => useEditorHtmlJump({ html: source, contentRevision: revision, flush, setView, setDraftHtml, scrollTop, findEditorBlockOpening }, { onError, ...(measureCaretTop ? { measureCaretTop } : {}) }), { initialProps: { revision: 1 } });
  return { ...hook, setView, setDraftHtml, onError, scrollTop };
}
describe("locked block Edit HTML navigation", () => {
  it("uses the current HTML when flushing produces no replacement source", async () => {
    const { result, setDraftHtml, onError } = harness(async () => undefined);
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div", id: "same" }, {}); });
    expect(setDraftHtml).toHaveBeenCalledWith(source);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.consumeJumpFormatting()).toBe(true);
  });

  it("retains a pending jump across a null ref and consumes it only once a textarea mounts", async () => {
    const { result } = harness(async () => source, () => 125);
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div", id: "same" }, {}); });
    result.current.htmlTextareaRef(null);
    const node = document.createElement("textarea");
    node.value = source;
    document.body.append(node); textareas.push(node);
    result.current.htmlTextareaRef(node);
    expect(node.selectionStart).toBe(source.indexOf('<div id="same"'));
    expect(node.selectionEnd).toBe(source.indexOf('<div id="same"') + '<div id="same" data-kui title="a > b">'.length);
    expect(node.scrollTop).toBe(125);
  });

  it("clears a prepared selection and formatting exemption when the content revision changes", async () => {
    const { result, rerender } = harness();
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div", id: "same" }, {}); });
    rerender({ revision: 2 });
    const node = document.createElement("textarea");
    node.value = source;
    node.setSelectionRange(2, 4);
    result.current.htmlTextareaRef(node);
    expect(node.selectionStart).toBe(2);
    expect(node.selectionEnd).toBe(4);
    expect(node.scrollTop).toBe(17);
    expect(result.current.consumeJumpFormatting()).toBe(false);
  });

  it("estimates the caret position using the textarea's configured line height without layout", async () => {
    const { result, scrollTop } = harness(async () => source, () => null);
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 1, tagName: "div", id: "same" }, {}); });
    const node = document.createElement("textarea");
    node.value = source;
    node.style.lineHeight = "24px";
    Object.defineProperty(node, "clientHeight", { value: 30 });
    result.current.htmlTextareaRef(node);
    expect(node.scrollTop).toBe(62);
    expect(scrollTop.current).toBe(62);
  });

  it("uses the default line estimate for a document without a window", async () => {
    const { result } = harness();
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 1, tagName: "div", id: "same" }, {}); });
    const node = document.implementation.createHTMLDocument("detached").createElement("textarea");
    node.value = source;
    result.current.htmlTextareaRef(node);
    expect(node.ownerDocument.defaultView).toBeNull();
    expect(node.scrollTop).toBe(60);
    expect(node.selectionStart).toBe(source.lastIndexOf('<div id="same"'));
  });

  it("measures wrapped caret geometry with a styled mirror and removes the mirror afterwards", () => {
    const node = document.createElement("textarea");
    node.value = "first line\nwrapped content";
    node.style.fontSize = "18px";
    node.style.lineHeight = "27px";
    Object.defineProperty(node, "clientWidth", { value: 240 });
    let mirror: HTMLElement | undefined;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "DIV" && this.style.visibility === "hidden") { mirror = this; return 81; }
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "SPAN" ? 54 : 0;
    });
    expect(measureTextareaCaretTop({ node, index: 18 })).toBe(54);
    expect(mirror?.textContent).toBe("first line\nwrapped\u200b");
    expect(mirror?.style.width).toBe("240px");
    expect(mirror?.style.fontSize).toBe("18px");
    expect(mirror?.style.lineHeight).toBe("27px");
    expect(mirror?.isConnected).toBe(false);
  });

  it("flushes, selects the exact second opening tag and gives the jump priority over scroll memory", async () => {
    const flush = vi.fn(async () => source);
    const { result, setView, setDraftHtml, scrollTop } = harness(flush);
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 1, tagName: "div", id: "same" }, {}); });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith("html");
    expect(setDraftHtml).toHaveBeenCalledWith(source);
    expect(result.current.consumeJumpFormatting()).toBe(true);
    expect(result.current.consumeJumpFormatting()).toBe(false);
    const node = document.createElement("textarea");
    node.value = source;
    document.body.append(node); textareas.push(node);
    result.current.htmlTextareaRef(node);
    const opening = '<div id="same" data-kui title="a > b">';
    expect(node.selectionStart).toBe(source.lastIndexOf(opening));
    expect(node.selectionEnd).toBe(source.lastIndexOf(opening) + opening.length);
    expect(document.activeElement).toBe(node);
    expect(node.scrollTop).toBe(60);
    expect(scrollTop.current).toBe(60);
  });
  it("scrolls to the measured wrapped position of the tag, not a newline count", async () => {
    const measured: number[] = [];
    const { result, scrollTop } = harness(async () => source, ({ index }) => { measured.push(index); return 900; });
    await act(async () => { await result.current.requestEditHtml({ occurrenceIndex: 1, tagName: "div", id: "same" }, {}); });
    const node = document.createElement("textarea");
    node.value = source;
    document.body.append(node); textareas.push(node);
    result.current.htmlTextareaRef(node);
    expect(measured).toEqual([source.lastIndexOf('<div id="same"')]);
    expect(node.scrollTop).toBe(900);
    expect(scrollTop.current).toBe(900);
  });
  it("ordinary HTML entry restores scroll memory and does not seed a draft", () => {
    const { result, setDraftHtml } = harness();
    const node = document.createElement("textarea");
    node.value = source;
    result.current.htmlTextareaRef(node);
    expect(node.scrollTop).toBe(17);
    expect(setDraftHtml).not.toHaveBeenCalled();
    expect(result.current.consumeJumpFormatting()).toBe(false);
  });
  it("discards an async jump when the external source revision changes", async () => {
    let resolve!: (html: string) => void;
    const { result, rerender, setView, setDraftHtml } = harness(() => new Promise<string>(done => { resolve = done; }));
    let request!: Promise<void>;
    act(() => { request = Promise.resolve(result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div", id: "same" }, {})); });
    rerender({ revision: 2 });
    await act(async () => { resolve(source); await request; });
    expect(setView).not.toHaveBeenCalled();
    expect(setDraftHtml).not.toHaveBeenCalled();
  });
  it("does not guess a missing occurrence or replace the source on a flush error", async () => {
    const missing = harness();
    await act(async () => { await missing.result.current.requestEditHtml({ occurrenceIndex: 9, tagName: "div", id: "same" }, {}); });
    expect(missing.onError).toHaveBeenCalledTimes(1);
    expect(missing.setView).not.toHaveBeenCalled();
    const failed = harness(async () => { throw new Error("source metadata missing"); });
    await act(async () => { await failed.result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div" }, {}); });
    expect(failed.onError).toHaveBeenCalledTimes(1);
    expect(failed.setDraftHtml).not.toHaveBeenCalled();
  });
  it("hands the host the flush error it caught, and nothing for a missing occurrence", async () => {
    const thrown = new Error("source metadata missing");
    const failed = harness(async () => { throw thrown; });
    await act(async () => { await failed.result.current.requestEditHtml({ occurrenceIndex: 0, tagName: "div" }, {}); });
    expect(failed.onError).toHaveBeenCalledWith(thrown);
    const missing = harness();
    await act(async () => { await missing.result.current.requestEditHtml({ occurrenceIndex: 9, tagName: "div", id: "same" }, {}); });
    expect(missing.onError).toHaveBeenCalledWith();
  });
});
