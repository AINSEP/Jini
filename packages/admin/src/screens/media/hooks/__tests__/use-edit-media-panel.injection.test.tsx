// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { bindEditMediaPanel } from "../use-edit-media-panel.hooks.js";
import { createFakeMediaPort } from "../fake-media-port.js";
import { parseMediaHtmlAttributes } from "../../../../media/html-attributes.js";

afterEach(cleanup);

it("parses the live draft with the host parser and embed policy", async () => {
  const port = createFakeMediaPort();
  const { media: item } = await port.uploadMedia({ filename: "one.png", contentType: "image/png", dataBase64: "AA==" });
  const parser = vi.fn(parseMediaHtmlAttributes);
  const draft = 'host-attribute="value"';
  const error = { reason: "disallowed-name" as const, attribute: "host-attribute" };
  const embedPolicy = {
    allowedAttributeNames: [], isAllowedAttributeName: () => false,
    parseAttributes: ({ text }: { text: string }) => text === draft
      ? { attributes: {}, errors: [error], error }
      : { attributes: {}, errors: [], error: null },
  };
  const useBoundEditMediaPanel = bindEditMediaPanel({
    hooks: { useFetchMutation, useFetchQuery, useLocaleHook: () => "en" },
    deps: { port, translate: ({ key }) => key, describeApiError: ({ fallback }) => fallback,
      embedMarkerSnippet: () => "embed", embedPolicy, parseMediaHtmlAttributes: parser,
      writeText: async () => {}, setTimeout: globalThis.setTimeout },
  });
  const { result } = renderHook(() => useBoundEditMediaPanel({ item, onSaved: vi.fn(), onCancel: vi.fn() }), { wrapper: FetchQueryProvider });
  expect(parser).toHaveBeenLastCalledWith({ text: "", policy: embedPolicy });
  expect(result.current.htmlAttributesError).toBeNull();
  act(() => result.current.setHtmlAttributes(draft));
  expect(parser).toHaveBeenLastCalledWith({ text: draft, policy: embedPolicy });
  expect(result.current.htmlAttributesError).toBe("'host-attribute' is not an allowed HTML attribute.");
  act(() => result.current.setHtmlAttributes(""));
  expect(result.current.htmlAttributesError).toBeNull();
});

async function setupPanel(options: { publicUrl?: string; writeText?: (text: string) => Promise<void> } = {}) {
  const store = createFakeMediaPort();
  const { media } = await store.uploadMedia({ filename: "map.png", contentType: "image/png", dataBase64: "AA==" });
  const item = { ...media, publicUrl: options.publicUrl ?? null, createdBy: "unknown-key", cssClass: "old-class", htmlAttributes: 'title="Old"' };
  const port = createFakeMediaPort({ media: [item] });
  const updateMedia = vi.fn(port.updateMedia);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const writeText = vi.fn(options.writeText ?? (async (_value: string) => {}));
  const useBoundEditMediaPanel = bindEditMediaPanel({
    hooks: { useFetchMutation, useFetchQuery, useLocaleHook: () => "en" },
    deps: { port: { ...port, updateMedia }, translate: ({ key }) => key, describeApiError: ({ fallback }) => fallback,
      embedMarkerSnippet: ({ value }) => `media:${value}`,
      embedPolicy: { allowedAttributeNames: [], isAllowedAttributeName: () => false,
        parseAttributes: () => ({ attributes: {}, errors: [], error: null }) },
      parseMediaHtmlAttributes, writeText, setTimeout: globalThis.setTimeout },
  });
  const mounted = renderHook(() => useBoundEditMediaPanel({ item, onSaved, onCancel }), { wrapper: FetchQueryProvider });
  return { ...mounted, port, item, updateMedia, onSaved, onCancel, writeText };
}

it("closes a no-op draft without writing, then persists explicit clears for CSS class and HTML attributes", async () => {
  const { result, port, item, updateMedia, onCancel, onSaved } = await setupPanel();
  expect(result.current.createdByLabel).toBe("unknown-key");
  await act(() => result.current.save());
  expect(onCancel.mock.calls).toEqual([[]]);
  expect(updateMedia.mock.calls).toEqual([]);
  act(() => {
    result.current.setCssClass("   ");
    result.current.setHtmlAttributes(" ");
    result.current.setDescription(" ");
  });
  await act(() => result.current.save());
  expect(updateMedia.mock.calls).toEqual([[{ id: item.id }, { cssClass: null, htmlAttributes: null }]]);
  expect(onSaved.mock.calls).toEqual([[]]);
  expect((await port.listMedia()).media).toEqual([{ ...item, cssClass: null, htmlAttributes: null }]);
});

it("never writes a missing public URL and never shows copied for a denied clipboard operation", async () => {
  const messages = new Error("Clipboard permission denied");
  const absent = await setupPanel({ writeText: async () => { throw messages; } });
  await act(() => absent.result.current.copyUrl());
  expect(absent.writeText.mock.calls).toEqual([]);
  expect(absent.result.current.urlCopied).toBe(false);
  absent.unmount();

  const publicUrl = "https://public.example/map";
  const denied = await setupPanel({ publicUrl, writeText: async () => { throw messages; } });
  await act(async () => {
    await denied.result.current.copyUrl();
    await denied.result.current.copyEmbedCode();
    await denied.result.current.copyHash();
  });
  expect(denied.writeText.mock.calls).toEqual([[publicUrl], [`media:${denied.item.slug}`], [denied.item.sha256]]);
  expect([denied.result.current.urlCopied, denied.result.current.embedCopied, denied.result.current.hashCopied]).toEqual([false, false, false]);
});

it("expires each copy acknowledgement at 1500 ms without clearing a later acknowledgement early", async () => {
  vi.useFakeTimers();
  try {
    const { result, writeText, item, unmount } = await setupPanel({ publicUrl: "https://public.example/map" });
    await act(() => result.current.copyHash());
    expect(result.current.hashCopied).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    await act(() => result.current.copyUrl());
    await act(() => result.current.copyEmbedCode());
    expect([result.current.hashCopied, result.current.urlCopied, result.current.embedCopied]).toEqual([true, true, true]);
    expect(writeText.mock.calls).toEqual([[item.sha256], ["https://public.example/map"], [`media:${item.slug}`]]);
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current.hashCopied).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect([result.current.hashCopied, result.current.urlCopied, result.current.embedCopied]).toEqual([false, true, true]);
    act(() => { vi.advanceTimersByTime(1000); });
    expect([result.current.hashCopied, result.current.urlCopied, result.current.embedCopied]).toEqual([false, false, false]);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
