import { createHash } from "node:crypto";
/**
 * @file Decision-core tests for `original-response.ts`: the framework-neutral `{ status, headers, body }`
 * a host writes when serving a media asset's original bytes (status, header and byte decisions for full,
 * Range 206, bad-range 416, forced-download, SVG CSP, document disposition, and lookup outcomes).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseRangeHeader } from "@jini-ai/http-kit/range";

import { InMemoryBlobStore } from "../blob-store.memory.js";
import { trashMedia, uploadMedia } from "../media-service.js";
import {
  decideMediaOriginalForAsset, decideMediaOriginalReply, inlineOriginalType, lookupMediaOriginalBlob,
  SVG_CONTENT_SECURITY_POLICY, type MediaOriginalType,
} from "../original-response.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";

const BYTES = new TextEncoder().encode("0123456789ABCDEFGHIJ"); // 20 bytes, indices 0-19
const PNG: MediaOriginalType = { safe: "image/png", disposition: null };
const SAFE_HEADERS: Array<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["Content-Security-Policy", "default-src 'none'; sandbox"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
  ["Cache-Control", "private, no-store"],
  ["Content-Type", "image/png"],
  ["Accept-Ranges", "bytes"],
];
const text = (body: Uint8Array | null) => new TextDecoder().decode(body ?? new Uint8Array());

test("full body: 200 with the security headers and the exact bytes", () => {
  const reply = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: undefined, type: PNG });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.headers, SAFE_HEADERS);
  assert.deepEqual(reply.body, BYTES);
});

test("Range: a satisfiable range is a 206 whose Content-Range and body cover the inclusive end byte", () => {
  const mid = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: "bytes=8-11", type: PNG });
  assert.equal(mid.status, 206);
  assert.deepEqual(mid.headers, [...SAFE_HEADERS, ["Content-Range", "bytes 8-11/20"]]);
  assert.equal(text(mid.body), "89AB");
  const last = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: "bytes=19-19", type: PNG });
  assert.equal(text(last.body), "J");
  const clamped = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: "bytes=15-9999", type: PNG });
  assert.deepEqual([clamped.status, text(clamped.body), clamped.headers.at(-1)], [206, "FGHIJ", ["Content-Range", "bytes 15-19/20"]]);
  const suffix = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: "bytes=-5", type: PNG });
  assert.equal(text(suffix.body), "FGHIJ");
});

test("Range: unsatisfiable is a body-less 416 with `bytes */total`; malformed and multi-range are ignored (200)", () => {
  const bad = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: "bytes=20-30", type: PNG });
  assert.deepEqual([bad.status, bad.body, bad.headers.at(-1)], [416, null, ["Content-Range", "bytes */20"]]);
  for (const header of ["bytes=abc-def", "bytes=0-4,10-14"]) {
    assert.equal(decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: header, type: PNG }).status, 200, header);
  }
});

test("types: SVG gets the SVG CSP; sniffed HTML/XHTML is forced to an octet-stream attachment", () => {
  const svg = decideMediaOriginalReply({ deps: { parseRangeHeader }, bytes: BYTES, rangeHeader: undefined, type: inlineOriginalType({ sniffed: "image/svg+xml" }) });
  assert.deepEqual(svg.headers.find(([name]) => name === "Content-Security-Policy"), ["Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY]);
  for (const sniffed of ["text/html", "application/xhtml+xml"]) {
    assert.deepEqual(inlineOriginalType({ sniffed }), { safe: "application/octet-stream", disposition: "attachment" });
  }
  assert.deepEqual(inlineOriginalType({ sniffed: "video/mp4" }), { safe: "video/mp4", disposition: null });
});

function makeDeps() {
  let n = 0;
  return {
    createHash, clock: { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") }, idGen: { newId: () => `id-${(n += 1)}` },
    mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore(),
  };
}
const upload = (deps: ReturnType<typeof makeDeps>, bytes: Uint8Array, filename: string) =>
  uploadMedia({ deps, input: { workspaceId: "ws", bytes, filename, contentType: "image/png", createdByPrincipal: "u" } });

test("lookup: ok by id and slug, not-found, trashed, and a thrown data-integrity gap", async () => {
  const deps = makeDeps();
  const { media } = await upload(deps, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), "a.png");
  const lookupDeps = { mediaRepo: deps.mediaRepo, assetBlobRepo: deps.blobRepo };
  const byId = await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "ws", mediaId: media.id } });
  assert.equal(byId.outcome, "ok");
  assert.equal((await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "ws", mediaId: media.slug } })).outcome, "ok");
  assert.deepEqual(await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "ws", mediaId: "nope" } }), { outcome: "not-found" });
  assert.deepEqual(await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "other", mediaId: media.id } }), { outcome: "not-found" });

  const gap = { ...lookupDeps, assetBlobRepo: { ...deps.blobRepo, findByHash: async () => null } as unknown as InMemoryAssetBlobRepo };
  await assert.rejects(lookupMediaOriginalBlob({ deps: gap, params: { workspaceId: "ws", mediaId: media.id } }), /source blob for sha256 .* was not found/);

  await trashMedia({ deps: { clock: deps.clock, mediaRepo: deps.mediaRepo }, input: { workspaceId: "ws", id: media.id } });
  assert.deepEqual(await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "ws", mediaId: media.id } }), { outcome: "trashed" });
});

test("asset: inline original is sniffed (HTML declared as png becomes a download) and a document is an RFC 5987 attachment", async () => {
  const deps = makeDeps();
  const html = new TextEncoder().encode("<!doctype html><html><body>x</body></html>");
  const { media } = await upload(deps, html, "evil.png");
  const lookupDeps = { mediaRepo: deps.mediaRepo, assetBlobRepo: deps.blobRepo };
  const found = await lookupMediaOriginalBlob({ deps: lookupDeps, params: { workspaceId: "ws", mediaId: media.id } });
  assert.equal(found.outcome, "ok");
  if (found.outcome !== "ok") return;
  const reply = await decideMediaOriginalForAsset({ deps: { blobStore: deps.blobStore, parseRangeHeader }, media: found.media, blob: found.blob, rangeHeader: undefined });
  assert.deepEqual(reply.headers.filter(([name]) => /^Content-(Type|Disposition)$/.test(name)), [["Content-Type", "application/octet-stream"], ["Content-Disposition", "attachment"]]);
  assert.deepEqual(reply.body, html);

  const doc = { ...found.media, kind: "document" as const, title: "Q3 'plan' (v2)", originalFilename: "plan.txt" };
  const docReply = await decideMediaOriginalForAsset({ deps: { blobStore: deps.blobStore, parseRangeHeader }, media: doc, blob: found.blob, rangeHeader: "bytes=0-3" });
  assert.equal(docReply.status, 206);
  assert.deepEqual(docReply.headers.find(([name]) => name === "Content-Disposition"), ["Content-Disposition", `attachment; filename="document"; filename*=UTF-8''Q3%20%27plan%27%20%28v2%29.txt`]);
  // A title that starts with U+FEFF keeps it (%EF%BB%BF): the default TextDecoder strips a leading BOM.
  const bom = { ...doc, title: "\uFEFFplan", originalFilename: "plan.txt" };
  const bomReply = await decideMediaOriginalForAsset({ deps: { blobStore: deps.blobStore, parseRangeHeader }, media: bom, blob: found.blob, rangeHeader: "bytes=0-3" });
  assert.equal(bomReply.headers.find(([name]) => name === "Content-Disposition")?.[1].includes("filename*=UTF-8''%EF%BB%BFplan"), true);
});

test("lookup: an unknown media id is `not-found` for the caller to render, without ever reading a blob", async () => {
  let reads = 0;
  const outcome = await lookupMediaOriginalBlob({ deps: {
    mediaRepo: { findBySlug: async () => null, findById: async () => null } as unknown as InMemoryMediaRepo,
    assetBlobRepo: { findByHash: async () => { reads++; return null; } } as unknown as InMemoryAssetBlobRepo,
  }, params: { workspaceId: "ws", mediaId: "unknown" } });
  assert.deepEqual(outcome, { outcome: "not-found" });
  assert.equal(reads, 0);
});

test("document downloads refuse a known oversized object before reading its contents", async () => {
  const deps = makeDeps();
  const { media } = await uploadMedia({ deps, input: { workspaceId: "ws", kind: "document", bytes: Buffer.from("Notes"),
    filename: "planning.txt", contentType: "text/plain", createdByPrincipal: "u" } });
  const found = await lookupMediaOriginalBlob({ deps: { mediaRepo: deps.mediaRepo, assetBlobRepo: deps.blobRepo },
    params: { workspaceId: "ws", mediaId: media.id } });
  assert.equal(found.outcome, "ok");
  const sizeQueries: unknown[] = [];
  let reads = 0;
  const blobStore = Object.assign(deps.blobStore, {
    sizeOf: async (input: { storageKey: string }) => { sizeQueries.push(input); return 50 * 1024 * 1024 + 1; },
    get: async () => { reads++; throw new Error("oversize bytes must not be read"); },
  });
  await assert.rejects(decideMediaOriginalForAsset({ deps: { blobStore, parseRangeHeader }, media: found.media, blob: found.blob, rangeHeader: undefined }),
    new Error("document exceeds size limit"));
  assert.deepEqual(sizeQueries, [{ storageKey: found.blob.storageKey }]);
  assert.equal(reads, 0);
});
