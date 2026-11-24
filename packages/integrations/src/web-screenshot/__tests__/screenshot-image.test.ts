import { readFileSync } from "node:fs";
import type { ImageCodecPort } from "@jini-ai/core/contracts/site/cms-media";
import { expect, test } from "vitest";

import { createScreenshotTileEncoder } from "../screenshot-image.js";

/**
 * @file The screenshot tile encoder delegates every pixel operation to the injected codec and only
 * adapts its result: tiles keep their geometry, bytes become Node Buffers, quality defaults to 70.
 */

function fakeCodec() {
  const calls: Array<{ input: unknown; options: unknown }> = [];
  const imageCodec: ImageCodecPort = {
    inspect: async () => { throw new Error("not used"); },
    encode: async () => { throw new Error("not used"); },
    encodeTiles: async (input, options) => {
      calls.push({ input, options });
      return [
        { bytes: new Uint8Array([1, 2]), width: 640, height: 400, top: 0 },
        { bytes: new Uint8Array([3]), width: 640, height: 120, top: 400 },
      ];
    },
  };
  return { imageCodec, calls };
}

test("one codec call per screenshot, default quality 70, tiles returned as Buffers in order", async () => {
  const { imageCodec, calls } = fakeCodec();
  const png = Buffer.from("png");
  const tiles = await createScreenshotTileEncoder({ imageCodec })({ png, maxWidth: 640, tileHeight: 400 });
  expect(calls).toEqual([{ input: { source: png, maxWidth: 640, tileHeight: 400 }, options: { quality: 70 } }]);
  expect(tiles.map((tile) => ({ ...tile, isBuffer: Buffer.isBuffer(tile.bytes), bytes: [...tile.bytes] }))).toEqual([
    { bytes: [1, 2], width: 640, height: 400, top: 0, isBuffer: true },
    { bytes: [3], width: 640, height: 120, top: 400, isBuffer: true },
  ]);
});

test("an explicit quality reaches the codec", async () => {
  const { imageCodec, calls } = fakeCodec();
  await createScreenshotTileEncoder({ imageCodec })({ png: Buffer.from("png"), maxWidth: 320, tileHeight: 200 }, { quality: 55 });
  expect(calls[0]?.options).toEqual({ quality: 55 });
});

// This consumer must receive a codec rather than construct the native vendor itself.
test("screenshot-image keeps native image codecs behind the port", () => {
  const source = readFileSync(new URL("../screenshot-image.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/(?:from\s*|import\(\s*|require\(\s*)["']sharp["']/);
});
