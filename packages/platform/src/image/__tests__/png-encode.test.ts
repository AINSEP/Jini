import assert from "node:assert/strict";
import { test } from "vitest";
import { crc32, inflateSync } from "node:zlib";

import { renderSolidColorPng } from "../png-encode.js";

/**
 * @file Proves `renderSolidColorPng` produces a genuinely decodable PNG, not merely bytes shaped
 * like one — every assertion here either parses the file structure directly or round-trips it
 * through `zlib.inflateSync`, the same decompression step a real PNG decoder performs.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads one length-prefixed PNG chunk at `offset`, returning its type, data, and the offset of the next chunk. */
function readChunk(buf: Buffer, offset: number): { type: string; data: Buffer; next: number } {
  const length = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + length);
  assert.equal(buf.readUInt32BE(offset + 8 + length), crc32(buf.subarray(offset + 4, offset + 8 + length)), `${type} CRC must cover type + data`);
  return { type, data, next: offset + 8 + length + 4 };
}

test("starts with the exact 8-byte PNG signature", () => {
  const png = renderSolidColorPng();
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
});

test("IHDR reports the requested width/height and 8-bit truecolor (colorType 2)", () => {
  const png = renderSolidColorPng({ width: 12, height: 7 });
  const { type, data } = readChunk(png, 8);
  assert.equal(type, "IHDR");
  assert.equal(data.readUInt32BE(0), 12, "width");
  assert.equal(data.readUInt32BE(4), 7, "height");
  assert.equal(data[8], 8, "bit depth");
  assert.equal(data[9], 2, "color type (truecolor)");
  assert.equal(data[12], 0, "interlace method");
});

test("defaults to a 64x64 image when no dimensions are given", () => {
  const png = renderSolidColorPng();
  const { data } = readChunk(png, 8);
  assert.equal(data.readUInt32BE(0), 64);
  assert.equal(data.readUInt32BE(4), 64);
});

test("the IDAT payload inflates to real scanlines carrying the requested color, pixel for pixel", () => {
  const width = 3;
  const height = 2;
  const color = { r: 10, g: 20, b: 30 };
  const png = renderSolidColorPng({ width, height, color });

  const { next: afterIhdr } = readChunk(png, 8);
  const { type, data: idat } = readChunk(png, afterIhdr);
  assert.equal(type, "IDAT");

  const raw = inflateSync(idat);
  const bytesPerRow = 1 + width * 3;
  assert.equal(raw.length, bytesPerRow * height, "one filter byte + 3 bytes/pixel, per row");

  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    assert.equal(raw[rowStart], 0, `row ${y} filter byte must be 0 (None)`);
    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 3;
      assert.deepEqual(
        [raw[pixelStart], raw[pixelStart + 1], raw[pixelStart + 2]],
        [color.r, color.g, color.b],
        `pixel (${x},${y})`
      );
    }
  }
});

test("ends with an empty IEND chunk", () => {
  const png = renderSolidColorPng({ width: 2, height: 2 });
  const { next: afterIhdr } = readChunk(png, 8);
  const { next: afterIdat } = readChunk(png, afterIhdr);
  const { type, data } = readChunk(png, afterIdat);
  assert.equal(type, "IEND");
  assert.equal(data.length, 0);
  assert.equal(afterIdat + 12, png.length, "IEND is the last chunk — nothing trails it");
});

test("rejects a zero width with the exact error text", () => {
  assert.throws(() => renderSolidColorPng({ width: 0 }), {
    message: "renderSolidColorPng: width must be a positive integer, got 0",
  });
});

test("rejects a negative height with the exact error text", () => {
  assert.throws(() => renderSolidColorPng({ height: -1 }), {
    message: "renderSolidColorPng: height must be a positive integer, got -1",
  });
});

test("rejects a non-integer width with the exact error text", () => {
  assert.throws(() => renderSolidColorPng({ width: 1.5 }), {
    message: "renderSolidColorPng: width must be a positive integer, got 1.5",
  });
});

test("rejects an out-of-range color channel with the exact error text", () => {
  assert.throws(() => renderSolidColorPng({ color: { r: 256, g: 0, b: 0 } }), {
    message: "renderSolidColorPng: color.r must be an integer between 0 and 255, got 256",
  });
  assert.throws(() => renderSolidColorPng({ color: { r: 0, g: -1, b: 0 } }), {
    message: "renderSolidColorPng: color.g must be an integer between 0 and 255, got -1",
  });
});
