import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";
import module from "../object-stores/vercel-blob.mjs";

// Share fixtures use host-selected suffixes; the provider consumes the host’s exact key rule.
// Production share wire formats remain host-owned and must not be renamed in place.
const blobToken = "vercel_blob_rw_store123_secret";
const origin = "https://store123.public.blob.vercel-storage.com";
const key = `_share/${"a".repeat(16)}/site.alpha.zip`;

function store(fetch) {
  const kit = { ...createFakeDeployHostKit(), fetch, isShareArtifactKey: ({ key }) => /^_share\/[A-Za-z]{16}\/[a-z0-9][a-z0-9-]{0,79}\.alpha\.zip$/.test(key) };
  return module.createArtifactStore({ credential: { blobToken }, kit });
}

test("the injected .alpha.zip share key uploads and keeps its public URL", async () => {
  const s = await store(async () => new Response(JSON.stringify({ url: `${origin}/${key}` }), { status: 200 }));
  assert.deepEqual(await s.upload({ key, bytes: new Uint8Array([1]), headers: {} }), { url: `${origin}/${key}?download=1` });
});

test("a key with another suffix is refused rather than guessed at", async () => {
  const s = await store(async () => { throw new Error("must not fetch"); });
  await assert.rejects(s.upload({ key: key.replace(".alpha.zip", ".beta.zip"), bytes: new Uint8Array([1]), headers: {} }), { message: "Invalid share artifact key." });
});

test("the same provider follows the key rule of the host that built it", async () => {
  for (const suffix of ["alpha", "beta"]) {
    const calls = [];
    const key = `_share/${"a".repeat(16)}/site.${suffix}.zip`;
    const otherKey = key.replace(`.${suffix}.zip`, suffix === "alpha" ? ".beta.zip" : ".alpha.zip");
    const kit = { ...createFakeDeployHostKit(),
      isShareArtifactKey: ({ key }) => new RegExp(`^_share/[A-Za-z]{16}/[a-z0-9][a-z0-9-]{0,79}\\.${suffix}\\.zip$`).test(key),
      fetch: async (url, init) => {
        calls.push(init.method);
        return init.method === "PUT" ? new Response(JSON.stringify({ url: `${origin}/${key}` }), { status: 200 })
          : new Response(null, { status: 200, headers: { "content-length": "1", "content-type": "application/zip" } });
      },
    };
    const s = await module.createArtifactStore({ credential: { blobToken }, kit });
    assert.deepEqual(await s.upload({ key, bytes: new Uint8Array([1]), headers: {} }), { url: `${origin}/${key}?download=1` });
    await s.delete({ key });
    assert.equal(await s.verify({ key, url: `${origin}/${key}?download=1`, present: true, bytes: 1 }), true);
    assert.deepEqual(calls, ["PUT", "POST", "HEAD"]);
    calls.length = 0;
    await assert.rejects(s.upload({ key: otherKey, bytes: new Uint8Array([1]), headers: {} }), { message: "Invalid share artifact key." });
    await assert.rejects(s.delete({ key: otherKey }), { message: "Invalid share artifact key." });
    await assert.rejects(s.verify({ key: otherKey, url: `${origin}/${otherKey}?download=1`, present: true, bytes: 1 }), { message: "Invalid share artifact key." });
    assert.deepEqual(calls, []);
    delete kit.isShareArtifactKey;
    await assert.rejects(s.delete({ key }), { message: "Invalid share artifact key." });
    assert.deepEqual(calls, []);
  }
});

test("only a separate Vercel read-write blob credential is accepted for share artifacts", () => {
  assert.equal(module.acceptsArtifactCredential({ credential: { token: "deploy-only", blobToken } }), true);
  for (const credential of [undefined, { token: "deploy-only" }, { blobToken: 42 }, { blobToken: "vercel_blob_ro_store123_secret" }]) {
    assert.equal(module.acceptsArtifactCredential({ credential }), false);
  }
});

test("Blob refuses site-media storage even when a share credential is configured", () => {
  assert.deepEqual(module.create({ credential: { token: "deploy-only", blobToken } }), {
    status: "rejected", error: { code: "not_configured", message: "Vercel Blob is used for share links only, not site media." },
  });
});
