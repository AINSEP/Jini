import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveProviderProtocol } from '../tool-turn.js';

// Moved from the host's byok-provider-turn test with the wrapper's deletion; assertions unchanged.
test("resolveByokProtocol narrows a stored provider string to a dispatchable protocol, case- and whitespace-insensitively", () => {
  assert.equal(resolveProviderProtocol({ provider: "anthropic" }), "anthropic");
  assert.equal(resolveProviderProtocol({ provider: "  OpenAI " }), "openai");
  assert.equal(resolveProviderProtocol({ provider: "Google" }), "google");
  assert.equal(resolveProviderProtocol({ provider: "azure" }), "azure");
  // An unknown provider, a blank one, and an inherited Object key are all refused.
  assert.equal(resolveProviderProtocol({ provider: "mistral" }), null);
  assert.equal(resolveProviderProtocol({ provider: "   " }), null);
  assert.equal(resolveProviderProtocol({ provider: "constructor" }), null);
});
