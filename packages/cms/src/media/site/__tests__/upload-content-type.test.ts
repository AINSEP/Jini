import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveUploadContentType } from "../upload-content-type.js";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("disallowed declarations remain disallowed even when the bytes are an allowed PNG", () => {
  // F4.4: invalid bytes would let the sniffed-type guard mask a missing declared-type guard.
  assert.equal(resolveUploadContentType({ bytes: PNG, declaredContentType: "application/x-msdownload" }), "application/x-msdownload");
  assert.equal(resolveUploadContentType({ bytes: PNG, declaredContentType: "image/svg+xml" }), "image/png");
  assert.equal(resolveUploadContentType({ bytes: PNG, declaredContentType: "" }), "");
});
