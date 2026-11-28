import { describe, expect, it } from "vitest";
import type { AccessTokenFormFields } from "../access-token-providers.js";
import {
  buildAdditionalHostsInput, buildCustomCredentialUpdatePatch, buildCustomProviderConnectionInput, customCredentialNameTaken, customCredentialReadyToSave,
  customCredentialReplaceReadyToSave, invalidAdditionalHostsEntries, isValidHttpUrl, parseAdditionalHostsInput, type CustomCredentialFormFields,
} from "../custom-credential-forms.js";
import { buildCustomCredentialRows, type AccessTokenRow, type RawCustomCredentialSummary } from "../access-token-rows.js";

function blankCustomFields(overrides: Partial<CustomCredentialFormFields> = {}): CustomCredentialFormFields {
  return { name: "", category: "general", baseUrl: "", additionalHosts: "", token: "", username: "", ...overrides };
}

function rawCustomSummary(overrides: Partial<RawCustomCredentialSummary> = {}): RawCustomCredentialSummary {
  return {
    id: "custom-1",
    label: "name.com",
    category: "general",
    baseUrl: "https://api.name.com",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("isValidHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isValidHttpUrl({ value: "https://api.vercel.com" })).toBe(true);
    expect(isValidHttpUrl({ value: "http://localhost:4000" })).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(isValidHttpUrl({ value: "ftp://files.example.com" })).toBe(false);
    expect(isValidHttpUrl({ value: "javascript:alert(1)" })).toBe(false);
  });

  it("rejects a malformed string", () => {
    expect(isValidHttpUrl({ value: "not a url" })).toBe(false);
    expect(isValidHttpUrl({ value: "" })).toBe(false);
  });
});
describe("customCredentialReadyToSave", () => {
  it("is ready once name, a valid base URL, and a token are all present", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ name: "name.com", baseUrl: "https://api.name.com", token: "tok" }))).toBe(true);
  });

  it("is not ready with a blank name", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ baseUrl: "https://api.name.com", token: "tok" }))).toBe(false);
  });

  it("is not ready with a blank token", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ name: "name.com", baseUrl: "https://api.name.com" }))).toBe(false);
  });

  it("is not ready with an invalid base URL", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ name: "name.com", baseUrl: "not a url", token: "tok" }))).toBe(false);
  });

  it("never requires a username — it stays optional", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ name: "name.com", baseUrl: "https://api.name.com", token: "tok", username: "" }))).toBe(true);
  });

  it("is ready with a valid additionalHosts entry", () => {
    expect(
      customCredentialReadyToSave(blankCustomFields({ name: "example-host.io", baseUrl: "https://api.example-host.io", token: "tok", additionalHosts: "https://machines.example-host.dev" }))
    ).toBe(true);
  });

  it("is not ready when an additionalHosts entry is not a valid http(s) URL", () => {
    expect(
      customCredentialReadyToSave(blankCustomFields({ name: "example-host.io", baseUrl: "https://api.example-host.io", token: "tok", additionalHosts: "not-a-url" }))
    ).toBe(false);
  });

  it("stays optional — a blank additionalHosts field never blocks save", () => {
    expect(customCredentialReadyToSave(blankCustomFields({ name: "name.com", baseUrl: "https://api.name.com", token: "tok", additionalHosts: "" }))).toBe(true);
  });
});

describe("parseAdditionalHostsInput", () => {
  it("splits on newlines, trims, and drops blank entries", () => {
    expect(parseAdditionalHostsInput({ raw: "https://api.example-host.io\n\n  https://machines.example-host.dev  \n" })).toEqual(["https://api.example-host.io", "https://machines.example-host.dev"]);
  });

  it("also splits on commas, so a pasted comma-separated list works the same way", () => {
    expect(parseAdditionalHostsInput({ raw: "https://api.example-host.io, https://machines.example-host.dev" })).toEqual(["https://api.example-host.io", "https://machines.example-host.dev"]);
  });

  it("returns an empty array for a blank or whitespace-only field", () => {
    expect(parseAdditionalHostsInput({ raw: "" })).toEqual([]);
    expect(parseAdditionalHostsInput({ raw: "   \n  " })).toEqual([]);
  });
});

