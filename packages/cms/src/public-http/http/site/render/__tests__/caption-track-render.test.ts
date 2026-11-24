import { describe, expect, it } from "vitest";
import { renderWidgetMediaImage } from "../widgets/media.js";
import { renderDocMedia } from "../doc/nodes-media.js";
import { renderVideoTag } from "../../../../../widgets/media-tags.js";
import type { WidgetMediaHost } from "../widgets/widget-render-contract.js";
import type { DocNodeHandlerRequired } from "../doc/doc-render-contract.js";

/**
 * G7-9 caption tracks through both public renderers. The host's `renderVideoTag` is the REAL one
 * (it owns the same-origin `.vtt` guard); only path building is stubbed. The resolver stage put the
 * resolved track on the widget IR props / the doc node's asset render meta.
 */
const media = {
  renderImageTag: () => "<img-stub>",
  renderVideoTag,
  mediaPublicPath: (args: { key: string; variant: { kind: string } }) => `/m/${args.key}/original.mp4`,
  mediaUrlKey: (args: { id: string }) => args.id,
  plausibleMediaRefId: ({ value }: { value: unknown }) => (typeof value === "string" && /^[a-z0-9-]+$/.test(value) ? value : undefined),
};
const widgetHost = { media, noMarkerAttributes: [] } as unknown as WidgetMediaHost;
const TRACK = { src: "/m/clip-cc/original.vtt", srclang: "en", label: "English" };
const TRACK_TAG = '<track kind="captions" src="/m/clip-cc/original.vtt" srclang="en" label="English" default>';

function docMedia(captionsTrack: unknown): string {
  const meta = { width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "video/mp4", slug: null, ...(captionsTrack === undefined ? {} : { captionsTrack }) };
  const deps = { host: { classes: { mediaPlaceholder: "ph" }, media }, mediaAssetMetadata: new Map([["clip", meta]]) };
  return renderDocMedia({ node: { type: "media", attrs: { assetId: "clip" } }, deps } as unknown as DocNodeHandlerRequired);
}

describe("caption tracks in the public media renderers", () => {
  it("a widget video with a resolved captions track renders the <track>; without one it does not", () => {
    const props = { assetId: "clip", contentType: "video/mp4" };
    expect(renderWidgetMediaImage({ props: { ...props, captionsTrack: TRACK }, host: widgetHost })).toContain(TRACK_TAG);
    expect(renderWidgetMediaImage({ props, host: widgetHost })).not.toContain("<track");
    expect(renderWidgetMediaImage({ props: { ...props, captionsTrack: null }, host: widgetHost })).not.toContain("<track");
  });

  it("a doc media node with a captions track renders the <track>; without one it does not", () => {
    expect(docMedia(TRACK)).toContain(TRACK_TAG);
    expect(docMedia(undefined)).not.toContain("<track");
    expect(docMedia(null)).not.toContain("<track");
  });

  it("a non-vtt, cross-origin or malformed track is never emitted by either renderer", () => {
    const unsafe = [
      { src: "/m/clip-cc/original.srt", srclang: "en" },
      { src: "https://evil.example/m/x/original.vtt", srclang: "en" },
      { src: "//evil.example/m/x/original.vtt", srclang: "en" },
      { src: "javascript:alert(1)//.vtt", srclang: "en" },
      { src: 42, srclang: "en" },
      "not-an-object",
    ];
    for (const captionsTrack of unsafe) {
      expect(renderWidgetMediaImage({ props: { assetId: "clip", contentType: "video/mp4", captionsTrack } as never, host: widgetHost })).not.toContain("<track");
      expect(docMedia(captionsTrack)).not.toContain("<track");
    }
  });
});
