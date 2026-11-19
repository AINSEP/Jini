import assert from "node:assert/strict";
import { test } from "vitest";
import { renderImageTag, renderVideoTag } from "../media-tags.js";

const image = { src: "/media/image.jpg", alt: "", width: null, height: null, cssClass: null, htmlAttributes: null };
const player = { src: "/media/video.mp4", fallbackText: "Playback unavailable", alt: "", width: null, height: null, cssClass: null, htmlAttributes: null };

test("image classes fold after the asset class and bare marker values suppress asset values", () => {
  assert.equal(renderImageTag({ ...image, cssClass: "base", htmlAttributes: 'class="extra"' }), '<img src="/media/image.jpg" alt="" class="base extra" loading="lazy">');
  assert.equal(renderImageTag({ ...image, htmlAttributes: 'class="extra"' }), '<img src="/media/image.jpg" alt="" class="extra" loading="lazy">');
  assert.equal(renderImageTag({ ...image, alt: "Asset alt", markerAttributes: [{ name: "alt", value: null }] }), '<img src="/media/image.jpg" alt="" loading="lazy">');
  assert.equal(renderImageTag({ ...image, width: 640, markerAttributes: [{ name: "width", value: null }] }), '<img src="/media/image.jpg" alt="" loading="lazy">');
  assert.equal(renderImageTag({ ...image, htmlAttributes: 'loading="eager"', markerAttributes: [{ name: "loading", value: null }] }), '<img src="/media/image.jpg" alt="" loading="lazy">');
});

test("image marker values override dimensions and loading while preserving source entities and extra order", () => {
  assert.equal(renderImageTag({ ...image, alt: "Asset caption", width: 640, height: 480, htmlAttributes: 'loading="lazy"', markerAttributes: [
    { name: "alt", value: "Marker &amp; caption" }, { name: "width", value: "320" }, { name: "height", value: "240" }, { name: "loading", value: "eager" },
  ] }), '<img src="/media/image.jpg" alt="Marker &amp; caption" width="320" height="240" loading="eager">');
  assert.equal(renderImageTag({ ...image, width: 640, htmlAttributes: 'data-a="asset" data-b="second"', markerAttributes: [
    { name: "width", value: null }, { name: "data-a", value: "A &amp; B" }, { name: "data-c", value: "last" },
  ] }), '<img src="/media/image.jpg" alt="" data-a="A &amp; B" data-b="second" data-c="last" loading="lazy">');
});

test("image attributes keep class precedence and resolved URLs with one responsive candidate", () => {
  assert.equal(renderImageTag({ ...image, cssClass: "rounded", markerAttributes: [{ name: "class", value: "hero wide" }] }), '<img src="/media/image.jpg" alt="" class="rounded hero wide" loading="lazy">');
  assert.equal(renderImageTag({ ...image, src: "/media/image.jpg?a=1&b=2", responsive: true, markerAttributes: [
    { name: "src", value: "https://hostile.example/image.jpg" }, { name: "srcset", value: "https://hostile.example/image.jpg 2x" },
  ] }), '<img src="/media/image.jpg?a=1&amp;b=2" srcset="/media/image.jpg?a=1&amp;b=2 1x" alt="" loading="lazy">');
  assert.equal(renderImageTag({ ...image, alt: "A photo", width: 640, height: 480, cssClass: "rounded" }), '<img src="/media/image.jpg" alt="A photo" width="640" height="480" class="rounded" loading="lazy">');
});

test("marker entities stay verbatim and unsafe asset attributes are omitted", () => {
  assert.equal(renderImageTag({ ...image, markerAttributes: [{ name: "title", value: "a &amp; b" }] }), '<img src="/media/image.jpg" alt="" title="a &amp; b" loading="lazy">');
  assert.equal(renderImageTag({ ...image, alt: "x", htmlAttributes: 'onerror="alert(1)"', markerAttributes: [{ name: "data-foo", value: "bar" }] }), '<img src="/media/image.jpg" alt="x" data-foo="bar" loading="lazy">');
});

test("player marker fallback preserves source bytes and bare alt empties it", () => {
  assert.equal(renderVideoTag({ ...player, alt: "Asset alt", markerAttributes: [{ name: "alt", value: "Marker &amp; text" }] }), '<video src="/media/video.mp4" controls>Marker &amp; text</video>');
  assert.equal(renderVideoTag({ ...player, markerAttributes: [{ name: "alt", value: null }] }), '<video src="/media/video.mp4" controls></video>');
  assert.equal(renderVideoTag({ ...player, alt: "A & B" }), '<video src="/media/video.mp4" controls>A &amp; B</video>');
  assert.equal(renderVideoTag({ ...player, src: "/media/video.mp4?a=1&b=2", fallbackText: "Unavailable <here> & now" }), '<video src="/media/video.mp4?a=1&amp;b=2" controls>Unavailable &lt;here&gt; &amp; now</video>');
});

test("player controls and authored boolean attributes keep their exact order", () => {
  assert.equal(renderVideoTag({ ...player, markerAttributes: [
    { name: "autoplay", value: null }, { name: "muted", value: null }, { name: "loop", value: null }, { name: "playsinline", value: null },
  ] }), '<video src="/media/video.mp4" controls autoplay muted loop playsinline>Playback unavailable</video>');
  assert.equal(renderVideoTag({ ...player, controls: false }), '<video src="/media/video.mp4">Playback unavailable</video>');
  assert.equal(renderVideoTag({ ...player, controls: true }), '<video src="/media/video.mp4" controls>Playback unavailable</video>');
  assert.equal(renderVideoTag({ ...player, markerAttributes: [
    { name: "class", value: "hero" }, { name: "id", value: "v1" }, { name: "style", value: "max-width:600px" }, { name: "autoplay", value: null },
  ] }), '<video src="/media/video.mp4" controls class="hero" id="v1" style="max-width:600px" autoplay>Playback unavailable</video>');
});

test("audio never receives video dimensions", () => {
  assert.equal(renderVideoTag({ ...player, kind: "audio", src: "/media/audio.mp3", width: 640, height: 480, markerAttributes: [
    { name: "width", value: "320" }, { name: "height", value: "240" },
  ] }), '<audio src="/media/audio.mp3" controls>Playback unavailable</audio>');
});
