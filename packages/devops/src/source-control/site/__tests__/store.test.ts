import { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken } from "@jini-ai/platform/secrets/credential-token";
import { credentialScopes, credentialCreateTarget } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { expect, it, vi } from "vitest";
import { VaultError } from "@jini-ai/core/contracts/vault";
import type { CanonicalSourceControlKeys } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { HttpRequest } from "@jini-ai/core/primitives";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { CredentialSetVaultAdapter, toSourceControlCredentialRecord } from "@jini-ai/integrations/vendor-credentials/vault-adapter";
import { createSourceControlCredential, updateSourceControlCredential, describeCredential, deleteSourceControlCredential, findDefaultSourceControlCredential, isUniqueLabelViolation, listSourceControlCredentials,
  resolveDefaultForSourceControl, SourceControlCredentialDuplicateLabelError, SourceControlCredentialSecretStoreUnconfiguredError,
  type SourceControlCredentialWriteDeps } from "../store.js";

function fixture(id = "credential") {
  const vault = new InMemoryVaultRepo({});
  const policy = { ownerKey: "host", acceptedKinds: ["source-control"], metaParsers: createVaultMetaParsers({}), openService: (required: ConstructorParameters<typeof SecretsVaultService>[0]) => new SecretsVaultService(required) };
  const repo = new CredentialSetVaultAdapter({ vault, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
  const descriptor = { id: "git", label: "Git", apiOrigin: "https://git.example", module: "git.mjs", credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true, secret: true }] } } as const;
  const loaded = { descriptor, pluginId: "git-plugin", module: { create: () => { throw new Error("fixture uses the injected provider builder"); } } } as const;
  const loadSourceControlProviders = vi.fn<NonNullable<SourceControlCredentialWriteDeps["loadSourceControlProviders"]>>(async () => ({
    get: ({ providerId }) => providerId === descriptor.id ? loaded : undefined, list: () => [loaded], refusals: [],
  }));
  const buildSourceControlProvider = vi.fn<SourceControlCredentialWriteDeps["buildSourceControlProvider"]>(async () => { throw new Error("probe failed"); });
  const deps = { deps: { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken, credentialScopes, credentialCreateTarget }, repo, clock: { nowMs: () => 0 }, idGen: { newId: () => id }, keyring: { activeKey: async () => ({ keyId: "k" }), derive: vi.fn(), deriveSigningSecret: vi.fn() },
    sealer: { seal: async ({ plaintext }: { plaintext: string }) => ({ keyId: "k", alg: "test", nonce: "nonce", ciphertext: plaintext }), open: async ({ sealed }: { sealed: { ciphertext: string } }) => sealed.ciphertext },
    loadSourceControlProviders, buildSourceControlProvider, assertCredentialFreeField: vi.fn(), isProjectKeyCreateConflictError: () => false,
  } as unknown as SourceControlCredentialWriteDeps;
  return { deps, vault, loadSourceControlProviders, buildSourceControlProvider };
}

it("a blank token patch preserves the saved envelope without probing", async () => {
  const f = fixture();
  await createSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", label: "label", connection: { providerId: "git", token: "original-token" } } });
  const before = await f.vault.find({ workspaceId: "w", id: "credential" });
  f.buildSourceControlProvider.mockClear(); f.loadSourceControlProviders.mockClear();
  await updateSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", id: "credential", connection: { token: "" } } });
  expect((await f.vault.find({ workspaceId: "w", id: "credential" }))?.sealed).toEqual(before?.sealed);
  expect(f.buildSourceControlProvider).not.toHaveBeenCalled(); expect(f.loadSourceControlProviders).not.toHaveBeenCalled();
});

it("a failed identity probe leaves the newly saved credential intact", async () => {
  const f = fixture();
  const patch = vi.spyOn(f.vault, "patchMeta");
  const result = await createSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", label: "label", connection: { providerId: "git", token: "original-token" } } });
  expect(result).toMatchObject({ configured: true, connection: "saved", accountLabel: null });
  expect((await f.vault.find({ workspaceId: "w", id: "credential" }))?.sealed?.ciphertext).toBe('{"providerId":"git","token":"original-token"}');
  expect(patch).not.toHaveBeenCalled();
});

