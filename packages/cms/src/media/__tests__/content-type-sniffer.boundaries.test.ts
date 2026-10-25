import { describe, expect, it } from "vitest";

import { sniffContentType } from "../content-type-sniffer.js";

/** Length/offset boundaries of the magic-byte sniffer (Stryker L4 survivors: `offset + length`,
 * ftyp box end, `Math.min`, the 512-byte text window, and the `<?xml` discrimination). The
 * sniffer guards upload-type spoofing, so each check gets an exact-length and one-short case. */

const sniff = (bytes: number[] | Uint8Array) => sniffContentType({ bytes: bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes) });
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

describe("binary signatures: exact length matches, one byte short does not", () => {
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/gif", ascii("GIF87a")],
    ["image/gif", ascii("GIF89a")],
    ["image/webp", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]],
    ["audio/wav", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]],
    ["video/webm", [0x1a, 0x45, 0xdf, 0xa3]],
    ["audio/flac", ascii("fLaC")],
    ["audio/mpeg", ascii("ID3")],
  ] as const)("%s", (type, signature) => {
    expect(sniff([...signature])).toBe(type);
    expect(sniff([...signature].slice(0, -1))).toBe("application/octet-stream");
  });

  it("an empty buffer is octet-stream", () => {
    expect(sniff([])).toBe("application/octet-stream");
  });

  it("GIF88a and RIFF-without-form are not recognised", () => {
    expect(sniff(ascii("GIF88a"))).toBe("application/octet-stream");
    expect(sniff([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")])).toBe("application/octet-stream");
  });
});

describe("ISO-BMFF ftyp box", () => {
  const ftyp = (size: number, major: string, compatible: string[] = []) => [...u32(size), ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];

  it.each([["avif"], ["avis"]])("major brand %s → image/avif", (brand) => {
    expect(sniff(ftyp(16, brand))).toBe("image/avif");
  });

  it("major M4A → audio/mp4; any other brand → video/mp4", () => {
    expect(sniff(ftyp(16, "M4A "))).toBe("audio/mp4");
    expect(sniff(ftyp(16, "isom"))).toBe("video/mp4");
    expect(sniff(ftyp(16, "heic"))).toBe("video/mp4");
  });

  it("a compatible avif brand ending exactly at the box end counts; one byte short of it does not", () => {
    expect(sniff(ftyp(20, "mif1", ["avif"]))).toBe("image/avif");
    expect(sniff(ftyp(19, "mif1", ["avif"]))).toBe("video/mp4");
  });

  it("compatible brands beyond the declared box are never scanned (trailing boxes are not brands)", () => {
    expect(sniff(ftyp(24, "mif1", ["mif1", "miaf", "avif"]))).toBe("video/mp4");
    expect(sniff(ftyp(28, "mif1", ["mif1", "miaf", "avif"]))).toBe("image/avif");
  });

  it("an inflated declared size is clamped to the bytes present (no out-of-range scan, still finds a present brand)", () => {
    expect(sniff(ftyp(0xffffffff, "mif1", ["miaf", "avif"]))).toBe("image/avif");
    expect(sniff(ftyp(0xffffffff, "mif1", ["miaf"]))).toBe("video/mp4");
  });

  it("the 16th compatible brand is scanned, the 17th is not", () => {
    const filler = Array.from({ length: 15 }, () => "mif1");
    expect(sniff(ftyp(16 + 16 * 4, "mif1", [...filler, "avif"]))).toBe("image/avif");
    expect(sniff(ftyp(16 + 17 * 4, "mif1", [...filler, "mif1", "avif"]))).toBe("video/mp4");
  });
});

describe("untagged MPEG audio frame header", () => {
  it("a valid MPEG-1 Layer III frame header → audio/mpeg", () => {
    expect(sniff([0xff, 0xfb, 0x90, 0x00])).toBe("audio/mpeg");
  });
  it.each([
    ["three bytes only", [0xff, 0xfb, 0x90]],
    ["no sync", [0xff, 0x1b, 0x90, 0x00]],
    ["reserved version (01)", [0xff, 0xeb, 0x90, 0x00]],
    ["reserved layer (00)", [0xff, 0xf9, 0x90, 0x00]],
    ["free bitrate (0000)", [0xff, 0xfb, 0x00, 0x00]],
    ["bad bitrate (1111)", [0xff, 0xfb, 0xf0, 0x00]],
    ["reserved sample rate (11)", [0xff, 0xfb, 0x9c, 0x00]],
  ])("%s → octet-stream", (_label, bytes) => {
    expect(sniff(bytes)).toBe("application/octet-stream");
  });
});

describe("markup detection", () => {
  const text = (s: string) => new TextEncoder().encode(s);

  it.each([
    ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml"],
    ["  \n\t<SVG/>", "image/svg+xml"],
    ["﻿<svg/>", "image/svg+xml"],
    ['<?xml version="1.0"?><svg/>', "image/svg+xml"],
    ['<?xml version="1.0"?><html/>', "text/html"],
    ["<!DOCTYPE html><p>", "text/html"],
    ["<IFRAME src=x>", "text/html"],
    ["<frameset>", "text/html"],
    ['<?xml version="1.0"?><rss/>', "application/octet-stream"],
    ["hello <svg/>", "application/octet-stream"],
    ["<p>hello</p>", "application/octet-stream"],
  ])("%j → %s", (source, type) => {
    expect(sniff(text(source))).toBe(type);
  });

  it("an <svg> that only appears after the 512-byte window is not seen; just inside it is", () => {
    const prolog = '<?xml version="1.0"?>';
    const inside = prolog + " ".repeat(512 - prolog.length - 4) + "<svg";
    expect(inside.length).toBe(512);
    expect(sniff(text(inside))).toBe("image/svg+xml");
    expect(sniff(text(prolog + " ".repeat(512 - prolog.length - 3) + "<svg"))).toBe("application/octet-stream");
  });

  it("a binary signature wins over markup that follows it", () => {
    expect(sniff([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ascii("<svg/>")])).toBe("image/png");
  });

  it("a partial BOM is not stripped", () => {
    expect(sniff([0xef, 0xbb, ...ascii("<svg/>")])).toBe("application/octet-stream");
  });
});
