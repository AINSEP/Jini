import { expect, it, vi } from "vitest";
import { buildVaultAad } from "@jini-ai/platform/secrets/credential-sets";
import { createPublishCredential, deletePublishCredential, describeCredential, healAccountLabel, listPublishCredentials, PublishCredentialDuplicateLabelError, PublishCredentialNotFoundError, PublishCredentialSecretStoreUnconfiguredError, updatePublishCredential } from "../store.js";
import { findPublishCredentialRecord, hasDefaultForPublish, resolveDefaultForPublish, resolveForPublish } from "../store-resolution.js";
import { credentialTarget, storeFixture } from "./store-fixture.js";

const workspaceId = "site";
const build = (label: string, token: string, providerId = "docs") => ({ workspaceId, label, connection: { providerId, token } });

it("creates and promotes named keys without disclosing or re-sealing secrets on metadata updates", async () => {
  const { deps, site } = storeFixture([credentialTarget("docs", "docs-vendor")]);
  const first = await createPublishCredential(deps, build("Team key", "fake-one-2345"));
  const other = await createPublishCredential(deps, { ...build("Release key", "fake-two-9876"), isDefault: false });
  expect(first).toMatchObject({ id: "key-1", isDefault: true, tokenTail: "2345", publishHosts: ["docs"], defaultFor: ["docs"] });
  expect(other).toMatchObject({ id: "key-2", isDefault: false, defaultFor: [] });
  expect(JSON.stringify(await listPublishCredentials(deps, { workspaceId }))).not.toContain("fake-one");
  const before = await site.vault.find({ workspaceId, id: "key-2" });
  await updatePublishCredential(deps, { workspaceId, id: "key-2", label: "Release renamed", isDefault: true });
  expect(site.sealer.seal).toHaveBeenCalledTimes(2);
  expect(site.sealer.open).not.toHaveBeenCalled();
  const updated = await site.vault.find({ workspaceId, id: "key-2" });
  expect(updated).toMatchObject({ label: "Release renamed", isDefault: true, sealed: before?.sealed });
  expect((await describeCredential(deps, { workspaceId, id: "key-1" }))?.isDefault).toBe(false);
  expect(await hasDefaultForPublish(deps, { workspaceId, providerId: "docs" })).toEqual({ id: "key-2", revision: updated?.revision });
  expect(await resolveDefaultForPublish(deps, { workspaceId, providerId: "docs" })).toEqual({
    id: "key-2", revision: updated?.revision, label: "Release renamed", connection: { providerId: "docs", token: "fake-two-9876" },
  });
  expect(await resolveForPublish(deps, { workspaceId, id: "key-1" })).toMatchObject({
    providerId: "docs", vendorId: "docs-vendor", isDefault: false, connection: { providerId: "docs", token: "fake-one-2345" },
  });
});

it("rejects competing labels without mutating the existing key and never opens incompatible ids", async () => {
  const { deps, site } = storeFixture([credentialTarget("docs", "docs-vendor"), credentialTarget("archive", "archive-vendor")]);
  await createPublishCredential(deps, build("Team", "docs-token-2345"));
  const duplicate = createPublishCredential(deps, build("Team", "different-token"));
  await expect(duplicate).rejects.toThrow(PublishCredentialDuplicateLabelError);
  await expect(duplicate).rejects.toThrow("a 'docs' credential labeled 'Team' already exists in this workspace");
  expect((await listPublishCredentials(deps, { workspaceId })).map(row => row.id)).toEqual(["key-1"]);
  expect(await hasDefaultForPublish(deps, { workspaceId, providerId: "archive", id: "key-1" })).toBeNull();
  expect(await resolveForPublish(deps, { workspaceId, id: "key-1", providerId: "archive" })).toBeNull();
  expect(await resolveForPublish(deps, { workspaceId, id: "not-saved" })).toBeNull();
  expect(await resolveDefaultForPublish(deps, { workspaceId, providerId: "missing" })).toBeNull();
  expect(await resolveDefaultForPublish(deps, { workspaceId, providerId: "archive" })).toBeNull();
  expect(site.sealer.open).not.toHaveBeenCalled();
  await expect(updatePublishCredential(deps, { workspaceId, id: "missing", label: "new" })).rejects.toThrow(PublishCredentialNotFoundError);
  expect(await resolveForPublish(deps, { workspaceId, id: "key-1", providerId: "docs" })).toMatchObject({ connection: { token: "docs-token-2345" } });
});