it("permanent delete reviews and removes a canonical source-control credential", async () => {
  const f = fixture();
  const summary = { id: "canonical", providerId: "git", label: "Shared Git", configured: true as const,
    isDefault: false, accountLabel: null, scope: "project" as const,
    createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z" };
  const list = vi.fn(async () => [summary]);
  const remove = vi.fn(async () => ({ owned: true }));
  Object.assign(f.deps.repo, { canonical: { list, remove } });
  const legacyRemove = vi.spyOn(f.deps.repo, "delete");
  const input = { workspaceId: "w", id: summary.id };
  expect(await describeCredential(f.deps, input)).toEqual(summary);
  expect(list).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w" });
  await deleteSourceControlCredential(f.deps, input);
  expect(remove).toHaveBeenCalledExactlyOnceWith(input);
  expect(legacyRemove).not.toHaveBeenCalled();
});

const destination = { workspaceId: "w", providerId: "git" };
const inspected = { workspaceId: "w", id: "credential" };
const original = { providerId: "git", token: "original-token-1111" };
const create = (deps: SourceControlCredentialWriteDeps, label = "First key", isDefault?: boolean) =>
  createSourceControlCredential({ deps, input: { workspaceId: "w", label, connection: original, isDefault } });

function useAccountProbe(deps: SourceControlCredentialWriteDeps) {
  const send = vi.fn<NonNullable<SourceControlCredentialWriteDeps["httpClient"]>["send"]>();
  const request = (token: string): HttpRequest => ({ url: "https://git.example/me", method: "GET", headers: { Authorization: `Bearer ${token}` }, idleTimeoutMs: 2000 });
  deps.httpClient = { send };
  const build = vi.mocked(deps.buildSourceControlProvider);
  build.mockImplementation(async ({ httpClient, providerId, workspaceId }) => {
    if (!httpClient || providerId !== "git" || workspaceId !== "w") return { ok: false, message: "not wired for this workspace" };
    return { ok: true, provider: { readAccountLabel: async token => {
      const response = await httpClient.send(request(token), { redirect: "error" });
      return response.status >= 200 && response.status < 300 ? response.bodyText : null;
    } } };
  });
  return { send, request };
}

it.each([
  [401, "auth"], [403, "auth"], [300, "unreachable"], [503, "unreachable"],
] as const)("saves a token even when the identity probe returns HTTP %i (%s)", async (status, connection) => {
  const { deps } = fixture();
  const { send, request } = useAccountProbe(deps);
  send.mockResolvedValueOnce({ status, headers: {}, bodyText: "not-an-account" });
  expect(await create(deps)).toMatchObject({ id: "credential", connection, accountLabel: null });
  expect(send).toHaveBeenCalledExactlyOnceWith(request(original.token), { redirect: "error" });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "First key", connection: original });
});

it.each([
  ["named timeout", new DOMException("no result", "TimeoutError"), "timeout"],
  ["transport timeout", new Error("request TIMED OUT"), "timeout"],
  ["general I/O error", new Error("connection reset"), "unreachable"],
  ["non-Error rejection", "disconnected", "unreachable"],
] as const)("reports a %s without losing the saved token", async (_name, error, connection) => {
  const { deps } = fixture();
  const { send, request } = useAccountProbe(deps);
  send.mockRejectedValueOnce(error);
  expect(await create(deps)).toMatchObject({ id: "credential", connection, accountLabel: null });
  expect(send).toHaveBeenCalledExactlyOnceWith(request(original.token), { redirect: "error" });
  expect(await describeCredential(deps, inspected)).toMatchObject({ id: "credential", accountLabel: null, configured: true });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "First key", connection: original });
});

