import { describe, expect, it } from "vitest";
import { renderDocNodeWith, MAX_RENDER_DEPTH } from "../doc-nodes.js";
import type { DocNodeHost } from "../doc-render-contract.js";

/** Every host collaborator is a recording stub with a distinctive output, so each assertion proves
 *  the doc renderer routed through the INJECTED function rather than any built-in of its own. */
function stubHost(calls: string[] = []): DocNodeHost {
  return {
    media: {
      renderImageTag: (props) => { calls.push(`img:${props.src}`); return `<stub-img src="${props.src}" alt="${props.alt}" class="${props.cssClass ?? ""}"/>`; },
      renderVideoTag: (props) => { calls.push(`video:${props.src}`); return `<stub-${props.kind ?? "video"} src="${props.src}"/>`; },
      mediaPublicPath: (args) => `/stub-path/${args.key}/${args.variant.kind}`,
      mediaUrlKey: (args) => `key(${args.id},${args.slug ?? "-"})`,
      isPlausibleMediaRefId: ({ value }) => typeof value === "string" && /^[a-z0-9]+$/.test(value),
      plausibleMediaRefId: ({ value }) => (typeof value === "string" && /^[a-z0-9]+$/.test(value) ? value : undefined),
    },
    attributes: {
      resolveEmbedHtmlAttributes: () => ({ class: "attr-class", "data-x": "1" }),
      formatHtmlAttributes: ({ attributes }) => Object.entries(attributes).map(([k, v]) => ` ${k}="${v}"`).join(""),
      omitKey: ({ attributes, key }) => Object.fromEntries(Object.entries(attributes).filter(([k]) => k !== key)),
    },
    safeUrl: {
      safeImageSrc: ({ value }) => (value === "ok.png" ? "https://stub.example/ok.png" : null),
      extractYoutubeVideoId: ({ value }) => (value === "yt" ? "ABC123" : null),
    },
    classes: {
      mediaPlaceholder: { box: "host-ph", label: "host-ph-label" },
      contentPlaceholder: { box: "host-deep", label: "host-deep-label" },
      youtubeEmbed: "host-yt",
      postMention: "host-mention",
      widgetEmbed: "host-embed",
    },
  };
}

const renderWidget = (): string => "<widget/>";
const render = ({ node, host = stubHost() }: { node: unknown; host?: DocNodeHost }, options = {}): string =>
  renderDocNodeWith({ node: node as never, renderWidget, host }, options);

const META = new Map([["a1", { contentType: "image/png", width: null, height: null, cssClass: null, htmlAttributes: null, slug: null, sha256: undefined }]]);
const VERSIONS = new Map([["public", 3]]);

describe("doc node host injection", () => {
  it("ref image: the injected mediaUrlKey, mediaPublicPath and renderImageTag build the tag (media-ref-dep-ignored)", () => {
    const calls: string[] = [];
    const html = render({ node: { type: "image", attrs: { assetId: "a1", transformName: "public", alt: "A" } }, host: stubHost(calls) }, { mediaTransformVersions: VERSIONS, mediaAssetMetadata: META });
    expect(html).toBe('<stub-img src="/stub-path/key(a1,-)/transform" alt="A" class=""/>');
    expect(calls).toEqual(["img:/stub-path/key(a1,-)/transform"]);
  });

  it("media node with a video asset renders through the injected renderVideoTag and URL policy", () => {
    const meta = new Map([["a1", { contentType: "video/mp4", width: 1, height: 2, cssClass: null, htmlAttributes: null, slug: "s", sha256: undefined }]]);
    const html = render({ node: { type: "media", attrs: { assetId: "a1", transformName: "public" } } }, { mediaAssetMetadata: meta });
    expect(html).toBe('<stub-video src="/stub-path/key(a1,s)/original"/>');
  });

  it("media node with an audio asset renders an audio player", () => {
    const meta = new Map([["a1", { contentType: "audio/mpeg", width: null, height: null, cssClass: null, htmlAttributes: null, slug: null, sha256: undefined }]]);
    expect(render({ node: { type: "media", attrs: { assetId: "a1" } } }, { mediaAssetMetadata: meta })).toContain("<stub-audio");
  });

  it("a ref whose id the injected plausibility check rejects degrades to the host-classed placeholder", () => {
    const html = render({ node: { type: "media", attrs: { assetId: "../bad", alt: "" } } });
    expect(html).toBe('<figure class="host-ph" style="aspect-ratio:16 / 9"><span class="host-ph-label">Media</span></figure>');
  });

  it("legacy src image goes through the injected safeImageSrc and formatHtmlAttributes", () => {
    const html = render({ node: { type: "image", attrs: { src: "ok.png", alt: "x", title: "t" } } });
    expect(html).toBe('<img src="https://stub.example/ok.png" alt="x" title="t" loading="lazy" />');
    expect(render({ node: { type: "image", attrs: { src: "nope", alt: "x" } } })).toContain('class="host-ph"');
  });

  it("youtube uses the injected extractor and host class names", () => {
    expect(render({ node: { type: "youtube", attrs: { src: "yt", start: 5 } } })).toContain('<div class="host-yt"><iframe src="https://www.youtube-nocookie.com/embed/ABC123?start=5"');
    expect(render({ node: { type: "youtube", attrs: { src: "bad" } } })).toContain('class="host-ph"');
  });

  it("mention, widget wrapper and depth placeholder emit the host class names", () => {
    expect(render({ node: { type: "mention", attrs: { id: "a-post", label: "A" } } })).toBe('<a class="host-mention" href="/a-post">@A</a>');
    expect(render({ node: { type: "widgetEmbed", attrs: { placementId: "p", cssClass: "mine", htmlAttributes: "x" } } })).toBe('<div class="host-embed mine attr-class" data-x="1"><widget/></div>');
    expect(render({ node: { type: "paragraph" } }, { depth: MAX_RENDER_DEPTH + 1 })).toBe('<div class="host-deep"><span class="host-deep-label">Content too deeply nested to render</span></div>');
  });
});
