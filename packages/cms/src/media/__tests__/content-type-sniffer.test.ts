import assert from "node:assert/strict";
import { test } from "vitest";

import { sniffContentType } from "../content-type-sniffer.js";

/**
 * @file Unit tests for `content-type-sniffer.ts`'s magic-byte allowlist. Every format named in the
 * task brief is covered directly, plus the security-critical negative cases: a sniffed HTML/SVG
 * result (the stored-XSS vector a serving route must defuse), and the safe fallback for anything
 * else — including inputs crafted to almost-but-not-quite match a signature, and inputs too short
 * to hold one at all (must not throw).
 */

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("sniffContentType: recognizes PNG by its 8-byte signature", () => {
  const bytes = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.equal(sniffContentType(bytes), "image/png");
});

test("sniffContentType: recognizes JPEG by its FF D8 FF prefix", () => {
  const bytes = bytesOf([0xff, 0xd8, 0xff, 0xe0, 0, 0, 1, 2]);
  assert.equal(sniffContentType(bytes), "image/jpeg");
});

test("sniffContentType: recognizes GIF87a and GIF89a", () => {
  assert.equal(sniffContentType(textBytes("GIF87a" + "rest-of-file")), "image/gif");
  assert.equal(sniffContentType(textBytes("GIF89a" + "rest-of-file")), "image/gif");
});

test("sniffContentType: recognizes WebP (RIFF____WEBP)", () => {
  const bytes = new Uint8Array(16);
  bytes.set(textBytes("RIFF"), 0);
  bytes.set(bytesOf([0x24, 0, 0, 0]), 4); // chunk size — arbitrary, not checked
  bytes.set(textBytes("WEBP"), 8);
  assert.equal(sniffContentType(bytes), "image/webp");
});

test("sniffContentType: a RIFF container that is NOT WebP (wrong form type) is not misidentified", () => {
  const bytes = new Uint8Array(16);
  bytes.set(textBytes("RIFF"), 0);
  bytes.set(bytesOf([0x24, 0, 0, 0]), 4);
  bytes.set(textBytes("WAVE"), 8); // a .wav file, not .webp
  assert.equal(sniffContentType(bytes), "application/octet-stream");
});

test("sniffContentType: recognizes MP4/ISO-BMFF by the ftyp box at offset 4", () => {
  const bytes = new Uint8Array(16);
  bytes.set(bytesOf([0, 0, 0, 0x18]), 0); // box size — arbitrary, not checked
  bytes.set(textBytes("ftyp"), 4);
  bytes.set(textBytes("isom"), 8); // major brand
  assert.equal(sniffContentType(bytes), "video/mp4");
});

test("sniffContentType: recognizes WebM by its EBML header", () => {
  const bytes = bytesOf([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  assert.equal(sniffContentType(bytes), "video/webm");
});

test("sniffContentType: an HTML document declared as an upload's contentType is still sniffed as text/html from its real bytes", () => {
  const bytes = textBytes("<!DOCTYPE html><html><head><script>alert(document.cookie)</script></head></html>");
  assert.equal(sniffContentType(bytes), "text/html");
});

test("sniffContentType: a bare <html> root without a doctype is still sniffed as text/html", () => {
  assert.equal(sniffContentType(textBytes("<html><body>hi</body></html>")), "text/html");
});

test("sniffContentType: an XHTML document (XML prolog + <html) is sniffed as text/html", () => {
  const bytes = textBytes('<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"></html>');
  assert.equal(sniffContentType(bytes), "text/html");
});

test("sniffContentType: an SVG document is sniffed as image/svg+xml, not image/png, regardless of upload-time claims", () => {
  const bytes = textBytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(sniffContentType(bytes), "image/svg+xml");
});

test("sniffContentType: an SVG with an XML prolog is still sniffed as image/svg+xml", () => {
  const bytes = textBytes('<?xml version="1.0" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(sniffContentType(bytes), "image/svg+xml");
});

test("sniffContentType: a leading UTF-8 BOM and whitespace do not defeat HTML/SVG detection", () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...textBytes("  \n<html><body/></html>")]);
  assert.equal(sniffContentType(withBom), "text/html");
});

test("sniffContentType: falls back to application/octet-stream for genuinely unknown bytes", () => {
  assert.equal(sniffContentType(bytesOf([1, 2, 3, 4, 5, 6, 7, 8])), "application/octet-stream");
  assert.equal(sniffContentType(textBytes("just some plain text, not markup")), "application/octet-stream");
});

