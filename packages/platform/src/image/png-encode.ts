import { deflateSync } from "node:zlib";

/**
 * @file A dependency-free, minimal PNG encoder — just enough to produce a real, decodable image for
 * a host demo tool to prove the typed-media pipeline end to end ("tool results must carry typed
 * media rather than flattened text").
 *
 * A solid-color square, not a photo or a fetched asset, deliberately: the point of such a demo
 * tool is proving the TRANSPORT (daemon -> wire -> chat-core -> ToolCard `<img>`), not
 * building an image generator. A hand-rolled encoder over a third-party image library or a real
 * external call keeps the dependency count at zero — `node:zlib`, already in the runtime — and
 * deterministic, so its own tests assert exact pixel bytes rather than "didn't throw".
 *
 * The format written is the minimum PNG needs to be valid: signature, `IHDR` (8-bit truecolor,
 * no interlacing), one `IDAT` holding every scanline (each prefixed with filter type 0 — "none",
 * the simplest legal choice for uncompressed-looking row data before deflate), and an empty `IEND`.
 * Every chunk is real deflate + real CRC-32, so a real PNG decoder (a browser `<img>`, `zlib.inflateSync`
 * in this file's own tests) can round-trip it — nothing here is a stub shaped like a PNG.
 */

/** 0-255 per channel. */
export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RenderSolidColorPngOptions {
  /** Pixel width. Must be a positive integer. @default 64 */
  readonly width?: number;
  /** Pixel height. Must be a positive integer. @default 64 */
  readonly height?: number;
  /** Fill color. @default { r: 79, g: 70, b: 229 } (indigo). */
  readonly color?: RgbColor;
}

const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 64;
const DEFAULT_COLOR: RgbColor = { r: 79, g: 70, b: 229 };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The standard PNG/zlib CRC-32 table (ITU-T V.42 polynomial 0xEDB88320), built once at module load
 * — every chunk's trailing CRC is computed against it.
 *
 * @complexity O(1) — 256 iterations, once per process.
 */
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

/** PNG's chunk CRC: computed over the chunk's `type` + `data` bytes, per the spec — never over `length`. */
function crc32({ bytes }: { bytes: Buffer }, _optional = {}): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One length-prefixed, CRC-suffixed PNG chunk: `length(4) + type(4) + data(n) + crc(4)`. */
function chunk({ type, data }: { type: string; data: Buffer }, _optional = {}): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32({ bytes: crcInput }), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** @throws {Error} `"renderSolidColorPng: {label} must be a positive integer, got {value}"` for a non-integer or non-positive dimension. */
function assertPositiveInteger({ value, label }: { value: number; label: string }, _optional = {}): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`renderSolidColorPng: ${label} must be a positive integer, got ${value}`);
  }
}

/** @throws {Error} `"renderSolidColorPng: color.{channel} must be an integer between 0 and 255, got {value}"` for an out-of-range channel. */
function assertChannel({ value, channel }: { value: number; channel: string }, _optional = {}): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`renderSolidColorPng: color.${channel} must be an integer between 0 and 255, got ${value}`);
  }
}

/**
 * Renders a solid-color square as a real, valid 8-bit truecolor PNG.
 *
 * @param options - Dimensions and fill color; every field optional with the module's own defaults.
 * @returns The complete PNG file as a `Buffer` — signature through `IEND`.
 * @throws {Error} If `width`/`height` is not a positive integer, or any `color` channel is outside `0..255`.
 * @complexity O(width * height) to build the raw scanlines plus the `deflateSync` call's own cost.
 */
export function renderSolidColorPng(options: RenderSolidColorPngOptions = {}): Buffer {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const color = options.color ?? DEFAULT_COLOR;
  assertPositiveInteger({ value: width, label: "width" });
  assertPositiveInteger({ value: height, label: "height" });
  assertChannel({ value: color.r, channel: "r" });
  assertChannel({ value: color.g, channel: "g" });
  assertChannel({ value: color.b, channel: "b" });

  // One filter byte (0 = "None") plus 3 bytes/pixel per scanline — PNG's raw, pre-deflate layout for
  // 8-bit truecolor (colorType 2, no alpha).
  const bytesPerRow = 1 + width * 3;
  const raw = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = color.r;
      raw[pixelStart + 1] = color.g;
      raw[pixelStart + 2] = color.b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB, no palette, no alpha)
  ihdr[10] = 0; // compression method: deflate (the only defined value)
  ihdr[11] = 0; // filter method: adaptive (the only defined value; per-row filter is still 0/"None" above)
  ihdr[12] = 0; // interlace method: none

  const idat = deflateSync(raw);

  return Buffer.concat([PNG_SIGNATURE, chunk({ type: "IHDR", data: ihdr }), chunk({ type: "IDAT", data: idat }), chunk({ type: "IEND", data: Buffer.alloc(0) })]);
}
