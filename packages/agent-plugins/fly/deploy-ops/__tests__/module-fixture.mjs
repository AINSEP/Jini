import assert from "node:assert/strict";

// Moved with the Fly module tests from core's deploy-ops/__tests__/module-fixture.ts: a host-ctx
// double whose `get` answers only scripted URLs and records each one.
export const AT = "2026-10-01T12:00:00.000Z";

export function context(responses) {
  const calls = [];
  return { calls, nowIso: () => AT, fail: (message) => { throw new Error(message); }, get: async (url) => {
    calls.push(url);
    assert.equal(Object.hasOwn(responses, url), true, `unexpected GET ${url}`);
    return { status: 200, json: responses[url], text: typeof responses[url] === "string" ? responses[url] : JSON.stringify(responses[url]) };
  } };
}