describe("invalidAdditionalHostsEntries", () => {
  it("returns an empty array when every entry is a valid http(s) URL", () => {
    expect(invalidAdditionalHostsEntries({ raw: "https://api.example-host.io\nhttps://machines.example-host.dev" })).toEqual([]);
  });

  it("returns exactly the entries that fail isValidHttpUrl, leaving valid ones out", () => {
    expect(invalidAdditionalHostsEntries({ raw: "https://api.example-host.io\nnot-a-url\nftp://also-bad.example.com" })).toEqual(["not-a-url", "ftp://also-bad.example.com"]);
  });

  it("is empty for a blank field — this field is entirely optional", () => {
    expect(invalidAdditionalHostsEntries({ raw: "" })).toEqual([]);
  });
});

describe("buildAdditionalHostsInput", () => {
  it("returns the parsed array when at least one entry is present", () => {
    expect(buildAdditionalHostsInput({ raw: "https://api.example-host.io\nhttps://machines.example-host.dev" })).toEqual(["https://api.example-host.io", "https://machines.example-host.dev"]);
  });

  it("returns undefined for a blank field, so the create/update call omits it entirely", () => {
    expect(buildAdditionalHostsInput({ raw: "" })).toBeUndefined();
    expect(buildAdditionalHostsInput({ raw: "   " })).toBeUndefined();
  });
});

describe("customCredentialNameTaken", () => {
  it("is workspace-wide, unlike accessTokenNameTaken — two DIFFERENT custom rows (different providerId) still collide", () => {
    const rows = buildCustomCredentialRows({ raws: [rawCustomSummary({ id: "a", label: "name.com" }), rawCustomSummary({ id: "b", label: "GoDaddy" })] });
    // A same-name accessTokenNameTaken check would miss this (each row's providerId is its own id) —
    // this function's whole reason to exist is that gap.
    expect(customCredentialNameTaken({ rows, name: "GoDaddy" })).toBe(true);
  });

  it("is case-insensitive and whitespace-trimmed, same as accessTokenNameTaken", () => {
    const rows = buildCustomCredentialRows({ raws: [rawCustomSummary({ id: "a", label: "name.com" })] });
    expect(customCredentialNameTaken({ rows, name: "  NAME.COM  " })).toBe(true);
  });

  it("excludes the row being renamed via excludeId", () => {
    const rows = buildCustomCredentialRows({ raws: [rawCustomSummary({ id: "a", label: "name.com" })] });
    expect(customCredentialNameTaken({ rows, name: "name.com" }, { excludeId: "a" })).toBe(false);
  });

  it("never matches a catalog (non-'custom') row sharing the same name", () => {
    const catalogRow: AccessTokenRow = {
      kind: "publish",
      providerId: "github-pages",
      id: "row-1",
      name: "GoDaddy",
      rawLabel: "GoDaddy",
      isDefault: true,
      createdAt: "2026-08-17T10:00:00.000Z",
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    expect(customCredentialNameTaken({ rows: [catalogRow], name: "GoDaddy" })).toBe(false);
  });
});

describe("buildCustomProviderConnectionInput", () => {
  it("includes a non-blank username", () => {
    expect(buildCustomProviderConnectionInput({ token: "tok", username: "alice" })).toEqual({ token: "tok", username: "alice" });
  });

  it("omits a blank username entirely, never sends an empty string", () => {
    expect(buildCustomProviderConnectionInput({ token: "tok", username: "" })).toEqual({ token: "tok" });
    expect(buildCustomProviderConnectionInput({ token: "tok", username: "   " })).toEqual({ token: "tok" });
  });
});

/** A blank custom-row `AccessTokenFormFields` — the Replace-flow counterpart of {@link blankFields}
 *  for a `kind: "custom"` row (no catalog `providerId` to default to). */
function blankCustomRowFields(overrides: Partial<AccessTokenFormFields> = {}): AccessTokenFormFields {
  return { ref: { kind: "custom", providerId: "custom-1" }, name: "", token: "", values: {}, username: "", ...overrides };
}

describe("customCredentialReplaceReadyToSave (2026-09-01 owner-reported bug: username-only save)", () => {
  it("is not ready with everything blank/unchanged — nothing to send", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "" }), currentName: "name.com", currentUsername: "old-user" })).toBe(false);
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "old-user" }), currentName: "name.com", currentUsername: "old-user" })).toBe(false);
  });

  it("is ready for a rename-only save, same as the shared catalog gate", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "New Name", username: "old-user" }), currentName: "name.com", currentUsername: "old-user" })).toBe(true);
  });

  it("is ready for a USERNAME-ONLY save — the exact case the shared catalog gate cannot allow", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "new-user" }), currentName: "name.com", currentUsername: "old-user" })).toBe(true);
  });

  it("is ready for clearing a saved username alone (typed blank, was previously set)", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "" }), currentName: "name.com", currentUsername: "old-user" })).toBe(true);
  });

  it("is ready whenever a new site key is typed, regardless of name/username", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "old-user", token: "tok" }), currentName: "name.com", currentUsername: "old-user" })).toBe(true);
  });

  it("treats an undefined saved username the same as an empty one (a row that never had one)", () => {
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "" }), currentName: "name.com", currentUsername: undefined })).toBe(false);
    expect(customCredentialReplaceReadyToSave({ fields: blankCustomRowFields({ name: "name.com", username: "new-user" }), currentName: "name.com", currentUsername: undefined })).toBe(true);
  });
});

