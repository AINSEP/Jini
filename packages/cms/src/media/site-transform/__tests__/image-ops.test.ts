import { SharpImageTransformer } from "../../node.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import sharp from "sharp";

import { IMAGE_LIMITS, ImageTransformError, inspectImage, normalizeOutputs, renderOutputs } from "../image-ops.js";

/**
 * @file The pure, sharp-backed half of `image_transform`: output validation and caps, every resize
 * fit's resulting dimensions, the ICO container, metadata stripping and inspect. No filesystem.
 */

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();

const render = async (source: Buffer, outputs: unknown[], limits = {}) =>
  renderOutputs({ source, imageCodec: new SharpImageTransformer(), outputs: normalizeOutputs({ outputs }) }, { limits });

/** Reads an ICO directory: count, then each entry's width and its PNG payload's signature. */
function readIco(bytes: Buffer): { sizes: number[]; pngs: boolean[] } {
  assert.equal(bytes.readUInt16LE(2), 1, "type 1 = icon");
  const count = bytes.readUInt16LE(4);
  const entries = Array.from({ length: count }, (_, index) => 6 + 16 * index);
  return {
    sizes: entries.map((at) => bytes.readUInt8(at) || 256),
    pngs: entries.map((at) => bytes.subarray(bytes.readUInt32LE(at + 12), bytes.readUInt32LE(at + 12) + 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))),
  };
}

test("contain, cover, inside and fill give the documented dimensions", async () => {
  const source = await png(200, 100);
  const out = await render(source, [
    { path: "a.png", format: "png", resize: { width: 50, height: 50, fit: "contain" } },
    { path: "b.png", format: "png", resize: { width: 50, height: 50, fit: "cover" } },
    { path: "c.png", format: "png", resize: { width: 50, height: 50, fit: "inside" } },
    { path: "d.webp", format: "webp", resize: { width: 30, height: 70, fit: "fill" } },
  ]);
  assert.deepEqual(out.map(({ width, height }) => [width, height]), [[50, 50], [50, 50], [50, 25], [30, 70]]);
  assert.equal((await sharp(out[3]!.bytes).metadata()).format, "webp");
});

test("withoutEnlargement keeps a small source small; extract, rotate and jpeg flatten apply", async () => {
  const out = await render(await png(40, 20), [
    { path: "a.png", format: "png", resize: { width: 400, withoutEnlargement: true } },
    { path: "b.jpg", format: "jpeg", extract: { left: 0, top: 0, width: 10, height: 20 }, rotate: 90, quality: 70 },
  ]);
  assert.deepEqual([out[0]!.width, out[0]!.height], [40, 20]);
  assert.deepEqual([out[1]!.width, out[1]!.height], [20, 10]);
  assert.equal((await sharp(out[1]!.bytes).metadata()).hasAlpha, false);
});

test("ico bundles exactly the requested square sizes as PNG entries (default 16/32/48)", async () => {
  const source = await png(300, 200);
  const [custom, standard] = await render(source, [
    { path: "favicon.ico", format: "ico", icoSizes: [16, 32, 64, 256] },
    { path: "f.ico", format: "ico" },
  ]);
  assert.deepEqual(readIco(custom!.bytes), { sizes: [16, 32, 64, 256], pngs: [true, true, true, true] });
  assert.deepEqual(readIco(standard!.bytes).sizes, [16, 32, 48]);
  assert.deepEqual([standard!.width, standard!.height], [48, 48]);
});

test("metadata is stripped by default and kept only when asked", async () => {
  const source = await sharp(await png(20, 20)).withExif({ IFD0: { Copyright: "owner" } }).jpeg().toBuffer();
  const [stripped, kept] = await render(source, [
    { path: "a.jpg", format: "jpeg" },
    { path: "b.jpg", format: "jpeg", stripMetadata: false },
  ]);
  assert.equal((await sharp(stripped!.bytes).metadata()).exif, undefined);
  assert.ok((await sharp(kept!.bytes).metadata()).exif);
});

