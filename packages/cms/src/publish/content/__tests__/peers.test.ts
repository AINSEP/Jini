import assert from "node:assert/strict";
import { test } from "vitest";

import {
  PublishContentPeerCredentialMissingError,
  PublishContentPeerDuplicateLabelError,
  PublishContentPeerNotFoundError,
  PublishContentPeerSecretStoreUnconfiguredError,
  PublishContentPeerValidationError,
} from "../peers.js";

/** Wire-visible: routes and tools map these errors by `name`, so each name is pinned exactly. */
const classes = [
  [PublishContentPeerNotFoundError, "PublishContentPeerNotFoundError"],
  [PublishContentPeerValidationError, "PublishContentPeerValidationError"],
  [PublishContentPeerDuplicateLabelError, "PublishContentPeerDuplicateLabelError"],
  [PublishContentPeerSecretStoreUnconfiguredError, "PublishContentPeerSecretStoreUnconfiguredError"],
  [PublishContentPeerCredentialMissingError, "PublishContentPeerCredentialMissingError"],
] as const;

for (const [Ctor, name] of classes) {
  test(`${name} keeps its name and host-supplied message`, () => {
    const error = new Ctor({ message: "host copy" });
    assert.ok(error instanceof Error);
    assert.ok(error instanceof Ctor);
    assert.equal(error.name, name);
    assert.equal(error.message, "host copy");
  });
}

test("the peer error classes are distinct identities", () => {
  const notFound = new PublishContentPeerNotFoundError({ message: "x" });
  assert.equal(notFound instanceof PublishContentPeerValidationError, false);
  assert.equal(notFound instanceof PublishContentPeerCredentialMissingError, false);
});
