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

import { ImageTransformUnavailableError, SharpImageTransformer } from "../image-transformer.sharp.js";

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

test("SharpImageTransformer.transform rejects genuinely invalid image bytes (not a silent fallback)", async () => {
  const transformer = new SharpImageTransformer();
  await assert.rejects(() =>
    transformer.transform({
      bytes: new TextEncoder().encode("not-real-image-bytes"),
      params: { width: 100, height: 100, format: "jpeg" },
    })
  );
});

test("ImageTransformUnavailableError stays exported and instantiable for environments without 'sharp'", () => {
  const err = new ImageTransformUnavailableError("the 'sharp' npm package is not installed");
  assert.ok(err instanceof Error);
  assert.match(err.message, /sharp/i);
});
