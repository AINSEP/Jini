import assert from "node:assert/strict";
import { test } from "vitest";

import { PrincipalNotFoundError, PurgeRequiredError, SecretNotSupportedError } from "../errors.js";

test("PurgeRequiredError carries its message and an optional cause, and is an Error a route can map", () => {
  const cause = new Error("values still reference the definition");
  const withCause = new PurgeRequiredError({ message: "purge required before tombstone" }, { cause });
  const bare = new PurgeRequiredError({ message: "purge required" });

  assert.ok(withCause instanceof Error);
  assert.equal(withCause.message, "purge required before tombstone");
  assert.equal(withCause.cause, cause);
  assert.equal(bare.message, "purge required");
  assert.equal(bare.cause, undefined);
});

test("SecretNotSupportedError and PrincipalNotFoundError expose their structured fields", () => {
  assert.equal(new SecretNotSupportedError({ message: "no secrets" }).message, "no secrets");
  const notFound = new PrincipalNotFoundError("missing", "p-1", "ws-1");
  assert.deepEqual([notFound.message, notFound.principalId, notFound.workspaceId], ["missing", "p-1", "ws-1"]);
});
