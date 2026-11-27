import { expect, it, vi } from "vitest";
import { warnCredentialContent, type CredentialRedactor, type CredentialWarning } from "../credential-warnings.js";

it("reports only newly redacted kinds and coalesces warnings at the sanitized location", () => {
  const text = "[REDACTED:jwt] [REDACTED:jwt] test fixture";
  const path = "settings/local\u0007-fixture.json";
  const redact = vi.fn<CredentialRedactor>(({ text: value }) => {
    if (value === path) return { text: "settings/local\u0007-[REDACTED:provider].json", redactions: 1 };
    if (value === text) return { text: "[REDACTED:jwt] [REDACTED:jwt] [REDACTED:bearer_token] [REDACTED:provider]", redactions: 2 };
    throw new Error("Unexpected redaction input");
  });
  const credentialWarnings: CredentialWarning[] = [];
  const input = { path, text, credentialWarnings, redactSecretShapes: redact };

  warnCredentialContent(input, { codeAware: true, vendorOnly: true });
  warnCredentialContent(input, { codeAware: true, vendorOnly: true });

  expect(redact).toHaveBeenCalledWith({ text }, { codeAware: true, vendorOnly: true });
  expect(credentialWarnings).toEqual([
    { path: "settings/local-[REDACTED:provider].json", kind: "bearer token" },
    { path: "settings/local-[REDACTED:provider].json", kind: "provider key shape" },
  ]);
});

it("emits a generic warning when a replacement consumes an existing marker", () => {
  const text = "test fixture [REDACTED:jwt]";
  const path = "settings.json";
  const redact: CredentialRedactor = ({ text: value }) => {
    if (value === path) return { text: path, redactions: 0 };
    if (value === text) return { text: "[REDACTED:jwt]", redactions: 1 };
    throw new Error("Unexpected redaction input");
  };
  const credentialWarnings: CredentialWarning[] = [];

  warnCredentialContent({ path, text, credentialWarnings, redactSecretShapes: redact });

  expect(credentialWarnings).toEqual([{ path: "settings.json", kind: "credential-looking content" }]);
});
