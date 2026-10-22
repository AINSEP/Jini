import assert from "node:assert/strict";
import { test } from "vitest";
import { matchingCredentialProviderIds, selectCredentialForProvider, suggestCredentialWorksFor,
  normalizeCredentialWorksFor } from "../credential-sets/index.js";
import { suggestCredentialWorksFor as suggestFromContracts } from "../credential-sets/contracts.js";

const providers = [
  { id: "vercel", vendorId: "vercel", acceptsCustomToken: true },
  { id: "github-pages", vendorId: "github", acceptsCustomToken: true },
  { id: "github-actions", vendorId: "github", acceptsCustomToken: true },
  { id: "cloudflare-pages", vendorId: "cloudflare", acceptsCustomToken: false },
];
function credential(id: string, worksFor: string[], patch: Record<string, unknown> = {}) {
  return { id, kind: "vendor", provider: null as string | null, label: "Production access", isDefault: false,
    meta: { credentialType: "custom", worksFor }, ...patch };
}

test("compatibility uses explicit host or vendor IDs, independent of label and provider", () => {
  assert.deepEqual(matchingCredentialProviderIds({ credential: credential("a", ["vercel"]), providers }), ["vercel"]);
  assert.deepEqual(matchingCredentialProviderIds({ credential: credential("a", ["github"]), providers }), ["github-pages", "github-actions"]);
  assert.deepEqual(matchingCredentialProviderIds({ credential: credential("a", ["github-pages"]), providers }), ["github-pages"]);
  for (const row of [credential("a", [], { label: "Vercel" }), credential("a", [], { provider: "vercel" }),
    credential("a", [], { kind: "custom" }), credential("a", ["vercel"], { kind: "mcp-auth" })]) {
    assert.deepEqual(matchingCredentialProviderIds({ credential: row, providers }), []);
  }
});

test("historical custom kinds match only explicit parsed compatibility and the custom payload shape", () => {
  const row = credential("legacy", ["vercel"], { kind: "custom" });
  assert.deepEqual(matchingCredentialProviderIds({ credential: row, providers }), ["vercel"]);
  assert.deepEqual(matchingCredentialProviderIds({ credential: { ...row, meta: {} }, providers }), []);
  assert.deepEqual(matchingCredentialProviderIds({ credential: { ...row, meta: { credentialType: "vendor", worksFor: ["vercel"] } }, providers }), []);
  assert.deepEqual(matchingCredentialProviderIds({ credential: credential("legacy", ["cloudflare"], { kind: "custom" }), providers }), []);
});

test("custom shape requires token-only support; structured vendor shape may serve the descriptor", () => {
  assert.deepEqual(matchingCredentialProviderIds({ credential: credential("a", ["cloudflare"]), providers }), []);
  const row = credential("a", [], { provider: "cloudflare", meta: { credentialType: "vendor", worksFor: ["cloudflare"] } });
  assert.deepEqual(matchingCredentialProviderIds({ credential: row, providers }), ["cloudflare-pages"]);
  assert.deepEqual(matchingCredentialProviderIds({ credential: { ...row, meta: {} }, providers }), []);
});

test("selection filters eligibility before preferring only the descriptor's provider-group default", () => {
  const provider = providers[0]!;
  const custom = credential("custom", ["vercel"], { isDefault: true });
  const vendor = credential("vendor", ["vercel"], { provider: "vercel", isDefault: true,
    meta: { credentialType: "vendor", worksFor: ["vercel"] } });
  const unrelated = credential("unrelated", [], { provider: "vercel", isDefault: true });
  assert.equal(selectCredentialForProvider({ credentials: [custom, unrelated], provider }), custom);
  for (const credentials of [[custom, vendor], [vendor, custom]]) {
    assert.equal(selectCredentialForProvider({ credentials, provider }), vendor);
    assert.equal(selectCredentialForProvider({ credentials, provider, id: "custom" }), custom);
    assert.equal(selectCredentialForProvider({ credentials, provider, id: "missing" }), null);
  }
  assert.equal(selectCredentialForProvider({ credentials: [custom, unrelated], provider, id: "unrelated" }), null);
  const second = credential("second", ["vercel"]);
  assert.equal(selectCredentialForProvider({ credentials: [custom, second], provider }), null);
  assert.equal(selectCredentialForProvider({ credentials: [second, custom], provider }), null);
  assert.equal(selectCredentialForProvider({ credentials: [], provider }), null);
});

test("works-for normalization rejects malformed values and deduplicates canonical lower-case IDs", () => {
  assert.deepEqual(normalizeCredentialWorksFor({ value: ["Vercel", "vercel", "GITHUB-PAGES"] }), ["vercel", "github-pages"]);
  assert.deepEqual(normalizeCredentialWorksFor({ value: [] }), []);
  for (const value of [undefined, null, "vercel", [123], [null], [""], [" vercel"], ["vercel "], new Array(1)]) {
    assert.throws(() => normalizeCredentialWorksFor({ value }), { code: "invalid-meta" });
  }
});

test("create-time suggestion matches exact case-insensitive identities without trimming or substring guesses", () => {
  assert.equal(suggestFromContracts, suggestCredentialWorksFor);
  for (const [label, expected] of [["VeRcEl", ["vercel"]], ["GITHUB", ["github"]],
    ["GitHub-Pages", ["github-pages"]], [" Vercel", []], ["Vercel ", []], ["Vercel backup", []], ["Unknown", []]] as const) {
    assert.deepEqual(suggestCredentialWorksFor({ label, providers }), expected);
  }
  assert.deepEqual(suggestCredentialWorksFor({ label: "github", providers: [...providers,
    { id: "github", vendorId: "unrelated", acceptsCustomToken: true }] }), []);
  assert.deepEqual(suggestCredentialWorksFor({ label: "github", providers: [...providers, providers[1]!] }), ["github"]);
  assert.deepEqual(suggestCredentialWorksFor({ label: "github", providers: [] }), []);
});