it("heals, resolves and deletes the row in its owning store without shadowing a local key", async () => {
  const { deps, site, project } = storeFixture([credentialTarget("docs", "docs-vendor")], { withProject: true });
  const shared = await createPublishCredential(deps, build("Shared", "project-token-2345"));
  const local = await createPublishCredential(deps, { ...build("Local", "site-token-9876"), scope: "site" });
  expect(shared.scope).toBe("project");
  expect(local.scope).toBe("site");
  const sharedId = { workspaceId, id: "key-1" };
  expect((await findPublishCredentialRecord(deps, sharedId))?.workspaceId).toBe("project");
  expect((await findPublishCredentialRecord(deps, { workspaceId, id: "key-2" }))?.workspaceId).toBe("site");
  await healAccountLabel(deps, { ...sharedId, accountLabel: "team-account" });
  expect(await project.vault.find({ workspaceId: "project", id: "key-1" })).toMatchObject({ meta: { accountLabel: "team-account" } });
  expect(await site.vault.find(sharedId)).toBeNull();
  expect((await resolveDefaultForPublish(deps, { workspaceId, providerId: "docs" }))?.id).toBe("key-2");
  expect((await resolveForPublish(deps, sharedId))?.connection).toEqual({ providerId: "docs", token: "project-token-2345" });
  expect(project.sealer.open).toHaveBeenCalledTimes(1);
  await deletePublishCredential(deps, sharedId);
  expect(await findPublishCredentialRecord(deps, sharedId)).toBeNull();
  expect((await listPublishCredentials(deps, { workspaceId })).map(row => row.id)).toEqual(["key-2"]);
});

it("a provider-only move retains the envelope, retargets compatibility and clears the old account", async () => {
  const { deps, site } = storeFixture([credentialTarget("docs", "docs-vendor"), credentialTarget("archive", "archive-vendor")]);
  await createPublishCredential(deps, { ...build("Team", "docs-token-2345"), worksFor: ["docs", "docs-vendor", "other"] });
  await healAccountLabel(deps, { workspaceId, id: "key-1", accountLabel: "old-account" });
  const before = await site.vault.find({ workspaceId, id: "key-1" });
  expect(await updatePublishCredential(deps, { workspaceId, id: "key-1", connection: { providerId: "archive", token: "" } }))
    .toMatchObject({ providerId: "archive", vendorId: "archive-vendor", worksFor: ["archive-vendor", "other"], accountLabel: null });
  expect(await site.vault.find({ workspaceId, id: "key-1" })).toMatchObject({ provider: "archive-vendor", sealed: before?.sealed });
  expect(site.sealer.seal).toHaveBeenCalledTimes(1);
  expect(site.sealer.open).not.toHaveBeenCalled();
  expect(await resolveForPublish(deps, { workspaceId, id: "key-1", providerId: "docs" })).toBeNull();
  expect((await resolveDefaultForPublish(deps, { workspaceId, providerId: "archive" }))?.connection)
    .toEqual({ providerId: "archive", token: "docs-token-2345" });
});

it("replacement can clear an optional secret while retaining the required token", async () => {
  const host = credentialTarget("docs", "docs-vendor", [
    { name: "token", label: "Token", required: true },
    { name: "session", label: "Session", required: false, secret: true },
    { name: "region", label: "Region", required: true },
  ]);
  const { deps } = storeFixture([host]);
  await createPublishCredential(deps, { workspaceId, label: "Regional", connection: { providerId: "docs", token: "original-token", session: "session-value", region: "west" } });
  await updatePublishCredential(deps, { workspaceId, id: "key-1", connection: { providerId: "docs", token: "", session: null, region: "east" } });
  expect((await resolveDefaultForPublish(deps, { workspaceId, providerId: "docs" }))?.connection)
    .toEqual({ providerId: "docs", token: "original-token", region: "east" });
});

