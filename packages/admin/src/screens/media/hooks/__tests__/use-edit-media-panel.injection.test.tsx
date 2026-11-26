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
  const embedPolicy = {
    allowedAttributeNames: [], isAllowedAttributeName: () => false,
    parseAttributes: () => ({ attributes: {}, errors: [{ reason: "disallowed-name" as const, attribute: "host-attribute" }],
      error: { reason: "disallowed-name" as const, attribute: "host-attribute" } }),
  };
  const useBoundEditMediaPanel = bindEditMediaPanel({
    hooks: { useFetchMutation, useFetchQuery, useLocaleHook: () => "en" },
    deps: { port, translate: ({ key }) => key, describeApiError: ({ fallback }) => fallback,
      embedMarkerSnippet: () => "embed", embedPolicy, parseMediaHtmlAttributes: parser,
      writeText: async () => {}, setTimeout: globalThis.setTimeout },
  });
  const { result } = renderHook(() => useBoundEditMediaPanel({ item, onSaved: vi.fn(), onCancel: vi.fn() }), { wrapper: FetchQueryProvider });
  expect(parser).toHaveBeenLastCalledWith({ text: "", policy: embedPolicy });
  act(() => result.current.setHtmlAttributes('host-attribute="value"'));
  expect(parser).toHaveBeenLastCalledWith({ text: 'host-attribute="value"', policy: embedPolicy });
  expect(result.current.htmlAttributesError).toContain("host-attribute");
});
