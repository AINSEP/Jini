import { expect, test, vi } from "vitest";
import type { KeyAttachments } from "@jini-ai/core/contracts/site/project-key-attachments";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import { createProjectKeys, isSharedOAuthKey, providerKeyId, providerPluginOf, SITE_KEY_ID_PREFIX, type CreateProjectKeysRequired, type SiteKeySource } from "../service.js";

const copy = { missingSite: "no site", missingProjectKey: "no key", missingSiteKey: "no site key", oauthBindingRequired: "bind first", revoked: "revoked" };
const rec = (id: string, extra: Partial<VaultRecord> = {}): VaultRecord => ({
  workspaceId: "owner-space", kind: "custom", ownerKey: "host", principalId: null, binding: null, id, provider: null, label: `label-${id}`,
  isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "", updatedAt: "", ...extra,
});
const oauthRow = (id: string) => rec(id, { kind: "api-connection", meta: { credentialFormat: "oauth-token-set" } });

function setup(rows: VaultRecord[], over: Partial<CreateProjectKeysRequired> = {}) {
  const users = new Map<string, { siteId: string; siteName: string }[]>();
  const vault: VaultRepoPort = { find: vi.fn(async ({ id }: { id: string }) => rows.find(r => r.id === id) ?? null), list: vi.fn(async ({ kind }: { kind: string }) => rows.filter(r => r.kind === kind)), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const attachments: KeyAttachments = {
    keysFor: vi.fn().mockResolvedValue([]), isAttached: vi.fn(), removeKey: vi.fn(), renameSite: vi.fn(),
    attach: vi.fn(async ({ siteId, keyId, siteName }: { siteId: string; keyId: string; siteName: string }) => { users.set(keyId, [...(users.get(keyId) ?? []), { siteId, siteName }]); }),
    detach: vi.fn(async ({ siteId, keyId }: { siteId: string; keyId: string }) => { users.set(keyId, (users.get(keyId) ?? []).filter(u => u.siteId !== siteId)); }),
    usersOf: vi.fn(async ({ keyId }: { keyId: string }) => users.get(keyId) ?? []),
  };
  const required: CreateProjectKeysRequired = { vault, attachments, siteId: "s1", siteName: "Site One", owner: { workspaceId: "owner-space", ownerKey: "host" },
    attachedPolicy: { readonlyMessage: "read only", report: vi.fn() }, permissionForRow: vi.fn(({ row }: { row: VaultRecord }) => `perm:${row.id}`),
    providerUsage: vi.fn(), reapply: vi.fn().mockResolvedValue("now"), transaction: vi.fn(async ({ run }) => run()), copy, ...over };
  return { keys: createProjectKeys(required), vault, attachments, users, required };
}

test("provider key ids round-trip and OAuth token sets are recognised by kind and format", () => {
  expect(providerKeyId({ pluginId: "mail-x" })).toBe("plugin-state:mail-x:provider.config");
  expect(providerPluginOf({ keyId: "plugin-state:mail-x:provider.config" })).toBe("mail-x");
  expect(providerPluginOf({ keyId: "plugin-state:Mail:provider.config" })).toBeUndefined();
  expect(isSharedOAuthKey({ row: oauthRow("o") })).toBe(true);
  expect(isSharedOAuthKey({ row: rec("o", { meta: { credentialFormat: "oauth-token-set" } }) })).toBe(false);
  expect(isSharedOAuthKey({ row: rec("o", { kind: "api-connection" }) })).toBe(false);
});

test("use attaches a key to this site inside the transaction and reports usage", async () => {
  const { keys, attachments, required } = setup([rec("k1")]);
  const references = { set: vi.fn(), has: vi.fn(), remove: vi.fn() };
  const withRefs = createProjectKeys({ ...required, references });
  expect(await withRefs.use({ keyId: "k1", use: true })).toEqual({ keyId: "k1", usedByThisSite: true, usedBy: ["Site One"], appliesAt: "now" });
  expect(references.set).toHaveBeenCalledWith({ credentialId: "k1" });
  expect(attachments.attach).toHaveBeenCalledWith({ siteId: "s1", keyId: "k1", siteName: "Site One" });
  expect(required.transaction).toHaveBeenCalledTimes(1);
  expect(required.permissionForRow).toHaveBeenCalledWith({ row: rec("k1") });
  expect(required.reapply).not.toHaveBeenCalled();
  expect(await keys.use({ keyId: "k1", use: false })).toEqual({ keyId: "k1", usedByThisSite: false, usedBy: [], appliesAt: "now", message: "revoked" });
  expect(attachments.detach).toHaveBeenCalledWith({ siteId: "s1", keyId: "k1" });
});

test("use refuses without a site, for an unknown key, and for an OAuth key with no binder", async () => {
  await expect(setup([rec("k1")], { siteId: "" }).keys.use({ keyId: "k1", use: true })).rejects.toThrow("no site");
  const unknown = setup([]);
  await expect(unknown.keys.use({ keyId: "k1", use: true })).rejects.toThrow("no key");
  expect(unknown.attachments.attach).not.toHaveBeenCalled();
  const noBinder = setup([oauthRow("o1")]);
  await expect(noBinder.keys.use({ keyId: "o1", use: true })).rejects.toThrow("bind first");
  expect(noBinder.attachments.attach).not.toHaveBeenCalled();
});

test("an OAuth key is bound before it is attached", async () => {
  const order: string[] = [];
  const bindOAuth = vi.fn(async () => { order.push("bind"); });
  const { keys, attachments } = setup([oauthRow("o1")], { bindOAuth });
  vi.mocked(attachments.attach).mockImplementation(async () => { order.push("attach"); });
  await keys.use({ keyId: "o1", use: true });
  expect(bindOAuth).toHaveBeenCalledWith({ keyId: "o1", use: true });
  expect(order).toEqual(["bind", "attach"]);
});

test("a provider key reapplies its plugin and reports restart or failure with the plain-words reason", async () => {
  const keyId = providerKeyId({ pluginId: "mail-x" });
  const providerUsage = vi.fn().mockResolvedValue({ store: "project", usedByThisSite: true, usedBy: [] });
  const restart = setup([rec(keyId)], { providerUsage, reapply: vi.fn().mockResolvedValue("restart") });
  expect(await restart.keys.use({ keyId, use: true })).toEqual({ keyId, usedByThisSite: true, usedBy: ["Site One"], appliesAt: "restart" });
  expect(restart.required.reapply).toHaveBeenCalledWith({ pluginId: "mail-x" });
  expect(providerUsage).toHaveBeenCalledWith({ pluginId: "mail-x" });
  const failed = setup([rec(keyId)], { providerUsage: vi.fn().mockResolvedValue({ store: "site", usedByThisSite: true, usedBy: [] }),
    reapply: vi.fn().mockResolvedValue({ appliesAt: "failed", reason: "Provider rejected it.", action: "Check the key." }) });
  expect(await failed.keys.use({ keyId, use: true })).toEqual({ keyId, usedByThisSite: false, usedBy: ["Site One"], appliesAt: "failed", message: "Provider rejected it. Check the key." });
});

test("a key saved only on another site is adopted into Shared Keys before attaching", async () => {
  const siteKeys: SiteKeySource = { list: vi.fn(), find: vi.fn(), adopt: vi.fn().mockResolvedValue({ keyId: "shared-1" }) };
  const { keys, attachments } = setup([rec("shared-1")], { siteKeys });
  const picked = `${SITE_KEY_ID_PREFIX}other:abc`;
  const out = await keys.use({ keyId: picked, use: true });
  expect(siteKeys.adopt).toHaveBeenCalledWith({ keyId: picked, use: true });
  expect(attachments.attach).toHaveBeenCalledWith({ siteId: "s1", keyId: "shared-1", siteName: "Site One" });
  expect(out.keyId).toBe("shared-1");
  await keys.use({ keyId: "shared-1", use: false });
  expect(siteKeys.adopt).toHaveBeenCalledTimes(1);
});

test("a site-key-shaped id is an ordinary Shared Key id when no site key source exists", async () => {
  const picked = `${SITE_KEY_ID_PREFIX}x`;
  const { keys, required } = setup([rec(picked)]);
  expect(await keys.permissionFor({ keyId: picked })).toBe(`perm:${picked}`);
  expect(required.permissionForRow).toHaveBeenCalledWith({ row: rec(picked) });
});

test("permissionFor checks a site key through the site source and refuses an unknown one", async () => {
  const siteRow = rec("site-row");
  const siteKeys: SiteKeySource = { list: vi.fn(), adopt: vi.fn(), find: vi.fn(async ({ keyId }: { keyId: string }) => keyId.endsWith("known") ? siteRow : null) };
  const { keys } = setup([rec("k1")], { siteKeys });
  expect(await keys.permissionFor({ keyId: `${SITE_KEY_ID_PREFIX}known` })).toBe("perm:site-row");
  await expect(keys.permissionFor({ keyId: `${SITE_KEY_ID_PREFIX}lost` })).rejects.toThrow("no site key");
  expect(await keys.permissionFor({ keyId: "k1" })).toBe("perm:k1");
  await expect(keys.permissionFor({ keyId: "nope" })).rejects.toThrow("no key");
});

const card = (over: Partial<PluginCredentialCard>): PluginCredentialCard => ({ providerId: "p", label: "Card label", category: "mail", baseUrl: "", title: "t", ...over });

test("list shows owner keys with card and OAuth labels, hiding plain API connections", async () => {
  const providerId = providerKeyId({ pluginId: "mail-x" });
  const rows = [rec("c1"), rec(providerId, { kind: "api-connection" }), rec("plain-api", { kind: "api-connection" }), oauthRow("o1"), rec("v1", { kind: "vendor" })];
  const { keys, users } = setup(rows, { describeOAuth: vi.fn(async ({ keyId }: { keyId: string }) => `acct for ${keyId}`), providerUsage: vi.fn().mockResolvedValue({ store: "project", usedByThisSite: false, usedBy: [] }) });
  users.set("c1", [{ siteId: "s1", siteName: "Site One" }, { siteId: "s2", siteName: "Site Two" }]);
  const listed = await keys.list({ cards: [card({ saveKind: "provider-settings", saveTarget: "mail-x", label: "Mail X" }), card({ saveKind: "api", saveTarget: "mail-x", label: "wrong" })] });
  expect(listed).toEqual([
    { keyId: providerId, usedByThisSite: false, usedBy: [], name: "Mail X", kind: "api-connection" },
    { keyId: "o1", usedByThisSite: false, usedBy: [], name: "acct for o1", kind: "api-connection" },
    { keyId: "v1", usedByThisSite: false, usedBy: [], name: "label-v1", kind: "vendor" },
    { keyId: "c1", usedByThisSite: true, usedBy: ["Site One", "Site Two"], name: "label-c1", kind: "custom" },
  ]);
});

test("list prefers the host inventory and falls back to row labels without cards or OAuth describer", async () => {
  const inventory = vi.fn().mockResolvedValue([oauthRow("o1"), rec(providerKeyId({ pluginId: "z" }), { kind: "api-connection", label: "Raw" })]);
  const { keys, vault } = setup([], { inventory, providerUsage: vi.fn().mockResolvedValue({ store: "project", usedByThisSite: true, usedBy: [] }) });
  expect((await keys.list({})).map(r => [r.name, r.usedByThisSite])).toEqual([["label-o1", false], ["Raw", true]]);
  expect(vault.list).not.toHaveBeenCalled();
});

test("listChoices appends other sites' keys as unused; listGranted hides other sites' names", async () => {
  const siteKeys: SiteKeySource = { find: vi.fn(), adopt: vi.fn(), list: vi.fn().mockResolvedValue([{ keyId: `${SITE_KEY_ID_PREFIX}a`, name: "A", kind: "custom", siteName: "Other", locked: "Open Other first." }]) };
  const { keys, users, attachments } = setup([rec("c1")], { siteKeys });
  users.set("c1", [{ siteId: "s1", siteName: "Site One" }]);
  expect(await keys.listChoices({})).toEqual([
    { keyId: "c1", usedByThisSite: true, usedBy: ["Site One"], name: "label-c1", kind: "custom" },
    { keyId: `${SITE_KEY_ID_PREFIX}a`, name: "A", kind: "custom", siteName: "Other", locked: "Open Other first.", usedByThisSite: false, usedBy: [] },
  ]);
  expect(siteKeys.list).toHaveBeenCalledWith({});
  expect(await setup([rec("c1")]).keys.listChoices({})).toHaveLength(1);
  vi.mocked(attachments.keysFor).mockResolvedValue(["c1"]);
  vi.mocked(attachments.isAttached).mockResolvedValue(true);
  expect(await keys.listGranted({})).toEqual([{ keyId: "c1", usedByThisSite: true, usedBy: [], name: "label-c1", kind: "custom" }]);
});

test("savedResult attaches only successful, identifiable, project-scoped saves", async () => {
  const { keys, attachments } = setup([rec("k1"), rec("k2"), rec("k3")]);
  for (const result of [null, "saved", { saved: false, keyId: "k1" }, { saved: true }, { saved: true, keyId: 5 }, { saved: true, keyId: "missing" },
    { saved: true, keyId: "k1", store: "site" }, { created: true, keyId: "k1", scope: "site" }]) {
    expect(await keys.savedResult({ result })).toBe(result);
  }
  expect(attachments.attach).not.toHaveBeenCalled();
  expect(await keys.savedResult({ result: { saved: true, keyId: "k1", extra: 1 } })).toEqual({ saved: true, keyId: "k1", extra: 1, usedByThisSite: true, usedBy: ["Site One"], appliesAt: "now" });
  expect(await keys.savedResult({ result: { created: true, credential: { id: "k2" } } })).toMatchObject({ keyId: "k2", usedByThisSite: true, appliesAt: "now" });
  expect(await keys.savedResult({ result: { saved: true, credentialId: "k3" } })).toMatchObject({ keyId: "k3", usedByThisSite: true });
  expect(attachments.attach).toHaveBeenCalledTimes(3);
  expect(await keys.savedResult({ result: { saved: true, keyId: "k1" } })).toEqual({ saved: true, keyId: "k1", usedByThisSite: true, usedBy: ["Site One"] });
  expect(attachments.attach).toHaveBeenCalledTimes(3);
});
