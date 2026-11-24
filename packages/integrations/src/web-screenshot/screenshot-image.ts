import type { ImageCodecPort } from "@jini-ai/core/contracts/site/cms-media";
import type { EncodeTiles } from "./web-screenshot.js";

/**
 * Downscales a PNG screenshot to `maxWidth` (never enlarged) and cuts it into JPEG tiles of at most
 * `tileHeight` px, top to bottom. One decode, one resize, one encode per tile, owned by the codec.
 * @complexity O(pixels).
 */
export function createScreenshotTileEncoder({ imageCodec }: { imageCodec: ImageCodecPort }, _options = {}): EncodeTiles {
  return async ({ png, maxWidth, tileHeight }, { quality = 70 } = {}) => {
    const tiles = await imageCodec.encodeTiles({ source: png, maxWidth, tileHeight }, { quality });
    return tiles.map(tile => ({ ...tile, bytes: Buffer.from(tile.bytes) }));
  };
}