describe("buildCustomCredentialUpdatePatch", () => {
  it("sends a username-only patch when only the username changed, no token typed", () => {
    const patch = buildCustomCredentialUpdatePatch({ fields: blankCustomRowFields({ name: "name.com", username: "new-user" }), nameChanged: false, hasToken: false, currentUsername: "old-user" });
    expect(patch).toEqual({ username: "new-user" });
  });

  it("sends `username: null` — never `\"\"` — when a saved username is cleared", () => {
    const patch = buildCustomCredentialUpdatePatch({ fields: blankCustomRowFields({ name: "name.com", username: "" }), nameChanged: false, hasToken: false, currentUsername: "old-user" });
    expect(patch).toEqual({ username: null });
  });

  it("omits `username` entirely when it did not change", () => {
    const patch = buildCustomCredentialUpdatePatch({ fields: blankCustomRowFields({ name: "New Name", username: "old-user" }), nameChanged: true, hasToken: false, currentUsername: "old-user" });
    expect(patch).toEqual({ label: "New Name" });
  });

  it("includes `username` alongside `connection` when both changed together, matching the server's own top-level-wins precedence", () => {
    const patch = buildCustomCredentialUpdatePatch({ fields: blankCustomRowFields({ name: "name.com", username: "new-user", token: "tok" }), nameChanged: false, hasToken: true, currentUsername: "old-user" });
    expect(patch).toEqual({ connection: { token: "tok", username: "new-user" }, username: "new-user" });
  });

  it("sends label, connection, and username together when all three changed", () => {
    const patch = buildCustomCredentialUpdatePatch({ fields: blankCustomRowFields({ name: "New Name", username: "new-user", token: "tok" }), nameChanged: true, hasToken: true, currentUsername: "old-user" });
    expect(patch).toEqual({ label: "New Name", connection: { token: "tok", username: "new-user" }, username: "new-user" });
  });

  it("sends the Works for list only when it differs from the saved one", () => {
    const base = { nameChanged: false, hasToken: false, currentUsername: "" };
    expect(buildCustomCredentialUpdatePatch({ ...base, fields: blankCustomRowFields({ name: "name.com", worksFor: ["blog", "shop"] }) }, { currentWorksFor: ["blog"] }))
      .toEqual({ worksFor: ["blog", "shop"] });
    expect(buildCustomCredentialUpdatePatch({ ...base, fields: blankCustomRowFields({ name: "name.com", worksFor: ["shop", "blog"] }) }, { currentWorksFor: ["blog", "shop"] }))
      .toEqual({});
    // No saved list: an emptied draft list is unchanged, a chosen plugin is a change.
    expect(buildCustomCredentialUpdatePatch({ ...base, fields: blankCustomRowFields({ name: "name.com", worksFor: [] }) })).toEqual({});
    expect(buildCustomCredentialUpdatePatch({ ...base, fields: blankCustomRowFields({ name: "name.com", worksFor: ["blog"] }) })).toEqual({ worksFor: ["blog"] });
  });
});
