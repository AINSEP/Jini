import { describe, expect, it } from "vitest";
import { DefinitionInvalidError, SecretNotSupportedError } from "../errors.js";
import { validateDefinitionInput } from "../settings.js";

/** L2 §4 settings.ts: the owner namespace fence breaks on prefix OR workspace independently for each
 *  owner kind; the scopes bitmask is pinned at 0/1/7/8; site defs may not take the global bit. */
const base = { namespace: "core.x", key: "k", ownerKind: "core" as const, workspaceId: null as string | null, schema: { type: "string" as const }, defaultValue: "d", scopes: 1, secret: false };
const invalid = (patch: Partial<typeof base> & Record<string, unknown>) => {
  const result = validateDefinitionInput({ ...base, ...patch } as never);
  return result.valid ? undefined : result.error;
};

describe("namespace fence", () => {
  it.each([
    ["core", "core.a", null], ["theme", "theme.a", null], ["site", "site.a", "ws"],
  ])("%s owner accepts %s with workspace %j", (ownerKind, namespace, workspaceId) => {
    expect(invalid({ ownerKind: ownerKind as never, namespace, workspaceId, scopes: workspaceId === null ? 1 : 2 })).toBeUndefined();
  });
  it.each([
    ["core", "theme.a", null], ["core", "core.a", "ws"], ["core", "xcore.a", null], ["core", "core", null],
    ["theme", "core.a", null], ["theme", "theme.a", "ws"], ["theme", "themes.a", null],
    ["site", "core.a", "ws"], ["site", "site.a", null], ["site", "sitex.a", "ws"],
  ])("%s owner refuses namespace %j with workspace %j", (ownerKind, namespace, workspaceId) => {
    const error = invalid({ ownerKind: ownerKind as never, namespace, workspaceId, scopes: 2 });
    expect(error).toBeInstanceOf(DefinitionInvalidError);
    expect(error?.message).toBe(`namespace '${namespace}' does not match the owner fence for owner_kind '${ownerKind}'`);
  });
});

describe("other definition rules", () => {
  it("secret definitions are refused before anything else", () => {
    expect(invalid({ secret: true, namespace: "bad" })).toBeInstanceOf(SecretNotSupportedError);
  });
  it.each([1, 7])("scopes %i accepted", (scopes) => expect(invalid({ scopes })).toBeUndefined());
  it.each([0, 8, -1])("scopes %i refused", (scopes) => {
    expect(invalid({ scopes })?.message).toBe(`scopes bitmask ${scopes} is out of range 1..7`);
  });
  it("a site-owned def may not declare the global bit; workspace+user is fine", () => {
    expect(invalid({ ownerKind: "site", namespace: "site.a", workspaceId: "ws", scopes: 3 })?.message).toBe("a site-owned definition may not declare the global scope bit");
    expect(invalid({ ownerKind: "site", namespace: "site.a", workspaceId: "ws", scopes: 6 })).toBeUndefined();
  });
  it("a null default is refused (totality); falsy non-null defaults are fine", () => {
    expect(invalid({ defaultValue: null as never })?.message).toBe("non-secret definitions require a non-null default_json (totality)");
    for (const defaultValue of ["", 0, false]) expect(invalid({ defaultValue: defaultValue as never })).toBeUndefined();
  });
});
