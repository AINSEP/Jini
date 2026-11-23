import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERACTIVE_FLUSH_TIMEOUT_MS,
  useInteractiveEditorFlush,
} from "../hooks/use-interactive-flush.hooks";

/**
 * @file `useInteractiveEditorFlush` — the failure arms. Every Save, Publish, "Save anyway", tab switch
 * and template change awaits this flush, so a flush that rejects or never settles must not block any
 * of them: it resolves `undefined` (the caller falls back to the working copy it already has) and
 * says so on the console. A flush that settles after the timeout must NOT write into `html` late —
 * by then the operator may be typing in the HTML tab's textarea, and a late write would clobber it.
 */
describe("useInteractiveEditorFlush — a rejected or hanging flush never blocks its caller", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("resolves the flushed HTML and writes it into html", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    result.current.interactiveEditorRef.current = { flush: vi.fn(async () => "<p>typed</p>") };

    let flushed: string | undefined;
    await act(async () => {
      flushed = await result.current.flushInteractiveEdits();
    });

    expect(flushed).toBe("<p>typed</p>");
    expect(setHtml).toHaveBeenCalledWith("<p>typed</p>");
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves undefined with no editor mounted, without writing", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));

    await expect(result.current.flushInteractiveEdits()).resolves.toBeUndefined();
    expect(setHtml).not.toHaveBeenCalled();
  });

  it("a rejected flush resolves undefined and warns", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    result.current.interactiveEditorRef.current = { flush: vi.fn(async () => Promise.reject(new Error("boom"))) };

    await expect(result.current.flushInteractiveEdits()).resolves.toBeUndefined();
    expect(setHtml).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[useInteractiveEditorFlush] flush failed; saving the working copy without the open edit",
      expect.any(Error),
    );
  });

  it("a flush that never settles resolves undefined after the timeout and warns", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    result.current.interactiveEditorRef.current = { flush: vi.fn(() => new Promise<string>(() => {})) };

    let settled = false;
    let flushed: string | undefined = "unset";
    void result.current.flushInteractiveEdits().then((v) => {
      settled = true;
      flushed = v;
    });
    await vi.advanceTimersByTimeAsync(INTERACTIVE_FLUSH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(true);
    expect(flushed).toBeUndefined();
    expect(setHtml).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      `[useInteractiveEditorFlush] flush did not settle within ${INTERACTIVE_FLUSH_TIMEOUT_MS}ms; continuing without the open edit`,
    );
  });

  it("a flush that settles after the timeout never writes into html late", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    let resolveLate!: (html: string) => void;
    result.current.interactiveEditorRef.current = {
      flush: vi.fn(() => new Promise<string>((r) => (resolveLate = r))),
    };

    const pending = result.current.flushInteractiveEdits();
    await vi.advanceTimersByTimeAsync(INTERACTIVE_FLUSH_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();

    resolveLate("<p>late</p>");
    await vi.advanceTimersByTimeAsync(0);
    expect(setHtml).not.toHaveBeenCalled();
  });
});

/**
 * The canvas (GrapesJS) serializes `data-embed-config='{"type":…}'` as
 * `data-embed-config="{&quot;type&quot;:…}"`. Everything the canvas hands back into the working copy
 * (a flush, and every `onChange`) comes back in the readable single-quoted form, so the HTML tab and
 * the saved page show what was authored.
 */
describe("useInteractiveEditorFlush — canvas output keeps embed markers readable", () => {
  const CANVAS = `<div data-embed-config="{&quot;type&quot;:&quot;widget&quot;,&quot;slug&quot;:&quot;contact-form&quot;}"></div>`;
  const READABLE = `<div data-embed-config='{"type":"widget","slug":"contact-form"}'></div>`;

  it("a flush writes and resolves the readable form", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    result.current.interactiveEditorRef.current = { flush: vi.fn(async () => CANVAS) };

    let flushed: string | undefined;
    await act(async () => {
      flushed = await result.current.flushInteractiveEdits();
    });

    expect(flushed).toBe(READABLE);
    expect(setHtml).toHaveBeenCalledWith(READABLE);
  });

  it("setHtmlFromCanvas (the editor's onChange) writes the readable form", () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));

    act(() => result.current.setHtmlFromCanvas(`<p>x</p>${CANVAS}`));

    expect(setHtml).toHaveBeenCalledWith(`<p>x</p>${READABLE}`);
  });
});

describe("scriptblocks source integrity flush", () => {
  it("propagates a source error without writing a shell or treating it as an RTE timeout", async () => {
    const { EditorSourceError } = await import("@jini-ai/ui/html-editor");
    const setHtml = vi.fn();
    const error = new EditorSourceError();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    result.current.interactiveEditorRef.current = { flush: async () => { throw error; } };
    await expect(result.current.flushInteractiveEdits()).rejects.toBe(error);
    expect(setHtml).not.toHaveBeenCalled();
  });
  it("keeps the approved frontend embed quote normalization inside retained blocks", async () => {
    const setHtml = vi.fn();
    const { result } = renderHook(() => useInteractiveEditorFlush({ setHtml }));
    const input = '<section data-kui><div data-embed-config="{&quot;type&quot;:&quot;widget&quot;,&quot;slug&quot;:&quot;contact&quot;}"></div></section>';
    result.current.interactiveEditorRef.current = { flush: async () => input };
    await expect(result.current.flushInteractiveEdits()).resolves.toBe(`<section data-kui><div data-embed-config='{"type":"widget","slug":"contact"}'></div></section>`);
    expect(setHtml).toHaveBeenCalledWith(`<section data-kui><div data-embed-config='{"type":"widget","slug":"contact"}'></div></section>`);
  });
});
