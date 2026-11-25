import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";
import module from "../object-stores/vercel-blob.mjs";

// Share artifacts already minted by hosts use `_share/<16 letters>/<name>.tovu.zip`; both readers
// accept only that spelling, so it is the current wire format and must not be renamed in place.
const blobToken = "vercel_blob_rw_store123_secret";
const origin = "https://store123.public.blob.vercel-storage.com";
const key = `_share/${"a".repeat(16)}/site.tovu.zip`;

function store(fetch) {
  const kit = { ...createFakeDeployHostKit(), fetch };
  return module.createArtifactStore({ credential: { blobToken }, kit });
}

test("the existing .tovu.zip share key still uploads and keeps its public URL", async () => {
  const s = await store(async () => new Response(JSON.stringify({ url: `${origin}/${key}` }), { status: 200 }));
  assert.deepEqual(await s.upload({ key, bytes: new Uint8Array([1]), headers: {} }), { url: `${origin}/${key}?download=1` });
});

test("a key with another suffix is refused rather than guessed at", async () => {
  const s = await store(async () => { throw new Error("must not fetch"); });
  await assert.rejects(s.upload({ key: key.replace(".tovu.zip", ".jini.zip"), bytes: new Uint8Array([1]), headers: {} }), { message: "Invalid share artifact key." });
});
