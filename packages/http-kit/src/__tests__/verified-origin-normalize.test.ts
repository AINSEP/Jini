import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeOriginCandidate } from "../verified-origin.js";

test("normalizeOriginCandidate accepts a plain https URL with default port", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://good.com/path" });
  assert.deepEqual(result, { scheme: "https", host: "good.com", port: 443 });
});

test("normalizeOriginCandidate accepts an explicit port", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://good.com:8443/path" });
  assert.deepEqual(result, { scheme: "https", host: "good.com", port: 8443 });
});

test("normalizeOriginCandidate lower-cases the host", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://GOOD.COM" });
  assert.deepEqual(result, { scheme: "https", host: "good.com", port: 443 });
});

test("normalizeOriginCandidate strips a single trailing dot", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://good.com." });
  assert.deepEqual(result, { scheme: "https", host: "good.com", port: 443 });
});

test("normalizeOriginCandidate IDNA/punycode-normalizes a homoglyph host", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://gооd.com" });
  assert.ok(result);
  assert.notEqual(result.host, "good.com");
  assert.ok(result.host.startsWith("xn--"), `expected punycode host, got '${result.host}'`);
});

test("normalizeOriginCandidate rejects a backslash scheme-separator bypass", () => {
  assert.equal(normalizeOriginCandidate({ rawUrl: "https:/\\evil.com" }), null);
});

test("normalizeOriginCandidate rejects embedded whitespace", () => {
  assert.equal(normalizeOriginCandidate({ rawUrl: "https://good.com\t.evil.com" }), null);
  assert.equal(normalizeOriginCandidate({ rawUrl: "https://good.com evil.com" }), null);
});

test("normalizeOriginCandidate rejects embedded control characters", () => {
  const withNullByte = "https://good.com" + String.fromCharCode(0) + ".evil.com";
  const withDelByte = "https://good.com" + String.fromCharCode(0x7f) + ".evil.com";
  assert.equal(normalizeOriginCandidate({ rawUrl: withNullByte }), null);
  assert.equal(normalizeOriginCandidate({ rawUrl: withDelByte }), null);
});

test("normalizeOriginCandidate rejects non-empty userinfo", () => {
  assert.equal(normalizeOriginCandidate({ rawUrl: "https://good.com@evil.com" }), null);
  assert.equal(normalizeOriginCandidate({ rawUrl: "https://user:pass@good.com" }), null);
});

test("normalizeOriginCandidate accepts http (dev-capability same-origin case), rejects everything else", () => {
  assert.deepEqual(normalizeOriginCandidate({ rawUrl: "http://good.com" }), { scheme: "http", host: "good.com", port: 80 });
  assert.equal(normalizeOriginCandidate({ rawUrl: "javascript:alert(1)" }), null);
  assert.equal(normalizeOriginCandidate({ rawUrl: "data:text/html,evil" }), null);
});

test("normalizeOriginCandidate rejects protocol-relative input", () => {
  assert.equal(normalizeOriginCandidate({ rawUrl: "//evil.com" }), null);
});

test("normalizeOriginCandidate rejects unparseable input instead of throwing", () => {
  assert.equal(normalizeOriginCandidate({ rawUrl: "not a url" }), null);
  assert.equal(normalizeOriginCandidate({ rawUrl: "" }), null);
});

test("normalizeOriginCandidate treats good.com.evil.com as a distinct host (not good.com)", () => {
  const result = normalizeOriginCandidate({ rawUrl: "https://good.com.evil.com" });
  assert.ok(result);
  assert.equal(result.host, "good.com.evil.com");
  assert.notEqual(result.host, "good.com");
});