it("maps a credential open fault to a safe store error without falling back to another key", async () => {
  const { deps, site } = storeFixture([credentialTarget("docs", "docs-vendor")]);
  await createPublishCredential(deps, build("Team", "docs-token-2345"));
  site.sealer.open.mockRejectedValueOnce(new Error("raw keyring diagnostic"));
  const request = resolveDefaultForPublish(deps, { workspaceId, providerId: "docs" });
  await expect(request).rejects.toThrow(PublishCredentialSecretStoreUnconfiguredError);
  await expect(request).rejects.toThrow("The site credential store could not unlock the connection.");
  expect(site.sealer.open).toHaveBeenCalledTimes(1);
});

it("opens a compatible custom key through its legacy kind and projects only the target token", async () => {
  const host = credentialTarget("docs", "docs-vendor", [{ name: "accessKey", label: "Key", required: true }], "accessKey");
  const { deps, repo, site } = storeFixture([host]);
  // A legacy row predates the vault service's prohibition on creating new custom-kind rows.
  const identity = { ...repo.credentialVault.scope({ workspaceId, kind: "custom" }), id: "legacy-key" };
  const sealed = await site.sealer.seal({ key: { keyId: "site-key" }, aad: buildVaultAad(identity),
    plaintext: JSON.stringify({ token: "legacy-token-1234", privateField: "never forward this" }) });
  const summary = await site.vault.put({ expectedRevision: null, record: { ...identity, provider: null, label: "Legacy",
    meta: { credentialType: "custom", worksFor: ["docs"], category: "api" }, sealed, last4: null, tokenLength: null,
    revision: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" } });
  expect(await hasDefaultForPublish(deps, { workspaceId, providerId: "docs", id: "legacy-key" }))
    .toEqual({ id: "legacy-key", revision: summary.revision });
  expect(await resolveForPublish(deps, { workspaceId, id: "legacy-key" })).toEqual({
    providerId: "docs", vendorId: "docs-vendor", label: "Legacy", revision: summary.revision,
    isDefault: true, connection: { providerId: "docs", accessKey: "legacy-token-1234" },
  });
});

it("site keys hide matching project labels without hiding other shared keys", async () => {
  const { deps } = storeFixture([credentialTarget("docs", "docs-vendor")], { withProject: true });
  await createPublishCredential(deps, build("Team", "hidden-project-key"));
  await createPublishCredential(deps, build("Other workspace key", "eligible-project-key"));
  await createPublishCredential(deps, { ...build("Team", "visible-site-key"), scope: "site" });
  expect((await listPublishCredentials(deps, { workspaceId })).map(({ id, scope, isDefault }) => [id, scope, isDefault])).toEqual([
    ["key-3", "site", true], ["key-2", "project", false],
  ]);
  expect(await resolveForPublish(deps, { workspaceId, id: "key-1" })).toBeNull();
  expect((await resolveForPublish(deps, { workspaceId, id: "key-2" }))?.connection.token).toBe("eligible-project-key");
  expect((await resolveDefaultForPublish(deps, { workspaceId, providerId: "docs" }))?.id).toBe("key-3");
});

it("a key made incompatible after inventory cannot publish using the stale metadata", async () => {
  const { deps, site } = storeFixture([credentialTarget("docs", "docs-vendor")]);
  const saved = await createPublishCredential(deps, build("Team", "docs-token-2345"));
  const id = { workspaceId, id: saved.id };
  const stored = await site.vault.find(id);
  if (!stored) throw new Error("credential fixture did not save");
  const readList = site.vault.list.bind(site.vault);
  const list = vi.spyOn(site.vault, "list").mockImplementationOnce(async query => {
    const snapshot = await readList(query);
    await site.vault.patchMeta({ ...id, expectedRevision: stored.revision, patch: { worksFor: [] }, updatedAt: "2026-11-01T00:00:00Z" });
    return snapshot;
  });
  try {
    expect(await resolveForPublish(deps, { ...id, providerId: "docs" })).toBeNull();
    expect(await site.vault.find(id)).toMatchObject({ meta: { worksFor: [] }, revision: stored.revision + 1 });
  } finally {
    list.mockRestore();
  }
});
