// @vitest-environment jsdom
import { useEffect, useMemo, useRef, useState } from "react";
import { acceptedMediaItems } from "../../../media/MediaPickerDialog/MediaPickerDialog.hooks.js";
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMediaContentEditor } from "../MediaContentEditor.hooks.js";

it("preserves the HTML and structured attributes across mode switches", () => {
  const port = { listMedia: async () => ({ media: [] }), mediaOriginalUrl: () => "/media" };
  const { result } = renderHook(() => {
    const [config, onChange] = useState<Record<string, unknown>>({ mode: "media", layout: "single", items: [], htmlAttributes: 'data-test="kept"' });
    return useMediaContentEditor({ useEffect, useMemo, useRef, useState, acceptedMediaItems, config, onChange, widgetType: "media", port, locale: "en",
      useMediaPickerItems: () => ({ items: [], error: null }), acceptsMedia: () => true,
    });
  });
  act(() => result.current.setMode({ mode: "html" }));
  act(() => result.current.setHtml({ html: "<p>Kept HTML</p>" }));
  act(() => result.current.setMode({ mode: "media" }));
  expect(result.current.media.htmlAttributes).toBe('data-test="kept"');
  act(() => result.current.setMode({ mode: "html" }));
  expect(result.current.html).toBe("<p>Kept HTML</p>");
});
