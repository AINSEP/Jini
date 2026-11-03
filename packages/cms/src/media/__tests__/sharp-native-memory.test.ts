import assert from "node:assert/strict";
import { test } from "vitest";
import { ImageTransformUnavailableError, SharpImageTransformer, type SharpInstance } from "../image-transformer.sharp.js";

function nativeHarness() {
  const calls: unknown[][] = [];
  const pipeline: SharpInstance = {
    rotate: () => pipeline,
    resize: () => pipeline,
    flatten: () => pipeline,
    toFormat: () => pipeline,
    toBuffer: async () => Buffer.from([9]),
  };
  const factory = Object.assign(() => { calls.push(["open"]); return pipeline; }, {
    cache: (value: boolean) => { calls.push(["cache", value]); },
    concurrency: (value: number) => { calls.push(["concurrency", value]); },
  });
  let loads = 0;
  const loadSharp = () => { loads++; return factory; };
  return { calls, pipeline, factory, loadSharp, loads: () => loads };
}

const image = { bytes: new Uint8Array([1]), params: { width: 1, format: "webp" as const } };

test("resizing images disables native caching and limits CPU threads once before the first transform", async () => {
  const h = nativeHarness();
  const first = new SharpImageTransformer({}, { loadSharp: h.loadSharp });
  const second = new SharpImageTransformer({}, { loadSharp: h.loadSharp });
  assert.equal(h.loads(), 0, "constructing the server's adapters must not load a native codec");
  assert.deepEqual(h.calls, []);
  const results = await Promise.all([first.transform(image), second.transform(image), first.transform(image)]);
  assert.deepEqual(h.calls, [["cache", false], ["concurrency", 1], ["open"], ["open"], ["open"]]);
  assert.ok(results.every((result) => result.bytes[0] === 9 && result.contentType === "image/webp"));
});

test("image inspection and resizing share the same native memory limits", async () => {
  const h = nativeHarness();
  const metadata = { width: 1, height: 1, format: "png", hasAlpha: false, autoOrient: { width: 1, height: 1 } };
  Object.assign(h.pipeline, { metadata: async () => metadata });
  const codec = new SharpImageTransformer({}, { loadSharp: h.loadSharp });
  assert.deepEqual(await codec.inspect({ source: image.bytes }), metadata);
  await codec.transform(image);
  assert.deepEqual(h.calls, [["cache", false], ["concurrency", 1], ["open"], ["open"]]);
});

test("a failed native memory configuration refuses the transform and is retried on the next request", async () => {
  const h = nativeHarness();
  const cause = new Error("native configuration failed");
  let attempts = 0;
  h.factory.concurrency = (value) => {
    h.calls.push(["concurrency", value]);
    if (++attempts === 1) throw cause;
  };
  const codec = new SharpImageTransformer({}, { loadSharp: h.loadSharp });
  await assert.rejects(codec.transform(image), (error: unknown) => {
    assert.ok(error instanceof ImageTransformUnavailableError);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.deepEqual(h.calls, [["cache", false], ["concurrency", 1]]);
  await codec.transform(image);
  assert.deepEqual(h.calls.slice(2), [["cache", false], ["concurrency", 1], ["open"]]);
});
