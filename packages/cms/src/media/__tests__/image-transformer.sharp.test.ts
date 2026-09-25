/**
 * @file `SharpImageTransformer` test (`image-transformer.sharp.ts`).
 *
 * `sharp` is an OPTIONAL runtime dependency of this package (see that file's
 * header — mirrors `identity/hasher.ts`'s treatment of `argon2`), but this
 * test statically imports it to exercise the real resize + format-conversion
 * success path, not just the honest-failure path — the same choice
 * `identity/__tests__/*.test.ts` makes for `argon2`. That means `sharp` must
 * be a real, installed devDependency of this package for this test to run;
 * see the package's `argon2` peerDependency/devDependency entries for the
 * precedent this mirrors.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import sharp from "sharp";

import { ImageSourceCorruptError, ImageTransformUnavailableError, SharpImageTransformer } from "../image-transformer.sharp.js";

test("SharpImageTransformer.transform actually resizes and re-encodes real image bytes", async () => {
  const transformer = new SharpImageTransformer();
  const sourcePng = await sharp({
    create: { width: 20, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();

  const result = await transformer.transform({
    bytes: new Uint8Array(sourcePng),
    params: { width: 5, height: 5, format: "jpeg" },
  });

  assert.strictEqual(result.contentType, "image/jpeg");
  const outMeta = await sharp(Buffer.from(result.bytes)).metadata();
  assert.strictEqual(outMeta.format, "jpeg");
  assert.strictEqual(outMeta.width, 5);
  assert.strictEqual(outMeta.height, 5);
  // Re-encoded output must differ from the untouched source bytes (never a passthrough).
  assert.notDeepStrictEqual(Buffer.from(result.bytes), sourcePng);
});

test("SharpImageTransformer.transform rejects genuinely invalid image bytes with a named ImageSourceCorruptError (not a silent fallback, and not an undifferentiated throw)", async () => {
  const transformer = new SharpImageTransformer();
  await assert.rejects(
    () =>
      transformer.transform({
        bytes: new TextEncoder().encode("not-real-image-bytes"),
        params: { width: 100, height: 100, format: "jpeg" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ImageSourceCorruptError, `expected ImageSourceCorruptError, got ${String(error)}`);
      return true;
    }
  );
});

// A minimal, deliberately-malformed GIF: a valid GIF89a signature/logical-screen-descriptor
// followed by a frame libvips (sharp's decoder) rejects — this is the SAME failure class the live
// defect this test guards against actually hit (a real, small user-uploaded GIF whose bytes pass
// this package's own magic-byte sniff, `sniffContentType`, yet cannot be decoded by `sharp`). Proves
// the fix does not only cover "not an image at all" but also "sniffs as an image, isn't really
// decodable" — the exact gap that produced an opaque 500 on the live route.
const MALFORMED_GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
  0x08, 0x00, 0x08, 0x00, // 8x8 logical screen descriptor
  0x80, 0x00, 0x3f, // packed fields / bg color / aspect ratio
  0xff, 0xff, 0xc0, // truncated/invalid global color table + no valid image-descriptor/frame data
]);

test("SharpImageTransformer.transform rejects a malformed GIF that passes this package's own magic-byte sniff but is not really decodable", async () => {
  const transformer = new SharpImageTransformer();
  await assert.rejects(
    () => transformer.transform({ bytes: MALFORMED_GIF, params: { format: "webp" } }),
    (error: unknown) => {
      assert.ok(error instanceof ImageSourceCorruptError, `expected ImageSourceCorruptError, got ${String(error)}`);
      return true;
    }
  );
});

test("ImageTransformUnavailableError stays exported and instantiable for environments without 'sharp'", () => {
  const err = new ImageTransformUnavailableError("the 'sharp' npm package is not installed");
  assert.ok(err instanceof Error);
  assert.match(err.message, /sharp/i);
});

/**
 * Builds a real multi-frame animated GIF (three distinct solid-color frames) via `sharp`'s own
 * `join({ animated: true })` API — the same fixture-construction technique this test file already
 * uses for its "actually resizes" test, applied to a genuinely multi-page source instead of a
 * synthetic single frame. Used below to prove animation survives `SharpImageTransformer.transform`
 * end to end, not just that the call succeeds or that bytes changed.
 */
