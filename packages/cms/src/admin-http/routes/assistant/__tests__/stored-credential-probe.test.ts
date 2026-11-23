import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveProbeCredential, type ProbeCredentialResolvers, type ResolveProbeCredentialInput } from "../stored-credential-probe.js";

/**
 * @file The `useAdminStoredCredential` branch of the probe chokepoint (moved with the code from the
 * host, where it ran over the real credential stores; here the two stored-credential readers are
 * fakes that count each row they open).
 *
 * WHAT MUST HOLD. Three properties, one per group below:
 *   1. the admin flag opens the admin row, and the SITE row is never touched by it;
 *   2. the endpoint pin applies to the admin row exactly as it does to the site row — this key is
 *      write-only too, so the caller may not choose its destination;
 *   3. every pre-existing caller (neither flag, or the site flag) behaves byte-identically.
 */

const PRINCIPAL = "22222222-2222-2222-2222-222222222222";
const GOOGLE = "https://generativelanguage.googleapis.com";

interface StoredRows {
  admin?: { apiKey: string; baseUrl: string | null; principalId?: string } | null;
  site?: { apiKey: string; baseUrl: string | null } | null;
}

/** Readers shaped like the host's: an empty principal opens nothing (the host's vault lookup is
 * keyed by the SESSION principal and refuses a blank one), and each opened row is counted. */
function buildDeps(rows: StoredRows) {
  const counters = { adminReads: 0, siteReads: 0 };
  const principals: string[] = [];
  const adminPrincipalId = rows.admin?.principalId ?? PRINCIPAL;
  const deps: ProbeCredentialResolvers = {
    resolveStoredSiteCredential: async () => {
      counters.siteReads += 1;
      return rows.site ? { apiKey: rows.site.apiKey, baseUrl: rows.site.baseUrl } : null;
    },
    resolveStoredAdminCredential: async ({ principalId }) => {
      principals.push(principalId);
      if (!principalId) return null;
      counters.adminReads += 1;
      return rows.admin && principalId === adminPrincipalId ? { apiKey: rows.admin.apiKey, baseUrl: rows.admin.baseUrl } : null;
    },
  };
  return { deps, counters, principals };
}

const probe = (deps: ProbeCredentialResolvers, input: ResolveProbeCredentialInput) => resolveProbeCredential({ deps, input });

test("useAdminStoredCredential opens the CALLER'S OWN admin row and sends its stored endpoint", async () => {
  const { deps, counters, principals } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: GOOGLE } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  assert.deepEqual(result, { ok: true, apiKey: "AIza-admin-key", baseUrl: GOOGLE });
  assert.deepEqual(principals, [PRINCIPAL]);
  assert.equal(counters.adminReads, 1);
  // The boundary: the admin flag must never reach the SITE's visitor credential.
  assert.equal(counters.siteReads, 0, "the admin opt-in read the site credential — two keys must stay two keys");
});

test("an omitted principal cannot open a credential owned by the literal 'undefined' principal", async () => {
  const { deps, counters, principals } = buildDeps({
    // String identifiers are opaque to the vault; absence must not become another owner's ID.
    admin: { apiKey: "another-principals-secret", baseUrl: GOOGLE, principalId: "undefined" },
  });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: false, useAdminStoredCredential: true });
  assert.deepEqual(result, { ok: true, apiKey: "", baseUrl: GOOGLE });
  assert.deepEqual(principals, [""], "an absent principal reaches the reader as the empty string, never 'undefined'");
  assert.deepEqual(counters, { adminReads: 0, siteReads: 0 });
});

test("useStoredCredential still opens the SITE row and never the admin's", async () => {
  const { deps, counters } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: GOOGLE }, site: { apiKey: "AIza-site-key", baseUrl: GOOGLE } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: true });
  assert.deepEqual(result, { ok: true, apiKey: "AIza-site-key", baseUrl: GOOGLE });
  assert.equal(counters.siteReads, 1);
  assert.equal(counters.adminReads, 0, "the site opt-in read the admin's personal key");
});

