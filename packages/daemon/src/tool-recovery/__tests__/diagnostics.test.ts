/** Issued-diagnostic provenance and the credential-setup metadata gate. */
import { expect, test } from "vitest";
import { isIssuedToolFailureDiagnostic, issueCredentialSetup, issueToolFailureDiagnostic } from "../index.js";

test("only an object this module issued counts as an issued diagnostic; primitives and null never do", () => {
  const issued = issueToolFailureDiagnostic({ diagnostic: { hint: "retry", remedyToolId: "remedy" } }, {});
  expect(isIssuedToolFailureDiagnostic({ value: issued })).toBe(true);
  expect(isIssuedToolFailureDiagnostic({ value: { ...issued } })).toBe(false);
  for (const value of [null, undefined, "remedy", 7]) expect(isIssuedToolFailureDiagnostic({ value })).toBe(false);
});

test("credential setup screens only string prefill values for secrets; numbers, booleans and null pass as metadata", () => {
  const screened: string[] = [];
  const diagnostic = issueCredentialSetup({
    setupToolId: "save-credential",
    prefill: { label: "work account", port: 8443, enabled: true, region: null },
    assertCredentialFreeField: ({ field }) => { screened.push(field); },
    containsSecret: () => false,
  }, {});

  expect(screened).toEqual(["label"]);
  expect(diagnostic.prefill).toEqual({ label: "work account", port: 8443, enabled: true, region: null });
  expect(diagnostic.remedyToolId).toBe("save-credential");
  expect(isIssuedToolFailureDiagnostic({ value: diagnostic })).toBe(true);
});

test("credential setup refuses a secret-shaped prefill key or a string value the host detects as a secret", () => {
  const base = { setupToolId: "save-credential", assertCredentialFreeField: () => {} };
  for (const key of ["apiToken", "clientSecret", "password", "authorization", "envVars", "headers", "body", "key"]) {
    expect(() => issueCredentialSetup({ ...base, prefill: { [key]: "x" }, containsSecret: () => false }, {}))
      .toThrow("Credential setup accepts only non-secret metadata.");
  }
  expect(() => issueCredentialSetup({ ...base, prefill: { label: "looks-like-a-credential" }, containsSecret: ({ text }) => text.includes("credential") }, {}))
    .toThrow("Credential setup accepts only non-secret metadata.");
});
