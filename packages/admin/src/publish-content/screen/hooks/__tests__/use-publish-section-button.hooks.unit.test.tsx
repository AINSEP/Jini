// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePublishSectionButton, type PublishSectionButtonHost } from "../use-publish-section-button.hooks.js";

/**
 * @file The section button's hook: label from the host's table through the host's dictionary in the
 * host's locale, visibility from the host's publish-to-live flag, and a click that only asks the
 * host's request store to open the dialog scoped to the section's whole entity-type set.
 */

function makeHost(overrides: Partial<PublishSectionButtonHost> = {}): PublishSectionButtonHost {
  return {
    useLocale: () => "es",
    usePublishToLiveAvailable: () => true,
    sectionById: ({ id }) => (id === "collections" ? { labelKey: "Publish collections", entityTypes: ["content-type", "collection-entry"] } : undefined),
    translate: ({ locale, key }) => `${locale}:${key}`,
    requestPublish: vi.fn(),
    ...overrides,
  };
}

describe("usePublishSectionButton", () => {
  it("labels the button in the host locale and opens the dialog scoped to the whole section", () => {
    const host = makeHost();
    const { result } = renderHook(() => usePublishSectionButton({ section: "collections", host }));
    expect(result.current.visible).toBe(true);
    expect(result.current.label).toBe("es:Publish collections");
    result.current.onClick();
    expect(host.requestPublish).toHaveBeenCalledWith({}, { entityTypes: ["content-type", "collection-entry"] });
  });

  it("is hidden when the host says there is nowhere to publish to", () => {
    const host = makeHost({ usePublishToLiveAvailable: () => false });
    const { result } = renderHook(() => usePublishSectionButton({ section: "collections", host }));
    expect(result.current.visible).toBe(false);
  });

  it("throws for a section the host table does not have", () => {
    const host = makeHost();
    expect(() => renderHook(() => usePublishSectionButton({ section: "nope", host }))).toThrow("publish section nope is missing");
  });
});
