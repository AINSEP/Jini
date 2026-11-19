import { describe, expect, it } from "vitest";
import { renderImageTag, renderVideoTag } from "../media-tags.js";

const base = { src: "/image?a=1&b=2", alt: "", width: null, height: null, cssClass: null, htmlAttributes: null };

describe("resolved media tags", () => {
  it("folds classes and lets marker attributes override asset attributes", () => {
    expect(renderImageTag({ ...base, cssClass: "base", htmlAttributes: 'class="extra" loading="lazy"', width: 640, markerAttributes: [{ name: "width", value: null }, { name: "loading", value: "eager" }] })).toBe('<img src="/image?a=1&amp;b=2" alt="" class="base extra" loading="eager">');
    expect(renderImageTag({ ...base, htmlAttributes: 'loading="eager"', markerAttributes: [{ name: "alt", value: null }, { name: "loading", value: null }] })).toBe('<img src="/image?a=1&amp;b=2" alt="" loading="lazy">');
  });
  it("uses the resolved URL for the responsive candidate", () => {
    expect(renderImageTag({ ...base, responsive: true })).toBe('<img src="/image?a=1&amp;b=2" srcset="/image?a=1&amp;b=2 1x" alt="" loading="lazy">');
  });
  it("preserves authored fallback bytes and escapes plain fallback", () => {
    expect(renderVideoTag({ ...base, fallbackText: "No & support", markerAttributes: [{ name: "alt", value: "A &amp; B" }] })).toBe('<video src="/image?a=1&amp;b=2" controls>A &amp; B</video>');
    expect(renderVideoTag({ ...base, fallbackText: "No & support", markerAttributes: [{ name: "alt", value: null }] })).toBe('<video src="/image?a=1&amp;b=2" controls></video>');
    expect(renderVideoTag({ ...base, alt: "A & B", fallbackText: "unused" })).toBe('<video src="/image?a=1&amp;b=2" controls>A &amp; B</video>');
    expect(renderVideoTag({ ...base, fallbackText: "No & support" })).toBe('<video src="/image?a=1&amp;b=2" controls>No &amp; support</video>');
  });
  it("omits audio dimensions and honors disabled controls", () => {
    expect(renderVideoTag({ ...base, kind: "audio", width: 640, height: 480, controls: false, fallbackText: "No support" })).toBe('<audio src="/image?a=1&amp;b=2">No support</audio>');
  });
});
