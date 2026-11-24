/** @file `rendition-negotiation.ts`: transform-spec parse, weak/list/wildcard If-None-Match, Cache-Control choice. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { ifNoneMatchSatisfied, PRIVATE_NO_STORE, renditionCacheControl, resolveRenditionTransformSpec, REVALIDATING_PUBLIC } from "../rendition-negotiation.js";

test("transform spec: name.vN parses; a missing marker, empty asset id, v0 and an oversized digit run are the two malformed errors", () => {
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "a", transformSpec: "thumb.v3" }), { transformName: "thumb", version: 3 });
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "a", transformSpec: "my.name.v12" }), { transformName: "my.name", version: 12 });
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "a", transformSpec: "thumb" }), { errorMessage: "malformed media rendition URL" });
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "", transformSpec: "thumb.v1" }), { errorMessage: "malformed media rendition URL" });
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "a", transformSpec: "thumb.v0" }), { errorMessage: "malformed transform version" });
  assert.deepEqual(resolveRenditionTransformSpec({ assetId: "a", transformSpec: `thumb.v${"9".repeat(400)}` }), { errorMessage: "malformed transform version" });
});

test("If-None-Match: weak comparison, lists and the wildcard match; absent or different validators do not", () => {
  const etag = 'W/"abc"';
  for (const header of ['W/"abc"', '"abc"', '"x", W/"abc"', " * "]) assert.equal(ifNoneMatchSatisfied({ header, etag }), true, header);
  for (const header of [undefined, "", '"other"']) assert.equal(ifNoneMatchSatisfied({ header, etag }), false, String(header));
});

test("Cache-Control: a gated 200 is private no-store, an ungated one revalidates publicly", () => {
  assert.equal(renditionCacheControl({ gated: true }), PRIVATE_NO_STORE);
  assert.equal(renditionCacheControl({ gated: false }), REVALIDATING_PUBLIC);
  assert.equal(REVALIDATING_PUBLIC, "public, max-age=60");
});
