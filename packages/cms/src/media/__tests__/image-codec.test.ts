import assert from "node:assert/strict";
import { test } from "vitest";
import { ImageTransformUnavailableError, SharpImageTransformer, type SharpFactory } from "../image-transformer.sharp.js";

/** Structural native fake: the codec owns the pipeline, while callers inject only ImageCodecPort. */
function nativeFake() {
  const calls: { name: string; args: unknown[] }[] = [];
  const metadata = { format: "png", width: 4, height: 5, hasAlpha: true, autoOrient: { width: 4, height: 5 } };
  const pipeline: Record<string, unknown> = {};
  for (const name of ["autoOrient", "extract", "rotate", "flip", "flop", "resize", "flatten", "keepMetadata", "raw", "timeout", "toFormat"]) {
    pipeline[name] = (...args: unknown[]) => { calls.push({ name, args }); return pipeline; };
  }
  pipeline.metadata = async () => metadata;
  pipeline.toBuffer = async (...args: unknown[]) => {
    calls.push({ name: "toBuffer", args });
    return { data: Buffer.from("encoded"), info: { width: 4, height: 5, channels: 4 } };
  };
  const loadSharp = () => ((...args: unknown[]) => { calls.push({ name: "open", args }); return pipeline; }) as unknown as SharpFactory;
  return { codec: new SharpImageTransformer({}, { loadSharp }), calls, metadata };
}

test("codec inspection uses the existing lazy loader and forwards pixel/time limits", async () => {
  const { codec, calls, metadata } = nativeFake();
  assert.equal(calls.length, 0);
  assert.deepEqual(await codec.inspect({ source: Buffer.from("input") }, { maxInputPixels: 100, timeoutSeconds: 2 }), metadata);
  assert.deepEqual(calls, [
    { name: "open", args: [Buffer.from("input"), { limitInputPixels: 100, raw: undefined }] },
    { name: "timeout", args: [{ seconds: 2 }] },
  ]);
});

test("codec keeps geometry order, explicit JPEG background and requested metadata", async () => {
  const { codec, calls } = nativeFake();
  const extract = { left: 0, top: 1, width: 4, height: 4 };
  const resize = { width: 2, fit: "inside" as const };
  assert.deepEqual(await codec.encode({ source: Buffer.from("input"), format: "jpeg", quality: 80,
    autoOrient: true, extract, rotate: 90, flip: true, flop: true, resize, background: "red",
    flatten: { background: "white" }, stripMetadata: false }), { bytes: Buffer.from("encoded"), width: 4, height: 5 });
  assert.deepEqual(calls.map(call => call.name), ["open", "autoOrient", "extract", "rotate", "flip", "flop", "resize", "flatten", "keepMetadata", "toFormat", "toBuffer"]);
  assert.deepEqual(calls.find(call => call.name === "rotate")?.args, [90, { background: "red" }]);
  assert.deepEqual(calls.find(call => call.name === "resize")?.args, [{ ...resize, background: "red" }]);
  assert.deepEqual(calls.find(call => call.name === "toFormat")?.args, ["jpeg", { quality: 80 }]);
  calls.length = 0;
  await codec.encode({ source: Buffer.from("input"), format: "webp" });
  assert.deepEqual(calls.map(call => call.name), ["open", "toFormat", "toBuffer"], "default encoding strips metadata and does not orient or flatten");
});

test("tile encoding resizes once and retains the final partial tile", async () => {
  const { codec, calls } = nativeFake();
  const tiles = await codec.encodeTiles({ source: Buffer.from("input"), maxWidth: 4, tileHeight: 3 }, { quality: 20 });
  assert.deepEqual(tiles.map(({ top, width, height }) => ({ top, width, height })), [{ top: 0, width: 4, height: 3 }, { top: 3, width: 4, height: 2 }]);
  assert.deepEqual(calls.filter(call => call.name === "extract").map(call => call.args), [
    [{ left: 0, top: 0, width: 4, height: 3 }], [{ left: 0, top: 3, width: 4, height: 2 }],
  ]);
  assert.equal(calls.filter(call => call.name === "resize").length, 1);
  assert.equal(calls.filter(call => call.name === "raw").length, 1);
  assert.deepEqual(calls.filter(call => call.name === "toFormat").map(call => call.args), [["jpeg", { quality: 20 }], ["jpeg", { quality: 20 }]]);
  const opens = calls.filter(call => call.name === "open");
  assert.deepEqual(opens[1]?.args[1], { limitInputPixels: undefined, raw: { width: 4, height: 5, channels: 4 } });
  assert.equal(opens.length, 3);
});

test("tile encoding refuses non-progressing geometry before loading a native binary", async () => {
  const { codec, calls } = nativeFake();
  for (const tileHeight of [0, -1, NaN, Infinity, 0.5]) {
    await assert.rejects(() => codec.encodeTiles({ source: new Uint8Array(), maxWidth: 4, tileHeight }), /positive integer/);
  }
  assert.equal(calls.length, 0);
});

test("new codec operations keep the existing named missing-native error", async () => {
  const codec = new SharpImageTransformer({}, { loadSharp: () => { throw new Error("missing"); } });
  await assert.rejects(() => codec.inspect({ source: new Uint8Array() }), ImageTransformUnavailableError);
  await assert.rejects(() => codec.encode({ source: new Uint8Array(), format: "webp" }), ImageTransformUnavailableError);
});