test("caps: output count, dimensions, ico sizes, quality", () => {
  const ok = { path: "a.png", format: "png" };
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `${i}.png`, format: "png" }));
  assert.throws(() => normalizeOutputs({ outputs: many(IMAGE_LIMITS.maxOutputs + 1) }), /1 to 8 outputs/);
  assert.throws(() => normalizeOutputs({ outputs: [] }), /1 to 8 outputs/);
  assert.doesNotThrow(() => normalizeOutputs({ outputs: many(IMAGE_LIMITS.maxOutputs) }));
  assert.throws(() => normalizeOutputs({ outputs: [{ ...ok, resize: { width: IMAGE_LIMITS.maxDimension + 1 } }] }), /resize.width/);
  assert.doesNotThrow(() => normalizeOutputs({ outputs: [{ ...ok, resize: { width: IMAGE_LIMITS.maxDimension } }] }));
  assert.throws(() => normalizeOutputs({ outputs: [{ ...ok, extract: { left: 0, top: 0, width: 0, height: 5 } }] }), /extract.width/);
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "f.ico", format: "ico", icoSizes: [16, 257] }] }), /icoSizes/);
  assert.throws(() => normalizeOutputs({ outputs: [{ ...ok, quality: 0 }] }), /quality/);
  assert.throws(() => normalizeOutputs({ outputs: [ok, ok] }), /more than once/);
});

test("unsupported formats, extension mismatches and unknown keys are refused by name", () => {
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "a.bmp", format: "bmp" }] }), (error: Error) =>
    error instanceof ImageTransformError && /outputs\[0\].*format/.test(error.message));
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "a.jpg", format: "png" }] }), /needs a \.png extension/);
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "a.png", format: "png", sharpen: true }] }), /sharpen/);
});

test("source caps: bytes and pixel count refuse before any output; non-images are refused clearly", async () => {
  const source = await png(100, 100);
  await assert.rejects(() => render(source, [{ path: "a.png", format: "png" }], { maxSourceBytes: 10 }), /larger than 10 bytes/);
  await assert.rejects(() => render(source, [{ path: "a.png", format: "png" }], { maxInputPixels: 9_999 }), /pixels|pixel limit/i);
  await assert.rejects(() => render(Buffer.from("not an image"), [{ path: "a.png", format: "png" }]), ImageTransformError);
  await assert.rejects(() => inspectImage({ imageCodec: new SharpImageTransformer(), source: Buffer.from("%PDF-1.4 nope") }), /not a supported image/);
});

test("inspect reports format, oriented size, alpha and bytes", async () => {
  const source = await png(120, 80);
  assert.deepEqual(await inspectImage({ source, imageCodec: new SharpImageTransformer() }), { format: "png", width: 120, height: 80, hasAlpha: true, bytes: source.length });
});


test("outside resize preserves aspect ratio and refuses derived sides above the cap before encoding", async () => {
  const source = await png(200, 100);
  const [image] = await render(source, [{ path: "outside.png", format: "png", resize: { width: 50, height: 50, fit: "outside" } }]);
  assert.deepEqual([image!.width, image!.height], [100, 50]);
  await assert.rejects(() => render(source, [{ path: "huge.png", format: "png", resize: { width: 8192, height: 8192, fit: "outside" } }]), /8192px/);
  await assert.rejects(() => render(source, [{ path: "huge.png", format: "png", resize: { height: 8192 } }]), /8192px/);
});

test("ico entries remain square with inside/outside and withoutEnlargement on a tiny rectangular source", async () => {
  const [image] = await render(await png(8, 4), [{ path: "tiny.ico", format: "ico", icoSizes: [16, 32], resize: { fit: "inside", withoutEnlargement: true } }]);
  const bytes = image!.bytes;
  assert.deepEqual([bytes[6], bytes[7], bytes[22], bytes[23]], [16, 16, 32, 32]);
  for (const at of [6, 22]) {
    const meta = await sharp(bytes.subarray(bytes.readUInt32LE(at + 12), bytes.readUInt32LE(at + 12) + bytes.readUInt32LE(at + 8))).metadata();
    assert.equal(meta.width, meta.height);
  }
});

test("invalid nested option shapes, missing crop fields and duplicate ICO sizes are rejected", () => {
  const output = { path: "a.png", format: "png" };
  for (const extra of [{ resize: { width: "20" } }, { resize: { fit: "bogus" } }, { extract: { left: 0, top: 0 } }, { flip: "false" }, { stripMetadata: "false" }]) assert.throws(() => normalizeOutputs({ outputs: [{ ...output, ...extra }] }), ImageTransformError);
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "a.ico", format: "ico", icoSizes: [16, 16] }] }), /icoSizes/);
});


