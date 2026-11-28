import assert from "node:assert/strict";
import { test } from "vitest";
import type { ImageCodecPort } from "../image-codec.js";
import { withChatPreview } from "../chat-preview.js";
import { withChatPreview as withSiteChatPreview } from "../site/chat-preview.js";

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

test("site chat envelope links raster previews without making a missing codec or a failed encode fatal", async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const request = { bytes, contentType: "image/png", result: { media: { title: "Garden", publicUrl: "/m/garden/original" } } };
  const calls: Parameters<ImageCodecPort["encode"]>[0][] = [];
  let broken = false;
  const imageCodec: ImageCodecPort = {
    inspect: async () => { throw new Error("unexpected inspect"); },
    encode: async input => { calls.push(input); if (broken) throw new Error("cannot encode"); return { bytes: Uint8Array.from([1, 2, 3]), width: 64, height: 32 }; },
    encodeTiles: async () => { throw new Error("unexpected encodeTiles"); },
  };
  const routeDeps = { imageCodec };
  assert.deepEqual(await withSiteChatPreview({ ...request, routeDeps }), { content: [
    { type: "text", text: '{"media":{"title":"Garden","publicUrl":"/m/garden/original"}}' },
    { type: "image", mimeType: "image/webp", data: "AQID", title: "Garden", href: "/m/garden/original" },
  ] });
  assert.deepEqual(calls, [{ source: bytes, autoOrient: true, format: "webp", quality: 70,
    resize: { width: 320, height: 320, fit: "inside", withoutEnlargement: true } }]);
  assert.equal(await withSiteChatPreview({ ...request, routeDeps: {} }), request.result);
  for (const contentType of ["image/svg+xml", "video/mp4"]) {
    assert.equal(await withSiteChatPreview({ ...request, routeDeps, contentType }), request.result);
  }
  assert.equal(calls.length, 1);
  broken = true;
  assert.equal(await withSiteChatPreview({ ...request, routeDeps }), request.result);
  assert.equal(calls.length, 2);
});

test("the media envelope links a published preview, and the site envelope omits the link while unpublished", async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const imageCodec: ImageCodecPort = {
    inspect: async () => { throw new Error("unexpected inspect"); },
    encode: async () => ({ bytes: Uint8Array.from([7, 8]), width: 4, height: 4 }),
    encodeTiles: async () => { throw new Error("unexpected encodeTiles"); },
  };
  const published = { media: { title: "Pond", publicUrl: "/m/pond/original" } };
  assert.deepEqual(await withChatPreview({ routeDeps: { imageCodec }, bytes, contentType: "image/jpeg", result: published }), { content: [
    { type: "text", text: '{"media":{"title":"Pond","publicUrl":"/m/pond/original"}}' },
    { type: "image", mimeType: "image/webp", data: "Bwg=", title: "Pond", href: "/m/pond/original" },
  ] });
  const unpublished = { media: { title: "Draft", publicUrl: null } };
  assert.deepEqual(await withSiteChatPreview({ routeDeps: { imageCodec }, bytes, contentType: "image/jpeg", result: unpublished }), { content: [
    { type: "text", text: '{"media":{"title":"Draft","publicUrl":null}}' },
    { type: "image", mimeType: "image/webp", data: "Bwg=", title: "Draft" },
  ] });
});