it("rotates the saved token, clears the old identity and heals it using the new token's probe", async () => {
  const { deps, vault } = fixture();
  const { send, request } = useAccountProbe(deps);
  send.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "studio-old" });
  expect(await create(deps)).toMatchObject({ connection: "connected", accountLabel: "studio-old" });
  expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: "studio-old", tokenHint: { length: 19, last4: "1111" } });

  const replacement = "rotated-token-2222";
  send.mockImplementationOnce(async () => {
    // Observe what is already durable at the transport boundary, before this probe can heal it.
    const row = await vault.find(inspected);
    return { status: 299, headers: {}, bodyText: row?.meta.accountLabel === null ? "studio-current" : "stale-identity" };
  });
  expect(await updateSourceControlCredential({ deps, input: { ...inspected, label: "Rotated", connection: { token: replacement }, isDefault: true } }))
    .toMatchObject({ id: "credential", connection: "connected", accountLabel: "studio-current", label: "Rotated", isDefault: true });
  expect(send.mock.calls).toEqual([[request(original.token), { redirect: "error" }], [request(replacement), { redirect: "error" }]]);
  expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: "studio-current", tokenHint: { length: 18, last4: "2222" } });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "Rotated", connection: { providerId: "git", token: replacement } });
});

it("discards credential-shaped account labels before they reach the plaintext summary", async () => {
  const { deps } = fixture();
  const { send } = useAccountProbe(deps);
  const name = "user --token=sensitive-value";
  deps.assertCredentialFreeField = ({ value, field }) => {
    if (field === "accountLabel" && value === name) throw new CredentialInputError("plain", field);
  };
  send.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: name });
  const result = await create(deps);
  expect(result).toMatchObject({ id: "credential", connection: "connected", accountLabel: null });
  expect(JSON.stringify(result)).not.toContain("sensitive-value");
  expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: null });
});

it("preserves the saved token if writing optional probe metadata fails", async () => {
  const { deps, vault } = fixture();
  const { send } = useAccountProbe(deps);
  send.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "studio" });
  const patch = vi.spyOn(vault, "patchMeta").mockRejectedValueOnce(new VaultError({ code: "conflict" }));
  try {
    expect(await create(deps)).toMatchObject({ id: "credential", connection: "connected", accountLabel: "studio" });
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      ...inspected, expectedRevision: 1, patch: { accountLabel: "studio" }, updatedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: null });
    expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "First key", connection: original });
  } finally { patch.mockRestore(); }
});

it("refuses a project create or rename that this site's same host and label would hide", async () => {
  const site = fixture("site-key");
  const project = fixture("project-key");
  await create(site.deps, "Shared label");
  Object.assign(site.deps.repo, { project: { workspaceId: "project", repo: project.deps.repo, keyring: project.deps.keyring, sealer: project.deps.sealer } });
  site.deps.idGen = project.deps.idGen;

  const duplicate = new SourceControlCredentialDuplicateLabelError("a 'git' credential labeled 'Shared label' already exists in this workspace");
  await expect(create(site.deps, "Shared label")).rejects.toThrow(duplicate);
  expect(await project.deps.repo.listByWorkspace({ workspaceId: "project" })).toEqual([]);
  expect(await create(site.deps, "Project label", false)).toMatchObject({ id: "project-key", scope: "project", isDefault: false });
  await expect(updateSourceControlCredential({ deps: site.deps, input: { workspaceId: "w", id: "project-key", label: "Shared label" } }))
    .rejects.toThrow(duplicate);
  expect(await listSourceControlCredentials(site.deps, { workspaceId: "w" })).toMatchObject([
    { id: "site-key", label: "Shared label", scope: "site" },
    { id: "project-key", label: "Project label", scope: "project" },
  ]);
});

it("recognizes label uniqueness without classifying a vault revision conflict as a duplicate", async () => {
  expect(isUniqueLabelViolation({ err: Object.assign(new Error("duplicate key"), { code: "23505" }) })).toBe(true);
  const { deps, vault } = fixture();
  await create(deps);
  expect(isUniqueLabelViolation({ err: new VaultError({ code: "conflict" }) })).toBe(false);
  const conflict = new VaultError({ code: "conflict" });
  const put = vi.spyOn(vault, "put").mockRejectedValueOnce(conflict);
  try {
    await expect(updateSourceControlCredential({ deps, input: { ...inspected, label: "Renamed" } })).rejects.toBe(conflict);
    expect(await describeCredential(deps, inspected)).toMatchObject({ label: "First key" });
  } finally { put.mockRestore(); }
});

