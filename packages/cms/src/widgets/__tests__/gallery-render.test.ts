import { describe, expect, it } from "vitest";
import { GALLERY_STYLE, renderGallery, type GalleryImageRenderer } from "../html/gallery-render.js";

/** Echoes the alt and the media record it was handed, so each pin shows what the port received. */
const renderImage: GalleryImageRenderer = ({ image, media }) => `<img alt="${image.alt}" data-m="${media ? JSON.stringify(media) : "-"}">`;

/** Every non-empty media/legacy render starts with the shared stylesheet; strip it to keep pins legible. */
function body(html: string): string {
  expect(html.startsWith(GALLERY_STYLE)).toBe(true);
  return html.slice(GALLERY_STYLE.length);
}

describe("renderGallery", () => {
  it("renders nothing for an invalid config", () => {
    expect(renderGallery({ config: { images: "nope", layout: "grid" }, renderImage })).toBe("");
  });

  it("flags a legacy src image without alt and escapes its caption", () => {
    expect(body(renderGallery({ config: { images: [{ src: "https://x.test/a.png", caption: "a<b" }], layout: "grid" }, renderImage })))
      .toBe('<div class="jini-gallery jini-gallery-grid" role="region" aria-label="Image gallery" style="--jini-gallery-columns:3">'
        + '<figure class="jini-gallery-item" data-jini-alt-missing="true"><img alt="" data-m="-"><figcaption>a&lt;b</figcaption></figure></div>');
  });

  it("resolves legacy mediaId records, keeps an explicit empty alt and drops unresolved references", () => {
    const html = renderGallery({
      config: { images: [{ mediaId: "m1" }, { mediaId: "m2", alt: "" }, { mediaId: "gone" }], layout: "masonry", columns: 4, aspectRatio: "16/9" },
      media: { m1: { alt: "stored" }, m2: { alt: "stored2" } },
      renderImage,
    });
    expect(body(html)).toBe('<div class="jini-gallery jini-gallery-masonry" role="region" aria-label="Image gallery" style="--jini-gallery-columns:4;--jini-gallery-ratio:16/9">'
      + '<figure class="jini-gallery-item"><img alt="stored" data-m="{"alt":"stored"}"></figure>'
      + '<figure class="jini-gallery-item"><img alt="" data-m="{"alt":"stored2"}"></figure></div>');
  });

  it("merges carousel, lightbox, cssClass and authored attributes, treating stored empty alt as missing and ignoring inherited keys", () => {
    const html = renderGallery({
      config: { mode: "media", items: [{ slug: "s1" }, { slug: "toString" }], layout: "carousel", lightbox: true, cssClass: 'k "q"', htmlAttributes: 'class="c" style="color:red" id="g" role="list"' },
      media: { s1: { alt: "" } },
      renderImage,
    });
    expect(body(html)).toBe('<div class="jini-gallery jini-gallery-carousel k &quot;q&quot; c" role="list" aria-label="Media" tabindex="0" aria-roledescription="carousel" data-jini-lightbox="true" id="g" style="--jini-gallery-columns:3;color:red">'
      + '<figure class="jini-gallery-item" data-jini-alt-missing="true"><img alt="" data-m="{"alt":""}"></figure></div>');
  });

  it("treats a non-record media argument as no records", () => {
    expect(body(renderGallery({ config: { mode: "media", items: [{ slug: "s1" }] }, media: [{ alt: "x" }], renderImage })))
      .toBe('<div class="jini-gallery jini-gallery-single" role="region" aria-label="Media" style="--jini-gallery-columns:3"></div>');
  });

  it("prompts the Gallery editor for an empty legacy gallery", () => {
    expect(renderGallery({ config: { images: [], layout: "grid" }, renderImage }))
      .toBe('<div class="jini-gallery jini-gallery-empty" role="note">Choose images in the Gallery widget editor.</div>');
  });

  it("prompts the Media editor for an empty media-mode gallery", () => {
    expect(renderGallery({ config: { mode: "media", items: [] }, renderImage }))
      .toBe('<div class="jini-gallery jini-gallery-empty" role="note">Choose media in the Media widget editor.</div>');
  });

  it("hands html mode to the raw-html port with the media records", () => {
    expect(renderGallery({ config: { mode: "html", html: "<p>{{media:a}}</p>" }, media: { a: { alt: "A" } }, renderImage, renderRawHtml: ({ html, media }) => `RAW:${html}:${JSON.stringify(media)}` }))
      .toBe('RAW:<p>{{media:a}}</p>:{"a":{"alt":"A"}}');
  });

  it("passes empty records to the raw-html port when media is not an object", () => {
    expect(renderGallery({ config: { html: "<p></p>" }, media: "x", renderImage, renderRawHtml: ({ media }) => JSON.stringify(media) })).toBe("{}");
  });

  it("passes empty records to the raw-html port when media is an array", () => {
    expect(renderGallery({ config: { html: "<p></p>" }, media: [{ alt: "x" }], renderImage, renderRawHtml: ({ media }) => JSON.stringify(media) })).toBe("{}");
  });

  it("renders nothing for html mode without a raw-html port", () => {
    expect(renderGallery({ config: { html: "<p></p>" }, renderImage })).toBe("");
  });
});