test("a typed key still wins over the admin stored one, and no row is decrypted at all", async () => {
  const { deps, counters } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: GOOGLE } });
  const result = await probe(deps, { requestedBaseUrl: "https://elsewhere.example.com", typedKey: "AIza-typed-by-the-operator", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  // Their own secret, typed into their own form, sent where they said — and the stored key is not
  // even opened, so there is nothing to leak on this path.
  assert.deepEqual(result, { ok: true, apiKey: "AIza-typed-by-the-operator", baseUrl: "https://elsewhere.example.com" });
  assert.equal(counters.adminReads, 0);
});

test("both stored flags select only the caller's admin row, including its endpoint pin", async () => {
  const { deps, counters } = buildDeps({ admin: { apiKey: "admin-secret", baseUrl: GOOGLE }, site: { apiKey: "site-secret", baseUrl: "https://attacker.example.com" } });
  const result = await probe(deps, { requestedBaseUrl: "https://attacker.example.com", typedKey: "", useStoredCredential: true, useAdminStoredCredential: true, principalId: PRINCIPAL });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.code, "STORED_CREDENTIAL_ENDPOINT_MISMATCH");
  assert.match(result.ok === false ? result.failure.error : "", /admin execution credential/);
  assert.deepEqual(counters, { adminReads: 1, siteReads: 0 });
});

test("the endpoint pin applies to the admin row: a mismatched destination is a 400, not a substitution", async () => {
  const { deps } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: GOOGLE } });
  const result = await probe(deps, { requestedBaseUrl: "https://attacker.example.com", typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  assert.deepEqual(result, { ok: false, failure: {
    error: `the admin execution credential is saved for '${GOOGLE}' and cannot be probed against 'https://attacker.example.com' — save the new endpoint first, or supply an apiKey for it in this request`,
    code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH",
  } });
});

test("a trailing slash is the same endpoint, not a mismatch", async () => {
  const { deps } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: `${GOOGLE}/` } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.baseUrl, `${GOOGLE}/`, "the SERVER's own stored string is what goes on the wire");
});

test("path case is significant: '/V1' and '/v1' are different endpoints", async () => {
  const { deps } = buildDeps({ site: { apiKey: "k", baseUrl: `${GOOGLE}/V1` } });
  const result = await probe(deps, { requestedBaseUrl: ` ${GOOGLE}/v1// `, typedKey: "", useStoredCredential: true });
  assert.equal(result.ok === false && result.failure.code, "STORED_CREDENTIAL_ENDPOINT_MISMATCH");
});

test("an admin row with no saved endpoint is a 400 naming the admin credential, not the site one", async () => {
  const { deps } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: null } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  assert.deepEqual(result, { ok: false, failure: {
    error: "the admin execution credential has no saved endpoint, so this probe has no approved destination — save a base URL for the credential first, or supply an apiKey in this request",
    code: "STORED_CREDENTIAL_ENDPOINT_UNSET",
  } });
});

test("a site row with a blank endpoint names the site credential", async () => {
  const { deps } = buildDeps({ site: { apiKey: "k", baseUrl: "   " } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: true });
  assert.match(result.ok === false ? result.failure.error : "", /^the stored site assistant credential has no saved endpoint/);
});

test("no admin row at all falls through to an empty key, letting the provider give its own answer", async () => {
  const { deps } = buildDeps({ admin: null });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL });
  // Nothing to protect on this path — there is no secret in play — and the provider's own auth
  // error is a truer message than a synthesized one.
  assert.deepEqual(result, { ok: true, apiKey: "", baseUrl: GOOGLE });
});

test("neither flag: unchanged for every pre-existing caller, and neither stored row is read", async () => {
  const { deps, counters } = buildDeps({ admin: { apiKey: "AIza-admin-key", baseUrl: GOOGLE }, site: { apiKey: "AIza-site-key", baseUrl: GOOGLE } });
  const result = await probe(deps, { requestedBaseUrl: GOOGLE, typedKey: "  ", useStoredCredential: false });
  assert.deepEqual(result, { ok: true, apiKey: "", baseUrl: GOOGLE });
  assert.equal(counters.adminReads, 0);
  assert.equal(counters.siteReads, 0);
});
