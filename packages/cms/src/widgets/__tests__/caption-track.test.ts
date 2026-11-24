import assert from "node:assert/strict";
import { test } from "vitest";
import { isSafeCaptionTrackSrc, renderCaptionTrack } from "../caption-track.js";
import { renderVideoTag } from "../media-tags.js";
import type { MediaCaptionsTrack } from "../../media/types.js";

const player = { src: "/m/clip/original.mp4", fallbackText: "Playback unavailable", alt: "", width: null, height: null, cssClass: null, htmlAttributes: null };
const track = { src: "/m/clip-captions/original.vtt?v=abc123", srclang: "en", label: "English" };

test("a caption track renders as a default captions <track> with every value escaped", () => {
  assert.equal(renderCaptionTrack({ track }), '<track kind="captions" src="/m/clip-captions/original.vtt?v=abc123" srclang="en" label="English" default>');
  assert.equal(
    renderCaptionTrack({ track: { src: "/m/a&b/original.vtt?v=1&x=2", srclang: "pt-BR", label: 'Português "BR" <cc>' } }),
    '<track kind="captions" src="/m/a&amp;b/original.vtt?v=1&amp;x=2" srclang="pt-BR" label="Português &quot;BR&quot; &lt;cc&gt;" default>',
  );
  assert.equal(renderCaptionTrack({ track: { src: track.src, srclang: "en" } }), '<track kind="captions" src="/m/clip-captions/original.vtt?v=abc123" srclang="en" default>');
  assert.equal(renderCaptionTrack({ track: { src: track.src, srclang: "en", label: "" } }), '<track kind="captions" src="/m/clip-captions/original.vtt?v=abc123" srclang="en" default>');
});

test("absent caption track renders nothing", () => {
  assert.equal(renderCaptionTrack({ track: null }), "");
  assert.equal(renderCaptionTrack({ track: undefined }), "");
});

test("only same-origin /m/ WebVTT URLs are accepted as a caption source", () => {
  for (const src of ["/m/clip/original.vtt", "/m/clip/original.VTT", "/m/clip/original.vtt?v=abc", "/m/clip/original.vtt#t=1"]) {
    assert.equal(isSafeCaptionTrackSrc({ src }), true, src);
  }
  for (const src of [
    "javascript:alert(1)//x.vtt", "JavaScript:alert(1)", "data:text/vtt,WEBVTT", "https://evil.test/m/x/original.vtt",
    "//evil.test/m/x/original.vtt", "/\\evil.test/m/x/original.vtt", "/m/clip/original.srt", "/m/clip/original.vtt.js",
    "/m/clip/original.bin?x=.vtt", "/uploads/clip.vtt", "m/clip/original.vtt", "/m/clip/original .vtt",
    "/m/clip/original.vtt\n", "/m//evil.test/original.vtt", "/m/../admin/original.vtt", "",
  ]) {
    assert.equal(isSafeCaptionTrackSrc({ src }), false, JSON.stringify(src));
    assert.equal(renderCaptionTrack({ track: { src, srclang: "en" } }), "", JSON.stringify(src));
  }
});

test("a malformed srclang refuses the track rather than emitting it", () => {
  for (const srclang of ["", "e", "en us", 'en" onerror="x', "english-language-tag-way-too-long-x"]) {
    assert.equal(renderCaptionTrack({ track: { src: track.src, srclang } }), "", srclang);
  }
});

test("video and audio players carry the captions track inside the element, before the fallback text", () => {
  assert.equal(
    renderVideoTag(player, { captionsTrack: track }),
    '<video src="/m/clip/original.mp4" controls><track kind="captions" src="/m/clip-captions/original.vtt?v=abc123" srclang="en" label="English" default>Playback unavailable</video>',
  );
  assert.equal(
    renderVideoTag({ ...player, kind: "audio", src: "/m/song/original.mp3" }, { captionsTrack: { src: "/m/song-cc/original.vtt", srclang: "fr" } }),
    '<audio src="/m/song/original.mp3" controls><track kind="captions" src="/m/song-cc/original.vtt" srclang="fr" default>Playback unavailable</audio>',
  );
});

test("without a captions track the player output is byte-identical to the no-captions shape", () => {
  const baseline = '<video src="/m/clip/original.mp4" controls>Playback unavailable</video>';
  assert.equal(renderVideoTag(player), baseline);
  assert.equal(renderVideoTag(player, {}), baseline);
  assert.equal(renderVideoTag(player, { captionsTrack: null }), baseline);
  // A refused (unsafe) track degrades to the uncaptioned player, never a partial/unsafe tag.
  assert.equal(renderVideoTag(player, { captionsTrack: { src: "javascript:alert(1)", srclang: "en" } }), baseline);
});

test("a captions track reference names a sibling asset id and a language", () => {
  const ref: MediaCaptionsTrack = { assetId: "00000000-0000-4000-8000-000000000001", srclang: "en", label: null };
  assert.equal(ref.srclang, "en");
  assert.equal(ref.label, null);
});
