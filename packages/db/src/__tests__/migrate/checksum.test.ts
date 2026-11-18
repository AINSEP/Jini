import assert from "node:assert/strict";
import { test } from "vitest";

import { assertValidSteps, sourceChecksum } from "../../migrate/index.js";

/**
 * @file `sourceChecksum` is the value a consumer pins per shipped step: sha256 hex of the step's
 * text exactly as given (UTF-8), so an edited step stops matching its pin.
 */

test("is the sha256 hex digest of the text, matching the published reference vectors", () => {
  assert.equal(sourceChecksum({ text: "" }), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sourceChecksum({ text: "abc" }), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hashes the UTF-8 bytes of the text, not a single-byte encoding", () => {
  assert.equal(sourceChecksum({ text: "é" }), "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
});

test("does not normalise: any edit to a shipped step's text changes its checksum", () => {
  const shipped = "CREATE TABLE t (id text)";
  assert.equal(sourceChecksum({ text: shipped }), "cf2173fa41b53e6b3719f1a43617dc26c0c4384c43ca8ed2a7c9c12ece5f34f4");
  assert.notEqual(sourceChecksum({ text: `${shipped} ` }), sourceChecksum({ text: shipped }));
  assert.notEqual(sourceChecksum({ text: shipped.toLowerCase() }), sourceChecksum({ text: shipped }));
});

test("produces a checksum the runner's step validation accepts", () => {
  assert.doesNotThrow(() =>
    assertValidSteps({ steps: [{ id: "0001_first", checksum: sourceChecksum({ text: "CREATE TABLE t (id text)" }), up: async () => {} }] })
  );
});