async function buildAnimatedGif(): Promise<Buffer> {
  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ];
  const frames = await Promise.all(
    colors.map((background) =>
      sharp({ create: { width: 20, height: 10, channels: 3, background } })
        .png()
        .toBuffer()
    )
  );
  return sharp(frames, { join: { animated: true } }).gif().toBuffer();
}

test("SharpImageTransformer.transform preserves every frame of an animated GIF when the target format can carry animation (webp)", async () => {
  const transformer = new SharpImageTransformer();
  const animatedGif = await buildAnimatedGif();
  const sourceMeta = await sharp(animatedGif, { animated: true }).metadata();
  assert.strictEqual(sourceMeta.pages, 3, "fixture must actually be 3 frames, or this test proves nothing");

  const result = await transformer.transform({
    bytes: new Uint8Array(animatedGif),
    params: { format: "webp" },
  });

  const outMeta = await sharp(Buffer.from(result.bytes), { animated: true }).metadata();
  assert.strictEqual(outMeta.format, "webp");
  // The bug this guards against: sharp decodes only frame 0 without `{ animated: true }` on load,
  // silently flattening every animated GIF/WebP served through the "public" transform to a still.
  // `pages` would read back as `undefined` (single-frame) under that bug — asserting the exact
  // frame count (not merely "> 1" or "no error") is what catches a regression to that behavior.
  assert.strictEqual(outMeta.pages, 3, "output must retain all 3 source frames, not flatten to a still");
});

test("SharpImageTransformer.transform keeps animation frame-accurate (not squashed) across a real resize", async () => {
  const transformer = new SharpImageTransformer();
  const animatedGif = await buildAnimatedGif();

  const result = await transformer.transform({
    bytes: new Uint8Array(animatedGif),
    params: { width: 10, height: 5, fit: "cover", format: "webp" },
  });

  const outMeta = await sharp(Buffer.from(result.bytes), { animated: true }).metadata();
  assert.strictEqual(outMeta.pages, 3, "resize must not drop frames");
  assert.strictEqual(outMeta.width, 10);
  // The trap a naive `{ animated: true }`-only fix falls into: sharp represents multi-frame images
  // as one tall vertical strip, with `pageHeight` carrying the PER-FRAME height. `pageHeight` must
  // equal the requested `height` (5) — if the resize instead treated 5 as the TOTAL strip height,
  // `pageHeight` would read back as `5 / 3` (not an integer) and the real per-frame image would be
  // squashed to a sliver.
  assert.strictEqual(outMeta.pageHeight, 5, "each frame must be resized to the requested height, not the whole strip");
  assert.strictEqual(outMeta.height, 15, "total strip height must be pageHeight * frame count (5 * 3)");
});

test("SharpImageTransformer.transform deliberately flattens an animated source to one representative frame when the target format cannot carry animation (jpeg)", async () => {
  const transformer = new SharpImageTransformer();
  const animatedGif = await buildAnimatedGif();

  const result = await transformer.transform({
    bytes: new Uint8Array(animatedGif),
    params: { format: "jpeg" },
  });

  const outMeta = await sharp(Buffer.from(result.bytes)).metadata();
  assert.strictEqual(outMeta.format, "jpeg");
  // JPEG cannot carry animation. The regression this guards against is worse than a plain flatten:
  // loading with `{ animated: true }` unconditionally and then encoding to a non-animated format
  // makes sharp write out the whole multi-frame "toilet roll" as ONE tall static image (all frames
  // stacked, visibly corrupted) instead of either a clean single frame or a real animated output.
  // A correctly-flattened single frame must report the SOURCE frame's own height (10), not
  // `pageHeight * frameCount` (30).
  assert.strictEqual(outMeta.height, 10, "must be a single clean frame, not all frames stacked into one image");
  assert.strictEqual(outMeta.pages, undefined);
});
