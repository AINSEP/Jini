import assert from "node:assert/strict";
import { test } from "vitest";

import { readOptionalString, validateSupportedProtocol } from "../execution-request-fields.js";

// F4.3: a non-default string and an empty string distinguish type checking from truthiness.
test("optional string parsing preserves strings verbatim, even empty strings", () => {
  assert.equal(readOptionalString({ value: "https://provider.example/v2", fallback: "fallback" }), "https://provider.example/v2");
  assert.equal(readOptionalString({ value: "", fallback: "fallback" }), "");
  assert.equal(readOptionalString({ value: "  azure  ", fallback: undefined }), "  azure  ");
});

test("non-string optional fields return the supplied fallback without coercing input", () => {
  const fallback = { sentinel: "leave unset" };
  for (const value of [undefined, null, false, true, 0, 17, {}, [], ["openai"], new String("openai")]) {
    assert.equal(readOptionalString({ value, fallback }), fallback);
    assert.equal(readOptionalString({ value, fallback: undefined }), undefined);
    assert.equal(readOptionalString({ value, fallback: "anthropic" }), "anthropic");
  }
});

// F4.1/F4.4: the allowlist and error text are independent literals; checking only a non-null
// error would not catch a validator that rejected every protocol.
test("all four execution protocols are accepted", () => {
  for (const protocol of ["anthropic", "openai", "azure", "google"]) {
    assert.equal(validateSupportedProtocol({ protocol }), null, protocol);
  }
});

test("unsupported, differently-cased and padded protocols get the exact validation response", () => {
  for (const protocol of ["", "ollama", "OpenAI", "openai ", " azure", "google|azure"]) {
    assert.deepEqual(validateSupportedProtocol({ protocol }), {
      error: "protocol must be one of anthropic|openai|azure|google", code: "VALIDATION_ERROR",
    }, protocol);
  }
});
