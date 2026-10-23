import assert from "node:assert/strict";
import { test } from "vitest";
import { redactJsonResponseBody, redactResponseHeaders, redactSecretSubstrings, redactTruncatedTail, resolveRedactedResponseBody } from "../response-redaction.js";

// Direct tests: through makeCredentialedRequest every secret is non-empty (the Authorization header
// always carries a scheme word, and tokens under 8 characters never reach substring scrubbing), so the
// empty-secret guards below are only reachable by calling these helpers directly. They stay as
// defence in depth against a future caller passing an empty secret.

test("redactSecretSubstrings: an empty secret is skipped instead of splicing a marker between every character", () => {
  assert.equal(redactSecretSubstrings("abc", [""]), "abc");
});

test("redactSecretSubstrings: every occurrence of every secret is replaced, longer secrets listed first winning their span", () => {
  assert.equal(redactSecretSubstrings("x Bearer tok-123456 y tok-123456", ["Bearer tok-123456", "tok-123456"]), "x [REDACTED] y [REDACTED]");
});

test("redactResponseHeaders: an empty secret does not drop every header", () => {
  assert.deepEqual(redactResponseHeaders({ "X-A": "1", "X-B": "" }, [""]), { "X-A": "1", "X-B": "" });
});

test("redactResponseHeaders: forbidden names are dropped regardless of case and surrounding whitespace", () => {
  assert.deepEqual(redactResponseHeaders({ " Set-Cookie ": "s", AUTHORIZATION: "a", "proxy-authorization": "p", Cookie: "c", "X-Keep": "k" }, []), { "X-Keep": "k" });
});

test("redactResponseHeaders: a header embedding any secret is dropped whole", () => {
  assert.deepEqual(redactResponseHeaders({ "X-Echo": "pre-tok-123456-post", "X-Keep": "k" }, ["unused", "tok-123456"]), { "X-Keep": "k" });
});

test("redactTruncatedTail: an empty secret or a secret shorter than 4 characters never matches a tail", () => {
  assert.equal(redactTruncatedTail("ends abc", ["", "abc"]), "ends abc");
});

test("redactTruncatedTail: the longest matching prefix across all secrets is removed", () => {
  assert.equal(redactTruncatedTail("body Bearer to", ["tok-123456", "Bearer tok-123456"]), "body [REDACTED]");
});

test("redactTruncatedTail: a tail matching exactly 4 characters of a secret prefix is removed", () => {
  assert.equal(redactTruncatedTail("body tok-", ["tok-123456"]), "body [REDACTED]");
});

test("redactTruncatedTail: a tail the whole secret ends the body with is removed whole", () => {
  assert.equal(redactTruncatedTail("tok-123456", ["tok-123456"]), "[REDACTED]");
});

test("resolveRedactedResponseBody: a 7-character token withholds the body whatever it contains", () => {
  assert.equal(resolveRedactedResponseBody("anything", "1234567", ["1234567"], false), "[body withheld: credential too short to redact safely]");
});

test("resolveRedactedResponseBody: a complete (not truncated) body keeps a secret-prefix tail", () => {
  assert.equal(resolveRedactedResponseBody("x tok-1", "tok-123456", ["tok-123456"], false), "x tok-1");
});

test("resolveRedactedResponseBody: a truncated body has full secrets and the cut-off tail both redacted", () => {
  assert.equal(resolveRedactedResponseBody("a tok-123456 b tok-1", "tok-123456", ["tok-123456"], true), "a [REDACTED] b [REDACTED]");
});

test("redactResponseHeaders: a header NAME that reflects a secret is kept, only values are scanned (reported, not fixed)", () => {
  assert.deepEqual(redactResponseHeaders({ "x-tok-123456": "1" }, ["tok-123456"]), { "x-tok-123456": "1" });
});

test("JSON redaction decodes escaped tokens, scrubs nested strings and preserves primitive types", () => {
  const bodyText = '{"items":[{"echo":"\\u0073ecret-token","quote":"a\\\"bcdefgh","slash":"a\\\\bcdefgh","public":"visible"}],"n":1,"b":false,"nil":null}';
  assert.deepEqual(JSON.parse(redactJsonResponseBody({ bodyText, token: "secret-token", secrets: ["secret-token", 'a"bcdefgh', "a\\bcdefgh"] })), {
    items: [{ echo: "[REDACTED]", quote: "[REDACTED]", slash: "[REDACTED]", public: "visible" }], n: 1, b: false, nil: null,
  });
});

test("JSON redaction preserves the short-token rule and rejects malformed JSON", () => {
  assert.equal(redactJsonResponseBody({ bodyText: "malformed", token: "short", secrets: ["short"] }), "[body withheld: credential too short to redact safely]");
  assert.throws(() => redactJsonResponseBody({ bodyText: "malformed", token: "long-token", secrets: ["long-token"] }), SyntaxError);
});

test("JSON redaction refuses secrets in decoded object keys at every depth", () => {
  for (const bodyText of ['{"secret-token":1}', '{"items":[{"prefix-\\u0073ecret-token-suffix":true}]}']) {
    assert.throws(() => redactJsonResponseBody({ bodyText, token: "secret-token", secrets: ["secret-token"] }), {
      name: "TypeError", message: "JSON response key contains a credential",
    });
  }
});

test("JSON redaction refuses numeric credential echoes instead of releasing typed numbers", () => {
  for (const bodyText of ['12345678', '{"items":[{"count":9123456780}]}']) {
    assert.throws(() => redactJsonResponseBody({ bodyText, token: "12345678", secrets: ["12345678"] }), {
      name: "TypeError", message: "JSON response number contains a credential",
    });
  }
});
