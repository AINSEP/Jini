import assert from "node:assert/strict";
import { test } from "vitest";

import { hasForbiddenRawUrlCharacter } from "@jini-ai/core/contracts/server/verified-origin";
import { normalizePeerBaseUrl, peerHostname, peerUrl } from "../peer-url.js";

/**
 * @file Task 10 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 10.
 *
 * Pins `peer-url.ts`'s refusal pipeline, including the ONE place it deliberately differs from
 * `features/origin/configured-origin.ts` (a private/loopback host is ACCEPTED here — see that
 * file's header for why, and `peer-transport.test.ts` for what refuses it instead).
 */

test("normalizePeerBaseUrl refuses a non-https scheme", () => {
  const result = normalizePeerBaseUrl({ raw: "http://site.example.com", hasForbiddenRawUrlCharacter });
  assert.deepEqual(result, { error: "baseUrl was refused because its scheme must be https" });
});

test("normalizePeerBaseUrl refuses a userinfo component", () => {
  const result = normalizePeerBaseUrl({ raw: "https://user:pass@site.example.com", hasForbiddenRawUrlCharacter });
  assert.deepEqual(result, { error: "baseUrl was refused because it carries a userinfo component" });
});

test("normalizePeerBaseUrl refuses a query string or fragment", () => {
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com?a=1", hasForbiddenRawUrlCharacter }), {
    error: "baseUrl was refused because it carries a query string or fragment",
  });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com#x", hasForbiddenRawUrlCharacter }), {
    error: "baseUrl was refused because it carries a query string or fragment",
  });
});

test("normalizePeerBaseUrl refuses a control character or backslash before the parser can normalize it away", () => {
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com\\evil", hasForbiddenRawUrlCharacter }), {
    error: "baseUrl carries a backslash, whitespace or control character",
  });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com/a\u0000b", hasForbiddenRawUrlCharacter }), {
    error: "baseUrl carries a backslash, whitespace or control character",
  });
});

test("normalizePeerBaseUrl refuses a blank or unparseable value", () => {
  assert.deepEqual(normalizePeerBaseUrl({ raw: "   ", hasForbiddenRawUrlCharacter }), { error: "baseUrl is required" });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "not-a-url", hasForbiddenRawUrlCharacter }), { error: "baseUrl is not a parseable URL" });
});

test("normalizePeerBaseUrl lower-cases the host, strips a trailing dot and strips trailing slashes", () => {
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://Site.Example.COM./", hasForbiddenRawUrlCharacter }), { baseUrl: "https://site.example.com" });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com:8443/site///", hasForbiddenRawUrlCharacter }), {
    baseUrl: "https://site.example.com:8443/site",
  });
});

test("normalizePeerBaseUrl ACCEPTS a private or loopback host — the egress policy, not this validator, decides", () => {
  // Deliberate divergence from `configured-origin.ts`, and load-bearing for vendor neutrality: a
  // peer on Railway/Render internal DNS, in an AWS VPC, or on a dev machine's loopback must be
  // storable. `EgressPolicy.denyPrivateAddresses` + `devHostAllowlist` refuse it at send time.
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://localhost:4321", hasForbiddenRawUrlCharacter }), { baseUrl: "https://localhost:4321" });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://10.1.2.3", hasForbiddenRawUrlCharacter }), { baseUrl: "https://10.1.2.3" });
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://web.railway.internal", hasForbiddenRawUrlCharacter }), { baseUrl: "https://web.railway.internal" });
});

test("peerUrl joins a normalized base with an absolute route path without doubling the slash", () => {
  assert.equal(peerUrl({ baseUrl: "https://site.example.com", path: "/api/admin/v1/x" }), "https://site.example.com/api/admin/v1/x");
  assert.equal(peerUrl({ baseUrl: "https://site.example.com/site", path: "/api/admin/v1/x" }), "https://site.example.com/site/api/admin/v1/x");
});

test("peerHostname returns the bracket-stripped hostname devHostAllowlist is matched against", () => {
  assert.equal(peerHostname({ baseUrl: "https://site.example.com:8443/base" }), "site.example.com");
  // `client.ts` strips IPv6 brackets before the allowlist lookup, so an entry is written without
  // them — this is the exact string an operator must add.
  assert.equal(peerHostname({ baseUrl: "https://[fd00::1]:3000" }), "fd00::1");
});

test("normalizePeerBaseUrl refuses a host that is only the root dot, which strips to nothing", () => {
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://./", hasForbiddenRawUrlCharacter }), { error: "baseUrl was refused because its host is empty" });
});

test("peerHostname hands back an unparseable value unchanged rather than throwing inside a diagnosis", () => {
  assert.equal(peerHostname({ baseUrl: "not a url" }), "not a url");
});

test("normalizePeerBaseUrl asks the injected raw-character check about the trimmed raw string before parsing", () => {
  const seen: string[] = [];
  const refuseAll = ({ raw }: { raw: string }) => { seen.push(raw); return true; };
  assert.deepEqual(normalizePeerBaseUrl({ raw: "  https://site.example.com/  ", hasForbiddenRawUrlCharacter: refuseAll }), {
    error: "baseUrl carries a backslash, whitespace or control character",
  });
  assert.deepEqual(seen, ["https://site.example.com/"]);
  const acceptAll = ({ raw }: { raw: string }) => { seen.push(raw); return false; };
  assert.deepEqual(normalizePeerBaseUrl({ raw: "https://site.example.com\\evil", hasForbiddenRawUrlCharacter: acceptAll }), {
    baseUrl: "https://site.example.com/evil",
  });
});