it("translates a label collision without replacing the other credential", async () => {
  const { deps } = fixture();
  await create(deps, "In use");
  deps.idGen = { newId: () => "different-id" };
  await expect(create(deps, "In use")).rejects.toThrow(new SourceControlCredentialDuplicateLabelError("a 'git' credential labeled 'In use' already exists in this workspace"));
  expect(await describeCredential(deps, { workspaceId: "w", id: "different-id" })).toBeNull();
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "In use", connection: original });
});

it("resolves a sole non-default credential, refuses ambiguity and forgets deleted rows", async () => {
  const { deps } = fixture();
  expect(await resolveDefaultForSourceControl(deps, destination)).toBeNull();
  await create(deps, "Only option", false);
  expect(await findDefaultSourceControlCredential(deps, destination)).toMatchObject({ id: "credential", label: "Only option", providerId: "git", isDefault: false });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "Only option", connection: original });
  deps.idGen = { newId: () => "second" };
  await create(deps, "Other option", false);
  expect(await findDefaultSourceControlCredential(deps, destination)).toBeNull();
  expect(await resolveDefaultForSourceControl(deps, destination)).toBeNull();
  await deleteSourceControlCredential(deps, inspected);
  expect(await describeCredential(deps, inspected)).toBeNull();
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "second", label: "Other option", connection: original });
  await deleteSourceControlCredential(deps, inspected);
  expect(await listSourceControlCredentials(deps, { workspaceId: "w" })).toMatchObject([{ id: "second" }]);
});

it("reports an unreadable saved token with the storage error and leaves its metadata readable", async () => {
  const { deps } = fixture();
  await create(deps);
  deps.sealer = { ...deps.sealer, open: async () => { throw new Error("private decrypt detail"); } };
  await expect(resolveDefaultForSourceControl(deps, destination)).rejects.toThrow(
    new SourceControlCredentialSecretStoreUnconfiguredError("The credential could not be saved or unlocked. Check the site credential store."),
  );
  expect(await describeCredential(deps, inspected)).toMatchObject({ id: "credential", label: "First key" });
});

it("routes provider-owned credentials to their canonical store instead of writing a legacy row", async () => {
  const { deps, vault } = fixture();
  const summary = { id: "canonical", providerId: "git", label: "Provider key", configured: true as const, isDefault: true,
    accountLabel: null, createdAt: "2026-11-01", updatedAt: "2026-11-02" };
  const createKey = vi.fn<NonNullable<CanonicalSourceControlKeys["create"]>>(async () => summary);
  const lookup = vi.fn<CanonicalSourceControlKeys["describe"]>(async () => ({ id: "canonical", label: "Provider key", providerId: "git" }));
  const resolve = vi.fn<CanonicalSourceControlKeys["resolve"]>(async () => ({ id: "canonical", label: "Provider key", connection: original }));
  const canonical: CanonicalSourceControlKeys = {
    supports: ({ providerId }) => providerId === "git", list: async () => [summary],
    describe: lookup, resolve, update: async () => ({ owned: false }), remove: async () => ({ owned: false }),
  };
  Object.assign(deps.repo, { canonical });
  await expect(create(deps)).rejects.toThrow("Open the provider's API key card to save this shared key.");
  Object.assign(deps.repo, { canonical: { ...canonical, create: createKey } });
  expect(await create(deps)).toEqual(summary);
  expect(createKey).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", connection: original });
  expect(await vault.find(inspected)).toBeNull();
  expect(await findDefaultSourceControlCredential(deps, destination)).toEqual({ id: "canonical", label: "Provider key", providerId: "git" });
  expect(lookup).toHaveBeenCalledExactlyOnceWith(destination);
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "canonical", label: "Provider key", connection: original });
  expect(resolve).toHaveBeenCalledExactlyOnceWith(destination);
});

