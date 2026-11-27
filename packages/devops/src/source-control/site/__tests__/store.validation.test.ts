import { expect, it, vi } from "vitest";
import {
  assertCredentialFreeField, CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken,
} from "@jini-ai/platform/secrets/credential-token";
import { credentialCreateTarget, credentialScopes } from "@jini-ai/integrations/vendor-credentials/project-scope";
import type { SourceControlCredentialWriteDeps, SourceControlProviderRegistry } from "../store.js";
import {
  assertBlankPatchChangesNoField, credentialRegistry, normalizeConnectionPatch, optionalBoolean,
  preservedProvider, SourceControlCredentialValidationError, validateConnection, validateLabel,
} from "../store.validation.js";

const deps = { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken, credentialCreateTarget, credentialScopes };
const assertFree: SourceControlCredentialWriteDeps["assertCredentialFreeField"] = input =>
  assertCredentialFreeField({ ...input, containsSecret: () => false });
const providers: ReturnType<SourceControlProviderRegistry["list"]> = [
  {
    descriptor: { id: "paired", label: "Paired host", apiOrigin: "https://paired.example", module: "provider.mjs", credential: {
      tokenField: "pat",
      fields: [
        { name: "pat", label: "Token", required: true },
        { name: "account", label: "Account", required: true },
        { name: "pin", label: "PIN", required: false, secret: true },
      ],
    } },
    pluginId: "paired-plugin",
    module: { create: () => { throw new Error("validation must not build the provider"); } },
  },
  {
    descriptor: { id: "plain", label: "Plain host", apiOrigin: "https://plain.example", module: "provider.mjs" },
    pluginId: "plain-plugin",
    module: { create: () => { throw new Error("validation must not build the provider"); } },
  },
];
const registry: SourceControlProviderRegistry = {
  list: () => providers, get: ({ providerId }) => providers.find(row => row.descriptor.id === providerId), refusals: [],
};
const validate = (raw: unknown) => validateConnection({ raw, registry, deps, assertCredentialFreeField: assertFree });
const valid = { providerId: "paired", pat: " writer-token ", account: "studio" };

it("refuses malformed labels and bounds label length without rewriting a legitimate label", () => {
  const check = (raw: unknown) => validateLabel({ raw, deps, assertCredentialFreeField: assertFree });
  for (const raw of [undefined, null, [], {}, 0, NaN, Infinity, "", "  ", true]) {
    expect(() => check(raw)).toThrow(new SourceControlCredentialValidationError("label must be a non-empty string"));
  }
  expect(() => check("x".repeat(201))).toThrow(new SourceControlCredentialValidationError("label must be 200 characters or fewer"));
  expect(check("x".repeat(200))).toBe("x".repeat(200));
  expect(check(" Studio ")).toBe(" Studio ");
  expect(() => check("name --token=private-value")).toThrow(new SourceControlCredentialValidationError("Put credentials in the secret field, not in this field."));
});

it("treats default selection as tri-state and rejects coercion", () => {
  const check = (raw: unknown) => optionalBoolean({ raw, field: "isDefault" });
  expect(check(undefined)).toBeUndefined();
  expect(check(false)).toBe(false);
  expect(check(true)).toBe(true);
  for (const raw of ["false", 0, null, []]) {
    expect(() => check(raw)).toThrow(new SourceControlCredentialValidationError("'isDefault' must be a boolean when provided"));
  }
});

it("rejects malformed connections before token validation and admits only loaded providers", () => {
  for (const raw of [null, [], true, "connection"]) {
    expect(() => validate(raw)).toThrow(new SourceControlCredentialValidationError("connection must be an object"));
  }
  for (const providerId of ["missing", 42]) {
    expect(() => validate({ ...valid, providerId })).toThrow(new SourceControlCredentialValidationError("connection.providerId must be one of: paired, plain"));
  }
});

it("normalizes declared secrets, drops undeclared fields and defaults token-only descriptors", () => {
  expect(validate({ ...valid, pin: " pair-123 ", junk: "must-not-be-stored" })).toEqual({
    providerId: "paired", token: "writer-token", account: "studio", pin: "pair-123",
  });
  expect(validate(valid)).toEqual({ providerId: "paired", token: "writer-token", account: "studio" });
  expect(validate({ providerId: "plain", token: " plain-secret ", pat: "ignored" })).toEqual({ providerId: "plain", token: "plain-secret" });
  expect(() => validate({ ...valid, token: "" })).toThrow(new SourceControlCredentialValidationError("Enter a token. Spaces alone are not a token."));
});

