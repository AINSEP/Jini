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