test("rendering delegates to the injected codec with the same limits and metadata policy", async () => {
  const source = Buffer.from("fake source");
  const calls: unknown[] = [];
  const imageCodec: import("@jini-ai/cms/media").ImageCodecPort = {
    async inspect(input, limits) {
      calls.push(["inspect", input, limits]);
      return { format: "png", width: 20, height: 10, hasAlpha: true, autoOrient: { width: 20, height: 10 } };
    },
    async encode(input, limits) {
      calls.push(["encode", input, limits]);
      return { bytes: Buffer.from("fake encoded"), width: 10, height: 5 };
    },
    async encodeTiles() { throw new Error("unexpected tile encode"); },
  };
  const outputs = normalizeOutputs({ outputs: [{ path: "test.jpg", format: "jpeg", resize: { width: 10 }, stripMetadata: false }] });
  const rendered = await renderOutputs({ source, outputs, imageCodec });
  assert.deepEqual(rendered, [{ path: "test.jpg", format: "jpeg", width: 10, height: 5, bytes: Buffer.from("fake encoded") }]);
  assert.deepEqual(calls, [
    ["inspect", { source }, IMAGE_LIMITS],
    ["encode", { source, ...outputs[0], autoOrient: true, flatten: { background: "#ffffff" } }, IMAGE_LIMITS],
  ]);
  calls.length = 0;
  const pngOutputs = normalizeOutputs({ outputs: [{ path: "test.png", format: "png", resize: { width: 10 } }] });
  await renderOutputs({ source, outputs: pngOutputs, imageCodec });
  const pngEncode = calls[1] as [string, Record<string, unknown>, unknown];
  assert.deepEqual(pngEncode, ["encode", { source, ...pngOutputs[0], autoOrient: true, flatten: undefined }, IMAGE_LIMITS]);
  assert.ok(Object.hasOwn(pngEncode[1], "flatten"), "a non-JPEG encode still names flatten (explicitly undefined) for the injected codec");
  calls.length = 0;
  await assert.rejects(() => renderOutputs({ source, outputs: normalizeOutputs({ outputs: [{ path: "wide.png", format: "png", resize: { width: 8192, height: 8192, fit: "outside" } }] }), imageCodec }), /8192/);
  assert.deepEqual(calls, [["inspect", { source }, IMAGE_LIMITS]], "oversized predicted geometry must never encode");
});

type ImageCodecPort = import("@jini-ai/cms/media").ImageCodecPort;
type FakeMeta = Awaited<ReturnType<ImageCodecPort["inspect"]>>;
/** A strict fake codec: fixed source facts, a fixed encode result, every encode request recorded. */
function fakeCodec({ meta, encoded }: { meta: { [K in keyof FakeMeta]?: FakeMeta[K] | undefined }; encoded?: { width: number; height: number } }) {
  const encodes: Record<string, unknown>[] = [];
  const imageCodec: ImageCodecPort = {
    async inspect() { return { format: "png", width: 20, height: 10, hasAlpha: false, autoOrient: { width: 20, height: 10 }, ...meta } as FakeMeta; },
    async encode(input) {
      encodes.push(input as unknown as Record<string, unknown>);
      const { width, height } = encoded ?? { width: input.resize?.width ?? 20, height: input.resize?.height ?? 10 };
      return { bytes: Buffer.from(`px-${width}x${height}`), width, height };
    },
    async encodeTiles() { throw new Error("unexpected tile encode"); },
  };
  return { imageCodec, encodes };
}
const source = Buffer.from("fake source");

test("a null output entry is validated as an empty object and refused for its missing path and format", () => {
  assert.throws(() => normalizeOutputs({ outputs: [{ path: "ok.png", format: "png" }, null] }), (error: Error) =>
    error instanceof ImageTransformError && error.message.startsWith("outputs[1]: ") && /"path"/.test(error.message) && /"format"/.test(error.message));
});

