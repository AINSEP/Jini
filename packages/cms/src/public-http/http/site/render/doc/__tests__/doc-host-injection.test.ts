import { describe, expect, it, vi } from "vitest";
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

it("renders inert task checkboxes and nested document content without dropping structural nodes", () => {
  const text = (value: string) => ({ type: "text", text: value });
  const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
  expect(render({ node: { type: "doc", content: [
    { type: "taskList", content: [
      { type: "taskItem", attrs: { checked: true }, content: [paragraph("Done & filed")] },
      { type: "taskItem", attrs: { checked: false }, content: [paragraph("Next")] },
    ] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Bulleted")] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [paragraph("Ordered")] }] },
    { type: "blockquote", content: [paragraph("Quoted")] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [text("a < b")] },
    { type: "horizontalRule" },
    { type: "paragraph", content: [text("One"), { type: "hardBreak" }, text("Two")] },
  ] } })).toBe(
    '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox" checked disabled/><span></span></label><div><p>Done &amp; filed</p></div></li><li data-type="taskItem"><label><input type="checkbox" disabled/><span></span></label><div><p>Next</p></div></li></ul><ul><li><p>Bulleted</p></li></ul><ol><li><p>Ordered</p></li></ol><blockquote><p>Quoted</p></blockquote><pre><code class="language-ts">a &lt; b</code></pre><hr/><p>One<br/>Two</p>',
  );
});

it("inherits a managed image's asset attributes when the media node overrides only its class", () => {
  const host = stubHost();
  const mediaPublicPath = vi.fn<DocNodeHost["media"]["mediaPublicPath"]>(() => "/m/photo-7/public.v4/image.jpg");
  const renderImageTag = vi.fn<DocNodeHost["media"]["renderImageTag"]>(() => '<img src="/m/photo-7/public.v4/image.jpg" alt="Ridge"/>');
  const meta = new Map([["a7", {
    slug: "photo-7", sha256: "abcdef012345", contentType: "image/png", width: 640, height: 480,
    cssClass: "asset-class", htmlAttributes: 'title="Asset caption"',
  }]]);
  expect(render({
    node: { type: "media", attrs: { assetId: "a7", transformName: "public", alt: "Ridge", cssClass: "node-class", htmlAttributes: "" } },
    host: { ...host, media: { ...host.media, mediaPublicPath, renderImageTag } },
  }, { mediaTransformVersions: new Map([["public", 4]]), mediaAssetMetadata: meta })).toBe('<img src="/m/photo-7/public.v4/image.jpg" alt="Ridge"/>');
  expect(mediaPublicPath.mock.calls).toEqual([[{
    key: "key(a7,photo-7)", sha256: "abcdef012345", variant: { kind: "transform", name: "public", version: 4, ext: "jpg" },
  }]]);
  expect(renderImageTag.mock.calls).toEqual([[{
    src: "/m/photo-7/public.v4/image.jpg", alt: "Ridge", width: 640, height: 480, cssClass: "node-class", htmlAttributes: 'title="Asset caption"',
  }]]);
});

it("shows a managed image placeholder instead of falling back to an editor preview URL", () => {
  const host = stubHost();
  const safeImageSrc = vi.fn<DocNodeHost["safeUrl"]["safeImageSrc"]>(() => "https://stub.example/ok.png");
  expect(render({
    node: { type: "image", attrs: { assetId: "a7", transformName: "public", src: "ok.png", alt: "Ridge & rocks" } },
    host: { ...host, safeUrl: { ...host.safeUrl, safeImageSrc } },
  }, { mediaTransformVersions: new Map([["thumbnail", 9]]) })).toBe(
    '<figure class="host-ph" style="aspect-ratio:16 / 9"><span class="host-ph-label">Ridge &amp; rocks</span></figure>',
  );
  expect(safeImageSrc).not.toHaveBeenCalled();
});

it("keeps headings linkable and aligned while rendering table spans and suppressing the mirrored title", () => {
  const nodeText = (text: string) => ({ type: "text", text });
  const heading = (level?: number) => ({ type: "heading", ...(level === undefined ? {} : { attrs: { level, textAlign: "center" } }), content: [
    { type: "text", text: "Summary", marks: [{ type: "bold" }] },
  ] });
  expect(render({ node: { type: "doc", content: [
    { type: "title", content: [nodeText("Already rendered by the theme")] },
    heading(8), heading(), { type: "heading", attrs: { level: 0 }, content: [nodeText("!?")] },
    { type: "table", content: [{ type: "tableRow", content: [
      { type: "tableHeader", attrs: { colspan: 2, align: "center" }, content: [{ type: "paragraph", content: [nodeText("Metric")] }] },
      { type: "tableCell", attrs: { colspan: 1001, rowspan: 3, align: "right" }, content: [{ type: "paragraph", content: [nodeText("Value")] }] },
      { type: "tableCell" },
    ] }] },
    { type: "codeBlock", attrs: { language: "not accepted" }, content: [nodeText("source")] },
    { type: "unknownPluginBlock", content: [{ type: "paragraph", content: [nodeText("Still visible")] }] },
  ] } })).toBe(
    '<h6 id="summary" style="text-align:center"><strong>Summary</strong></h6><h2 id="summary-2"><strong>Summary</strong></h2>' +
    '<h1>!?</h1><table><tr><th colspan="2" style="text-align:center"><p>Metric</p></th><td rowspan="3" style="text-align:right"><p>Value</p></td><td></td></tr></table>' +
    '<pre><code>source</code></pre><p>Still visible</p>',
  );
});

it("unknown node names that collide with Object prototype keys still preserve their children", () => {
  expect(render({ node: { type: "doc", content: [
    { type: "constructor", content: [{ type: "paragraph", content: [{ type: "text", text: "Preserved" }] }] },
  ] } })).toBe("<p>Preserved</p>");
});
