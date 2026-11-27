import { expect, it } from "vitest";
import {
  buildSourceControlConnectionInput, defaultSourceControlCredentialForProvider,
  sourceControlProviderInfoFromDescriptor, sourceControlProvidersNotice,
  type AdminSourceControlCredentialSummary,
} from "../rules.js";

it("sends only declared fields, trimming metadata but preserving secret bytes", () => {
  const values = { account: " studio ", code: "  extra-secret ", empty: "  ", unknown: "not-on-wire", token: "wrong-token", providerId: "wrong-host" };
  const fields = { providerId: "forge", token: " primary-secret ", values };
  expect(buildSourceControlConnectionInput({ fields, declaredFields: [
    { name: "account" }, { name: "code", secret: true }, { name: "empty" }, { name: "absent" },
    { name: "token" }, { name: "providerId" },
  ] })).toEqual({ providerId: "forge", token: " primary-secret ", account: "studio", code: "  extra-secret " });
  expect(values.account).toBe(" studio ");
});

it("keeps a provider's explicit default ahead of its first row and never borrows another host's default", () => {
  const first: AdminSourceControlCredentialSummary = { id: "first", providerId: "forge", label: "First",
    isDefault: false, configured: true, createdAt: "2026-11-01", updatedAt: "2026-11-01" };
  const other = { ...first, providerId: "backup", id: "unrelated", isDefault: true };
  const primary = { ...first, id: "primary", isDefault: true };
  expect(defaultSourceControlCredentialForProvider({ providerId: "forge", credentials: [other, first, primary] })).toEqual(primary);
  expect(defaultSourceControlCredentialForProvider({ providerId: "forge", credentials: [other, first] })).toEqual(first);
  expect(defaultSourceControlCredentialForProvider({ providerId: "missing", credentials: [other, first, primary] })).toBeUndefined();
});

it("uses generic token copy and no help when a plugin has no credential declaration", () => {
  expect(sourceControlProviderInfoFromDescriptor({ descriptor: { id: "forge", label: "Forge" } })).toEqual({
    id: "forge", label: "Forge", listed: true, tokenPageUrl: "", scopeGuidanceKey: "", tokenField: "token", fields: [],
  });
});

it("distinguishes loading, a failed catalog and a genuinely empty catalog", () => {
  const t = (key: string) => key;
  const empty = { providers: [], switchedOff: [], refusals: [] };
  expect(sourceControlProvidersNotice({ snapshot: undefined, failed: false, t })).toBeNull();
  expect(sourceControlProvidersNotice({ snapshot: empty, failed: true, t })).toEqual({
    message: "The source-control hosts could not be loaded from Agent Plugins. Reload the page to try again.", reasons: [],
  });
  expect(sourceControlProvidersNotice({ snapshot: empty, failed: false, t })).toEqual({
    message: "No enabled Agent Plugin provides a source-control host. Install or turn one on in Agent Plugins.", reasons: [],
  });
});

it("keeps refusals visible beside working providers without treating intentionally disabled plugins as failures", () => {
  const t = (key: string) => key;
  const snapshot = { providers: [{ id: "git", label: "Git" }], switchedOff: [{ id: "retired", pluginId: "retired-plugin" }], refusals: ["forge: descriptor invalid"] };
  expect(sourceControlProvidersNotice({ snapshot, failed: false, t })).toEqual({
    message: "Some source-control hosts were not loaded. Reinstall or turn on the plugin in Agent Plugins.",
    reasons: ["forge: descriptor invalid"],
  });
  expect(sourceControlProvidersNotice({ snapshot: { ...snapshot, refusals: [] }, failed: false, t })).toBeNull();
});