it("selects the sole visible project key without promoting it or borrowing a hidden default", async () => {
  const site = fixture("site-local");
  const project = fixture("project-hidden");
  await create(site.deps, "Shared label", false);
  await createSourceControlCredential({ deps: project.deps, input: {
    workspaceId: "project", label: "Shared label", connection: { providerId: "git", token: "project-hidden-token" }, isDefault: true,
  } });
  project.deps.idGen = { newId: () => "project-visible" };
  await createSourceControlCredential({ deps: project.deps, input: {
    workspaceId: "project", label: "Visible project", connection: { providerId: "git", token: "project-visible-token" }, isDefault: false,
  } });
  site.deps.idGen = { newId: () => "second-local" };
  await create(site.deps, "Other local key", false);
  Object.assign(site.deps.repo, { project: { workspaceId: "project", repo: project.deps.repo, keyring: project.deps.keyring, sealer: project.deps.sealer } });
  expect((await listSourceControlCredentials(site.deps, { workspaceId: "w" })).map(row => [row.id, row.scope])).toEqual([
    ["second-local", "site"], ["site-local", "site"], ["project-visible", "project"],
  ]);
  expect(await findDefaultSourceControlCredential(site.deps, destination)).toMatchObject({
    id: "project-visible", label: "Visible project", isDefault: false,
  });
  expect(await resolveDefaultForSourceControl(site.deps, destination)).toEqual({
    id: "project-visible", label: "Visible project", connection: { providerId: "git", token: "project-visible-token" },
  });
  expect(await project.deps.repo.findDefaultByProvider({ workspaceId: "project", providerId: "git" })).toMatchObject({ id: "project-hidden" });
});

it("does not let an earlier identity probe overwrite a later token rotation", async () => {
  const { deps } = fixture();
  const { send } = useAccountProbe(deps);
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let finishEarlier!: (value: Awaited<ReturnType<typeof send>>) => void;
  const earlier = new Promise<Awaited<ReturnType<typeof send>>>(resolve => { finishEarlier = resolve; });
  send.mockImplementationOnce(() => { markStarted(); return earlier; });
  send.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "Current account" });
  const initial = create(deps);
  await Promise.race([started, initial.then(() => { throw new Error("initial probe was not started"); })]);
  try {
    const rotated = await updateSourceControlCredential({ deps, input: { ...inspected, connection: { token: "rotated-token-2222" } } });
    expect(rotated).toMatchObject({ id: "credential", accountLabel: "Current account" });
    expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: "Current account" });
  } finally { finishEarlier({ status: 200, headers: {}, bodyText: "Stale account" }); }
  await initial;
  expect(await describeCredential(deps, inspected)).toMatchObject({ accountLabel: "Current account", tokenHint: { length: 18, last4: "2222" } });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({
    id: "credential", label: "First key", connection: { providerId: "git", token: "rotated-token-2222" },
  });
});

it("keeps a durable token when the provider is admitted but has no usable probe adapter", async () => {
  const { deps, buildSourceControlProvider, loadSourceControlProviders } = fixture();
  buildSourceControlProvider.mockResolvedValueOnce({ ok: false, message: "No probe adapter" });
  expect(await create(deps)).toMatchObject({ id: "credential", accountLabel: null, connection: "saved" });
  expect(buildSourceControlProvider).toHaveBeenCalledExactlyOnceWith({ load: loadSourceControlProviders, workspaceId: "w", providerId: "git" });
  expect(await resolveDefaultForSourceControl(deps, destination)).toEqual({ id: "credential", label: "First key", connection: original });
});

it("preserves a project-owner duplicate label refusal without publishing a credential", async () => {
  const { deps, vault } = fixture();
  const conflict = new Error("This project already has a key named 'First key'.");
  deps.isProjectKeyCreateConflictError = (error): error is Error => error === conflict;
  const put = vi.spyOn(vault, "put").mockRejectedValueOnce(conflict);
  try {
    const attempted = create(deps);
    await expect(attempted).rejects.toBeInstanceOf(SourceControlCredentialDuplicateLabelError);
    await expect(attempted).rejects.toThrow("This project already has a key named 'First key'.");
    expect(await listSourceControlCredentials(deps, { workspaceId: "w" })).toEqual([]);
  } finally { put.mockRestore(); }
});