it("refuses malformed paired fields and does not leak credential material into metadata errors", () => {
  for (const value of [undefined, null, [], {}, 1, "  "]) {
    expect(() => validate({ ...valid, account: value }))
      .toThrow(new SourceControlCredentialValidationError("'account' (non-empty string) is required for provider 'paired'"));
  }
  expect(() => validate({ ...valid, pin: "not ascii token" }))
    .toThrow(new SourceControlCredentialValidationError("Hosted tokens must use visible ASCII characters (0x21–0x7E)."));
  expect(() => validate({ ...valid, account: "https://studio.example/?token=private-value" }))
    .toThrow(new SourceControlCredentialValidationError("Put credentials in the secret field, not in this field."));
  const offline = new Error("metadata service offline");
  expect(() => validateConnection({ raw: valid, registry, deps, assertCredentialFreeField: () => { throw offline; } })).toThrow(offline);
});

it("rewrites a custom token field on patches without querying for canonical-token or metadata-only updates", async () => {
  const load = vi.fn(async () => registry);
  const normalize = (raw: unknown) => normalizeConnectionPatch({ raw, existing: "paired", registry: load });
  expect(await normalize(undefined)).toBeUndefined();
  expect(await normalize({ token: "rotated" })).toEqual({ providerId: "paired", token: "rotated" });
  expect(await normalize({})).toEqual({ providerId: "paired" });
  expect(await normalize({ token: "", pat: "must-not-win" })).toEqual({ providerId: "paired", token: "", pat: "must-not-win" });
  expect(load).not.toHaveBeenCalled();
  const raw = { pat: "replacement", account: "studio" };
  expect(await normalize(raw)).toEqual({ providerId: "paired", token: "replacement", pat: "replacement", account: "studio" });
  expect(raw).toEqual({ pat: "replacement", account: "studio" });
  expect(load).toHaveBeenCalledExactlyOnceWith();
});

it("will not silently discard paired updates when the patch preserves the old token", async () => {
  const load = vi.fn(async () => registry);
  const check = (patch: Record<string, unknown> | undefined) => assertBlankPatchChangesNoField({ patch, registry: load });
  await check(undefined);
  await check({ providerId: "paired", token: "" });
  expect(load).not.toHaveBeenCalled();
  await check({ providerId: "paired", pat: "", token: "" });
  await expect(check({ providerId: "paired", pat: "", token: "", account: "new-studio", pin: "different" }))
    .rejects.toThrow(new SourceControlCredentialValidationError("changing account, pin requires a new token"));
});

it("moves an opaque envelope only to a loaded host that does not require paired fields", async () => {
  const load = vi.fn(async () => registry);
  const move = (raw: unknown) => preservedProvider({ raw, existing: "retired", registry: load });
  expect(await move(undefined)).toBe("retired");
  expect(await move({ providerId: "retired" })).toBe("retired");
  expect(await move({})).toBe("retired");
  expect(load).not.toHaveBeenCalled();
  expect(await move({ providerId: "plain" })).toBe("plain");
  await expect(move({ providerId: "paired" })).rejects.toThrow(new SourceControlCredentialValidationError("moving to paired requires a new token and account"));
  await expect(move({ providerId: "unknown" })).rejects.toThrow(new SourceControlCredentialValidationError("connection.providerId must be one of: paired, plain"));
});

it("does not admit new providers when the host omits its provider loader", async () => {
  // Only the optional loader is read by this boundary.
  const unavailable = await credentialRegistry({ deps: {} as SourceControlCredentialWriteDeps, workspaceId: "site" });
  expect(unavailable.list()).toEqual([]);
  expect(unavailable.get({ providerId: "paired" })).toBeUndefined();
  expect(unavailable.refusals).toEqual([]);
  const loadSourceControlProviders = vi.fn(async () => registry);
  const loaded = await credentialRegistry({ deps: { loadSourceControlProviders } as SourceControlCredentialWriteDeps, workspaceId: "site" });
  expect(loaded).toBe(registry);
  expect(loadSourceControlProviders).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site" });
});