test("sniffContentType: near-miss signatures (one byte off) do not falsely match", () => {
  // PNG signature with the last byte flipped.
  assert.equal(sniffContentType(bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0xff])), "application/octet-stream");
  // "GIF88a" is not a real GIF version string.
  assert.equal(sniffContentType(textBytes("GIF88a")), "application/octet-stream");
});

test("sniffContentType: inputs shorter than a signature never throw, and are treated as unrecognized", () => {
  assert.equal(sniffContentType(bytesOf([])), "application/octet-stream");
  assert.equal(sniffContentType(bytesOf([0x89, 0x50])), "application/octet-stream");
  assert.equal(sniffContentType(bytesOf([0xff, 0xd8])), "application/octet-stream");
});

/**
 * Builds an ISO-BMFF `ftyp` box: a 4-byte big-endian box size, the literal `ftyp` tag, a 4-byte
 * major brand, a 4-byte minor version, then one 4-byte entry per compatible brand. The declared
 * size is computed from the actual content so the box is self-consistent — the sniffer bounds its
 * compatible-brand scan by that field, so a fixture that lied about its size would not exercise
 * the real scan.
 */
function ftypBytes(majorBrand: string, compatibleBrands: readonly string[]): Uint8Array {
  const boxLength = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(boxLength + 8); // + trailing non-ftyp payload, as a real file has
  bytes.set([(boxLength >> 24) & 0xff, (boxLength >> 16) & 0xff, (boxLength >> 8) & 0xff, boxLength & 0xff], 0);
  bytes.set(textBytes("ftyp"), 4);
  bytes.set(textBytes(majorBrand), 8);
  compatibleBrands.forEach((brand, index) => bytes.set(textBytes(brand), 16 + index * 4));
  return bytes;
}

/**
 * Regression (2026-09-06): AVIF is an ISO-BMFF container, so its leading `ftyp` box matched the
 * MP4 check — which tests ONLY for the `ftyp` tag and never reads the brand — and every real
 * `.avif` upload was sniffed as `video/mp4`. Because the sniffed type is persisted as the
 * image-vs-video source of truth (the host's `routes/media/upload.ts` writes it to
 * `mediaContentTypeStore`), that mislabel made an AVIF render as an unplayable `<video>` on a
 * public page. These bytes are the real leading box of a genuine AVIF file.
 */
test("sniffContentType: a real AVIF ftyp box is image/avif, NOT video/mp4", () => {
  const bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x69, 0x66, 0x31, 0x6d, 0x69, 0x61, 0x66, 0x00, 0x00, 0x01, 0x68, 0x6d, 0x65, 0x74, 0x61,
  ]);
  assert.equal(sniffContentType(bytes), "image/avif");
});

test("sniffContentType: an AVIF whose MAJOR brand is mif1 is still image/avif via its compatible brands", () => {
  assert.equal(sniffContentType(ftypBytes("mif1", ["mif1", "avif"])), "image/avif");
});

test("sniffContentType: an AVIF image sequence (avis brand) is image/avif", () => {
  assert.equal(sniffContentType(ftypBytes("avis", ["avis", "avif"])), "image/avif");
});

test("sniffContentType: a real MP4 is still video/mp4 — the AVIF check must not swallow ISO-BMFF video", () => {
  assert.equal(sniffContentType(ftypBytes("isom", ["isom", "mp41"])), "video/mp4");
  assert.equal(sniffContentType(ftypBytes("mp42", [])), "video/mp4");
});

/**
 * HEIC is also ISO-BMFF but declares no AVIF brand, so it must NOT be claimed as `image/avif`:
 * the installed `sharp`/libvips build decodes AVIF but not HEIC, so labelling a HEIC as an image
 * would route it into a transform pipeline that cannot decode it. It therefore keeps falling
 * through to the brand-blind MP4 check and is still reported as `video/mp4` — a KNOWN, pre-existing
 * misclassification this change deliberately does not fix (see the handoff's format audit). Pinned
 * exactly rather than loosely so a future HEIC fix has to update this line consciously.
 */
test("sniffContentType: HEIC is not claimed as AVIF (its own mislabel as video/mp4 is a pinned, pre-existing gap)", () => {
  const heic = ftypBytes("heic", ["mif1", "heic"]);
  assert.notEqual(sniffContentType(heic), "image/avif");
  assert.equal(sniffContentType(heic), "video/mp4");
});

test("sniffContentType: an ftyp box truncated mid-brand never throws and stays video/mp4", () => {
  assert.equal(sniffContentType(bytesOf([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76])), "video/mp4");
});
