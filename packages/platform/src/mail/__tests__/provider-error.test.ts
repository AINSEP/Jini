import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { credentialSecrets, safeMailProviderText } from "../provider-error.js";

describe("safeMailProviderText", () => {
  test("preserves useful diagnostics and addresses while masking exact credentials", () => {
    assert.equal(safeMailProviderText({ text: "Verify sender@example.com. Value short-key." }, { secrets: ["short-key"] }),
      "Verify sender@example.com. Value [REDACTED:exact_secret].");
    assert.equal(safeMailProviderText({ text: "" }), "");
    assert.equal(safeMailProviderText({ text: "Domain not verified" }, {}), "Domain not verified");
    assert.equal(safeMailProviderText({ text: "Bearer tiny" }), "Bearer [REDACTED:bearer_token]");
  });

  test.each([
    ["?token=private-link", ""],
    ["?ok=1&token=private-link#private-fragment", "?ok=1"],
    ["#token=private-link", ""],
    ["#access_token=private-link", ""],
    ["?refresh_token=private-link#private-fragment", ""],
    ["?api_key=private-link", ""],
    ["?X-Api-Signature=private-link&x=1", ""],
    ["?code=private-link", ""],
    [";password=private-link", ""],
  ])("retains exact redacted URL output for %s", (suffix, retained) => {
    const tail = suffix.endsWith("&x=1") ? "&x=1" : "";
    assert.equal(safeMailProviderText({ text: `Verify domain. https://site.test/auth${suffix}` }),
      `Verify domain. https://site.test/auth${retained}[REDACTED:url_secret_param]${tail}`);
  });

  test("redacts whole values before truncation can leave a credential prefix", () => {
    const prefix = "x".repeat(990);
    const secret = "unshaped-saved-secret";
    assert.equal(safeMailProviderText({ text: `${prefix}${secret}${"z".repeat(1100)}` }, { secrets: [secret] }),
      `${prefix}[REDACTED:`.slice(0, 1000));
    const urlPrefix = `${"x".repeat(960)}https://site.test/auth`;
    assert.equal(safeMailProviderText({ text: `${urlPrefix}?token=private-link#private-fragment ${"z".repeat(1100)}` }),
      `${urlPrefix}[REDACTED:url_secret_param] ${"z".repeat(1100)}`.slice(0, 1000));
  });

  test("can supply a safe message without changing ToolInputError identity", () => {
    const error = new ToolInputError({ message: safeMailProviderText({ text: "Domain read refused: short-key" }, { secrets: ["short-key"] }) });
    assert.ok(error instanceof ToolInputError);
    assert.equal(error.name, "ToolInputError");
    assert.equal(error.message, "Domain read refused: [REDACTED:exact_secret]");
  });
});

describe("credentialSecrets", () => {
  test("returns only own string values in field order without mutating the credential", () => {
    const credential = Object.freeze({ token: "short-key", baseUrl: "https://api.example.com", username: "operator", empty: "", port: 443, absent: undefined, nested: { token: "nested" } });
    assert.deepEqual(credentialSecrets({ credential }), ["short-key", "https://api.example.com", "operator", ""]);
    assert.deepEqual(credentialSecrets({ credential: {} }, {}), []);
    assert.equal(credential.token, "short-key");
  });
});
