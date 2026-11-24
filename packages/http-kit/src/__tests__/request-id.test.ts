import assert from "node:assert/strict";
import { test } from "vitest";

import { REQUEST_ID_HEADER, resolveRequestId } from "../request-id.js";

/** @file The request-id rule: a bounded, log-safe inbound id is reused, anything else is minted. */

test("the header name is the de-facto proxy convention", () => {
  assert.equal(REQUEST_ID_HEADER, "x-request-id");
});

test("resolveRequestId keeps only a bounded, log-safe inbound id and mints otherwise", () => {
  const mint = () => "minted";
  assert.equal(resolveRequestId({ header: "abc-123_X.y:z" }, { mint }), "abc-123_X.y:z");
  assert.equal(resolveRequestId({ header: undefined }, { mint }), "minted");
  assert.equal(resolveRequestId({ header: "" }, { mint }), "minted");
  // Spaces/newlines/quotes would let a caller forge or split log lines keyed on this id.
  assert.equal(resolveRequestId({ header: "a b" }, { mint }), "minted");
  assert.equal(resolveRequestId({ header: 'a"b' }, { mint }), "minted");
  assert.equal(resolveRequestId({ header: "x".repeat(129) }, { mint }), "minted");
  assert.equal(resolveRequestId({ header: "x".repeat(128) }, { mint }), "x".repeat(128));
  // Node joins a repeated header into an array for unknown names; ambiguous, so mint.
  assert.equal(resolveRequestId({ header: ["a", "b"] }, { mint }), "minted");
});

test("without a mint override the default mints a UUID v4", () => {
  assert.match(resolveRequestId({ header: undefined }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