test("source facts the codec reports are capped: unknown or unsupported format, too many pixels", async () => {
  const output = normalizeOutputs({ outputs: [{ path: "a.png", format: "png" }] });
  const formatless = fakeCodec({ meta: { format: undefined } });
  await assert.rejects(() => renderOutputs({ source, outputs: output, imageCodec: formatless.imageCodec }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "the source is not a supported image (it is undefined)");
  await assert.rejects(() => inspectImage({ source, imageCodec: fakeCodec({ meta: { format: "pdf" } }).imageCodec }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "the source is not a supported image (it is pdf)");
  const huge = fakeCodec({ meta: { width: 101, height: 100 } });
  await assert.rejects(() => renderOutputs({ source, outputs: output, imageCodec: huge.imageCodec }, { limits: { maxInputPixels: 10_000 } }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "the source has more than 10000 pixels");
  const exact = fakeCodec({ meta: { width: 100, height: 100, autoOrient: { width: 100, height: 100 } } });
  assert.equal((await renderOutputs({ source, outputs: output, imageCodec: exact.imageCodec }, { limits: { maxInputPixels: 10_000 } })).length, 1);
  assert.equal(formatless.encodes.length + huge.encodes.length, 0);
});

test("inspect reports a heif source as avif and every other format as itself", async () => {
  const heif = fakeCodec({ meta: { format: "heif", hasAlpha: true, autoOrient: { width: 10, height: 20 } } });
  assert.deepEqual(await inspectImage({ source, imageCodec: heif.imageCodec }), { format: "avif", width: 10, height: 20, hasAlpha: true, bytes: source.length });
  assert.equal((await inspectImage({ source, imageCodec: fakeCodec({ meta: { format: "webp" } }).imageCodec })).format, "webp");
});

test("an encode larger than the per-side cap is refused after the codec answers", async () => {
  const outputs = normalizeOutputs({ outputs: [{ path: "grown.png", format: "png" }] });
  const grown = fakeCodec({ meta: {}, encoded: { width: 30, height: 31 } });
  await assert.rejects(() => renderOutputs({ source, outputs, imageCodec: grown.imageCodec }, { limits: { maxDimension: 30 } }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "grown.png: output exceeds 30px per side");
  const atCap = fakeCodec({ meta: {}, encoded: { width: 30, height: 30 } });
  assert.deepEqual((await renderOutputs({ source, outputs, imageCodec: atCap.imageCodec }, { limits: { maxDimension: 30 } })).map(({ width, height }) => [width, height]), [[30, 30]]);
});

test("ico entries keep a cover fit, every other fit becomes contain", async () => {
  const { imageCodec, encodes } = fakeCodec({ meta: {} });
  const outputs = normalizeOutputs({ outputs: [
    { path: "cover.ico", format: "ico", icoSizes: [16], resize: { fit: "cover", position: "top" } },
    { path: "fill.ico", format: "ico", icoSizes: [32], resize: { fit: "fill" } },
  ] });
  await renderOutputs({ source, outputs, imageCodec });
  assert.deepEqual(encodes.map(({ format, resize }) => [format, resize]), [
    ["png", { fit: "cover", position: "top", width: 16, height: 16, withoutEnlargement: false }],
    ["png", { fit: "contain", width: 32, height: 32, withoutEnlargement: false }],
  ]);
});

test("a direct caller's ico output with no sizes is refused by name without encoding", async () => {
  const { imageCodec, encodes } = fakeCodec({ meta: {} });
  const outputs = [{ path: "empty.ico", format: "ico" as const, stripMetadata: true, icoSizes: [] }];
  await assert.rejects(() => renderOutputs({ source, outputs, imageCodec }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "ICO image has no sizes to render");
  assert.deepEqual(encodes, []);
});

test("a resize naming neither width nor height is refused before any encode", async () => {
  const { imageCodec, encodes } = fakeCodec({ meta: {} });
  const outputs = normalizeOutputs({ outputs: [{ path: "a.png", format: "png", resize: { fit: "inside" } }] });
  await assert.rejects(() => renderOutputs({ source, outputs, imageCodec }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "resize needs width or height");
  assert.deepEqual(encodes, []);
});

test("a codec failure during encode is refused naming the output it was rendering", async () => {
  const { imageCodec } = fakeCodec({ meta: {} });
  imageCodec.encode = async () => { throw new Error("unknown colour 'tealish'"); };
  const outputs = normalizeOutputs({ outputs: [{ path: "tinted.png", format: "png", background: "tealish" }] });
  await assert.rejects(() => renderOutputs({ source, outputs, imageCodec }), (error: Error) =>
    error instanceof ImageTransformError && error.message === "tinted.png: unknown colour 'tealish'");
});
