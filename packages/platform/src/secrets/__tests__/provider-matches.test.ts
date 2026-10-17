import assert from "node:assert/strict";
import { test } from "vitest";
import { matchingCredentialProviderIds } from "../credential-sets/provider-matches.js";

const providers = [
  { id: "vercel", vendorId: "vercel", acceptsCustomToken: true },
  { id: "github-pages", vendorId: "github", acceptsCustomToken: true },
  { id: "cloudflare-pages", vendorId: "cloudflare", acceptsCustomToken: false },
];

test("custom labels or explicit providers match exactly, ignoring case", () => {
  for (const credential of [
    { kind: "custom", provider: null, label: "Vercel" },
    { kind: "custom", provider: "VeRcEl", label: "Production" },
  ]) assert.deepEqual(matchingCredentialProviderIds({ credential, providers }), ["vercel"]);
  assert.deepEqual(matchingCredentialProviderIds({ credential: { kind: "custom", provider: null, label: "GitHub" }, providers }), ["github-pages"]);
});

test("a token alone cannot satisfy extra required fields; vendor connections still can", () => {
  assert.deepEqual(matchingCredentialProviderIds({ credential: { kind: "custom", provider: null, label: "Cloudflare" }, providers }), []);
  assert.deepEqual(matchingCredentialProviderIds({ credential: { kind: "vendor", provider: "cloudflare", label: "Production" }, providers }), ["cloudflare-pages"]);
});

test("labels cannot override an explicit provider, match substrings or claim unrelated vault kinds", () => {
  for (const credential of [
    { kind: "custom", provider: "github", label: "Vercel" },
    { kind: "custom", provider: null, label: "Vercel backup" },
    { kind: "mcp-auth", provider: "vercel", label: "Vercel" },
  ]) assert.ok(!matchingCredentialProviderIds({ credential, providers }).includes("vercel"));
});
