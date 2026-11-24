import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * @file image-ops receives a codec rather than constructing the native vendor itself. Moved from the
 * host's image-transform boundary test with the module; the host keeps its three remaining consumers.
 */
test("image-ops keeps native image codecs behind the port", () => {
  const source = readFileSync(new URL("../image-ops.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from\s*|import\(\s*|require\(\s*)["']sharp["']/);
});

// media_view_image moved from the host with this assertion; it, too, decodes through the injected codec.
test("media/site/view-image-tool keeps native image codecs behind the port", () => {
  const source = readFileSync(new URL("../../site/view-image-tool.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from\s*|import\(\s*|require\(\s*)["']sharp["']/);
});
