import { expect, it } from "vitest";
import { PublishCredentialValidationError, optionalBoolean, preservedMove, updatedWorksFor, validateConnection, validatedWorksFor, validateLabel } from "../store-validation.js";
import { credentialTarget, storeFixture } from "./store-fixture.js";

const fields = [
  { name: "zone", label: "Zone", required: false },
  { name: "bucket", label: "Bucket", required: true },
  { name: "accessKey", label: "Access key", required: true },
  { name: "sessionKey", label: "Session key", required: false, secret: true as const },
];

function validationFixture() {
  return storeFixture([credentialTarget("docs", "docs-vendor", fields, "accessKey"), credentialTarget("archive", "archive-vendor")]);
}

function validationError(work: () => unknown, message: string) {
  expect(work).toThrow(PublishCredentialValidationError);
  expect(work).toThrow(message);
}

it.each([undefined, null, [], "docs", 42].map(raw => ({ raw })))("rejects $raw instead of a connection object", ({ raw }) => {
  const { deps, registry } = validationFixture();
  validationError(() => validateConnection({ deps, registry, raw }), "connection must be an object");
});

it("uses the declared token field, trims required and optional values, and drops unknown or blank fields", () => {
  const { deps, registry } = validationFixture();
  const raw = { providerId: "docs", accessKey: "  abc_123  ", bucket: " project-docs ", zone: "  ", sessionKey: "  session-1 ", extra: "discard" };
  expect(validateConnection({ deps, registry, raw }).connection).toEqual({
    providerId: "docs", accessKey: "abc_123", bucket: "project-docs", sessionKey: "session-1",
  });
  expect(validateConnection({ deps, registry, raw: { ...raw, zone: " west ", sessionKey: undefined } }).connection).toEqual({
    providerId: "docs", accessKey: "abc_123", bucket: "project-docs", zone: "west",
  });
});

it.each([
  [{ providerId: 12 }, "connection.providerId must be one of: docs, archive"],
  [{ providerId: "missing" }, "connection.providerId must be one of: docs, archive"],
  [{ bucket: undefined, zone: 42 }, "'bucket' (non-empty string) is required for provider 'docs'"],
  [{ bucket: "  " }, "'bucket' (non-empty string) is required for provider 'docs'"],
  [{ accessKey: null }, "Enter a token. Spaces alone are not a token."],
  [{ sessionKey: false }, "Enter a token. Spaces alone are not a token."],
  [{ zone: 42 }, "'zone' must be a non-empty string when provided"],
  [{ bucket: "https://example.test/?token=sample" }, "Put credentials in the secret field, not in this field."],
] as const)("rejects only the invalid connection fields in %j", (override, message) => {
  const { deps, registry } = validationFixture();
  const raw = { providerId: "docs", bucket: "docs", accessKey: "valid-token", ...override };
  validationError(() => validateConnection({ deps, registry, raw }), message);
});

it("requires the token even if a descriptor forgot to list it", () => {
  const { deps, registry } = storeFixture([credentialTarget("docs", "docs-vendor", [fields[1]!])]);
  validationError(() => validateConnection({ deps, registry, raw: { providerId: "docs", bucket: "docs" } }), "Enter a token. Spaces alone are not a token.");
});

it("labels preserve their spelling but reject blank, oversized and credential-bearing text", () => {
  const { deps } = validationFixture();
  expect(validateLabel({ deps, raw: " Build team " })).toBe(" Build team ");
  expect(validateLabel({ deps, raw: "x".repeat(200) })).toBe("x".repeat(200));
  validationError(() => validateLabel({ deps, raw: "  " }), "label must be a non-empty string");
  validationError(() => validateLabel({ deps, raw: 123 }), "label must be a non-empty string");
  validationError(() => validateLabel({ deps, raw: "x".repeat(201) }), "label must be 200 characters or fewer");
  validationError(() => validateLabel({ deps, raw: "https://example.test/?token=masked" }), "Put credentials in the secret field, not in this field.");
  expect(optionalBoolean({ raw: undefined, field: "isDefault" })).toBeUndefined();
  expect(optionalBoolean({ raw: false, field: "isDefault" })).toBe(false);
  expect(optionalBoolean({ raw: true, field: "isDefault" })).toBe(true);
  validationError(() => optionalBoolean({ raw: "true", field: "isDefault" }), "'isDefault' must be a boolean when provided");
});

it("normalizes compatibility IDs and retargets only the old host and vendor on a move", () => {
  const { deps } = validationFixture();
  const row = { provider: "old-vendor", meta: { credentialType: "vendor", worksFor: ["old-vendor", "other-host", "old-host"] } };
  const input = { deps, row, host: "OLD-HOST", provider: "new-vendor" };
  expect(validatedWorksFor({ deps, value: ["Docs", "DOCS", "archive"] })).toEqual(["docs", "archive"]);
  validationError(() => validatedWorksFor({ deps, value: ["docs", "not one id"] }), "worksFor must be an array of provider IDs");
  expect(updatedWorksFor({ ...input, value: undefined })).toEqual(["new-vendor", "other-host"]);
  expect(updatedWorksFor({ ...input, provider: "old-vendor", value: undefined })).toEqual(["old-vendor", "other-host", "old-host"]);
  expect(updatedWorksFor({ ...input, value: [] })).toEqual([]);
});

it("preserves an existing token only on a compatible provider-only move", () => {
  const { registry } = storeFixture([credentialTarget("docs", "docs-vendor"), credentialTarget("archive", "archive-vendor"),
    credentialTarget("other-token", "other-vendor", [{ name: "key", label: "Key", required: true }], "key"),
    credentialTarget("needs-bucket", "bucket-vendor", [fields[1]!, { name: "token", label: "Token", required: true }])]);
  const move = (raw: unknown, host = "docs") => preservedMove({ raw, registry, host });
  expect(move({ providerId: "archive" })).toMatchObject({ providerId: "archive", spec: { vendorId: "archive-vendor" } });
  expect(move({ providerId: "archive", token: "" })).toMatchObject({ providerId: "archive" });
  for (const rejected of [undefined, false, [], { providerId: 1 }, { providerId: "docs" }, { providerId: "missing" },
    { providerId: "other-token" }, { providerId: "needs-bucket" }, { providerId: "archive", token: "replacement" },
    { providerId: "archive", bucket: "docs" }]) expect(move(rejected)).toBeUndefined();
  expect(move({ providerId: "archive" }, "needs-bucket")).toBeUndefined();
});
