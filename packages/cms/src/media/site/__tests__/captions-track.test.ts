import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryVersionedMediaRepo, type MediaRecord } from "../../index.js";
import { InMemoryMediaContentTypeStore } from "../content-type-store.js";
import { resolveMediaCaptionsTrack } from "../public-path.js";

const WS = "00000000-0000-4000-8000-0000000000d1";
const VTT = "00000000-0000-4000-8000-0000000000d2";
const JPEG = "00000000-0000-4000-8000-0000000000d3";
const TRASHED = "00000000-0000-4000-8000-0000000000d4";
const row = (id: string, slug: string, sha256: string, status: MediaRecord["status"] = "active"): MediaRecord => ({
  id, workspaceId: WS, slug, title: slug, alt: "", caption: "", credit: "", status, source: { sha256 },
  createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z", version: 1,
  width: null, height: null, cssClass: null, htmlAttributes: null,
});

async function deps() {
  const mediaRepo = new InMemoryVersionedMediaRepo({}, { initialRows: [row(VTT, "cc-en", "b".repeat(64)), row(JPEG, "still", "c".repeat(64)), row(TRASHED, "old-cc", "d".repeat(64), "trashed")] });
  const mediaContentTypeStore = new InMemoryMediaContentTypeStore();
  await mediaContentTypeStore.set({ workspaceId: WS, sha256: "b".repeat(64), contentType: "text/vtt" });
  await mediaContentTypeStore.set({ workspaceId: WS, sha256: "c".repeat(64), contentType: "image/jpeg" });
  await mediaContentTypeStore.set({ workspaceId: WS, sha256: "d".repeat(64), contentType: "text/vtt" });
  return { mediaRepo, mediaContentTypeStore };
}

test("a captions reference resolves to the .vtt asset's public original URL with its language and label", async () => {
  const track = await resolveMediaCaptionsTrack({ deps: await deps(), input: { workspaceId: WS, captions: { assetId: VTT, srclang: "pt-BR", label: "Português" } } });
  assert.deepEqual(track, { src: `/m/cc-en/original.vtt?v=${"b".repeat(12)}`, srclang: "pt-BR", label: "Português" });
});

test("no reference, a missing, trashed or non-WebVTT asset all resolve to no track", async () => {
  const d = await deps();
  assert.equal(await resolveMediaCaptionsTrack({ deps: d, input: { workspaceId: WS, captions: null } }), null);
  for (const assetId of ["00000000-0000-4000-8000-0000000000ff", JPEG, TRASHED]) {
    assert.equal(await resolveMediaCaptionsTrack({ deps: d, input: { workspaceId: WS, captions: { assetId, srclang: "en" } } }), null, assetId);
  }
});

test("a captions reference without a label resolves with a null label", async () => {
  const track = await resolveMediaCaptionsTrack({ deps: await deps(), input: { workspaceId: WS, captions: { assetId: VTT, srclang: "en" } } });
  assert.deepEqual(track, { src: `/m/cc-en/original.vtt?v=${"b".repeat(12)}`, srclang: "en", label: null });
});
