import assert from "node:assert/strict";
import { test } from "vitest";
import type { ImageCodecPort } from "../image-codec.js";
import { withChatPreview } from "../chat-preview.js";

test("preview skips unsanitized SVG and non-images, and preserves successful writes on codec failure", async () => {
  let encodeCalls = 0;
  const imageCodec: ImageCodecPort = {
    inspect: async () => { throw new Error("unexpected inspect"); },
    encode: async () => { encodeCalls += 1; throw new Error("codec unavailable"); },
    encodeTiles: async () => { throw new Error("unexpected encodeTiles"); },
  };
  const result = { media: { title: "saved", publicUrl: null, id: "saved-id" } };
  const bytes = new Uint8Array([1, 2, 3]);
  for (const contentType of ["image/svg+xml", "video/mp4", "audio/mpeg"]) {
    assert.strictEqual(await withChatPreview({ routeDeps: { imageCodec }, bytes, contentType, result }), result);
  }
  assert.equal(encodeCalls, 0, "untrusted SVG and non-images never reach the rasterizer");
  assert.strictEqual(await withChatPreview({ routeDeps: {}, bytes, contentType: "image/png", result }), result);
  assert.strictEqual(await withChatPreview({ routeDeps: { imageCodec }, bytes, contentType: "image/png", result }), result);
  assert.equal(encodeCalls, 1, "an encode failure keeps the original successful result");
});

test("preview without a public URL omits the link and never enlarges a small image", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const previewBytes = new Uint8Array([4, 5, 6]);
  const calls: Parameters<ImageCodecPort["encode"]>[0][] = [];
  const imageCodec: ImageCodecPort = {
    inspect: async () => { throw new Error("unexpected inspect"); },
    encode: async input => { calls.push(input); return { bytes: previewBytes, width: 16, height: 8 }; },
    encodeTiles: async () => { throw new Error("unexpected encodeTiles"); },
  };
  const result = { media: { title: "small", publicUrl: null } };
  const reply = await withChatPreview({ routeDeps: { imageCodec }, bytes, contentType: "image/png", result });
  assert.deepEqual(calls, [{ source: bytes, autoOrient: true, format: "webp", quality: 70,
    resize: { width: 320, height: 320, fit: "inside", withoutEnlargement: true } }]);
  assert.ok("content" in reply);
  const image = reply.content.find(block => block.type === "image")!;
  assert.equal(Object.hasOwn(image, "href"), false);
  assert.equal(image.title, "small");
  assert.equal(image.mimeType, "image/webp");
  assert.equal(image.data, Buffer.from(previewBytes).toString("base64"));
  assert.deepEqual(JSON.parse(reply.content[0]!.text!), result);
});
