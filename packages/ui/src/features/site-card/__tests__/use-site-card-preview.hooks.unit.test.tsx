// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveSiteCardPreview, useSiteCardPreview, type SiteCardPreviewSnapshot } from "../use-site-card-preview.hooks.js";

/**
 * @file Site card preview: the injected address carries the capture version, a site without a
 * capture is a placeholder, and a failed image load falls back to it until a new capture changes the
 * URL. Literal values, no module mocks.
 */

const urlFor = ({ name, version }: { name: string; version: number }) => `${name}#${version}`;

describe("resolveSiteCardPreview", () => {
  it("builds the preview src through the host's address for the site's capture version", () => {
    expect(resolveSiteCardPreview({ site: { name: "atlas" }, snapshot: { previewVersions: { atlas: 7 } }, urlFor }))
      .toEqual({ src: "atlas#7" });
  });

  it("is a placeholder without a version for this site, or from an older server without the field", () => {
    expect(resolveSiteCardPreview({ site: { name: "boreal" }, snapshot: { previewVersions: { atlas: 7 } }, urlFor })).toEqual({ src: null });
    expect(resolveSiteCardPreview({ site: { name: "atlas" }, snapshot: {}, urlFor })).toEqual({ src: null });
  });
});

describe("useSiteCardPreview", () => {
  it("swaps a failed image for the placeholder until a new capture changes the URL", () => {
    const { result, rerender } = renderHook(
      ({ snapshot }: { snapshot: SiteCardPreviewSnapshot }) => useSiteCardPreview({ site: { name: "atlas" }, snapshot, urlFor }),
      { initialProps: { snapshot: { previewVersions: { atlas: 7 } } } },
    );
    expect(result.current.src).toBe("atlas#7");
    act(() => result.current.onError());
    expect(result.current.src).toBeNull();
    rerender({ snapshot: { previewVersions: { atlas: 7 } } });
    expect(result.current.src).toBeNull();
    rerender({ snapshot: { previewVersions: { atlas: 8 } } });
    expect(result.current.src).toBe("atlas#8");
  });
});
