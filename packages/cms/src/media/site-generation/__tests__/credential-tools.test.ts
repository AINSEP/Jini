import { expect, it, vi } from "vitest";
import type { MediaProviderCredentialRecord, MediaProviderCredentialRepoPort } from "../../site/provider-credential-contracts.js";
import { saveMediaProviderKey } from "../provider-credential-save.js";
import { buildMediaProviderRegistrations, contributeMediaProviderTools, saveMediaCredential, type MediaProviderToolDeps } from "../providers-tools.js";

it("a provider patch preserves concurrent unrelated rows and preserves the sealed record descriptor", async () => {
  const current: MediaProviderCredentialRecord[] = [
    { workspaceId: "ws", providerId: "selected", baseUrl: "https://new.example", model: "new-model", sealed: null, keyTail: null, aadVersion: 0, createdAt: "stamp", updatedAt: "stamp" },
    { workspaceId: "ws", providerId: "other", baseUrl: null, model: "other", sealed: null, keyTail: null, aadVersion: 0, createdAt: "stamp", updatedAt: "stamp" },
  ];
  const secretRecord = { marker: "sealed" };
  let rows = [...current];
  const repo: Pick<MediaProviderCredentialRepoPort, "replaceWorkspace" | "vault"> = {
    replaceWorkspace: async ({ plan }) => {
      const patch = plan({ existing: rows });
      expect(patch.tombstoneProviderIds).toEqual([]);
      const selected = patch.upserts[0]!;
      expect(Object.getOwnPropertyDescriptor(selected, "vaultRecord")).toMatchObject({ value: secretRecord, enumerable: false });
      rows = rows.map(row => patch.upserts.find(next => next.providerId === row.providerId) ?? row);
      return patch.upserts;
    },
  };
  await saveMediaProviderKey({ deps: { repo }, workspaceId: "ws", provider: "selected", apiKey: "private",
    saveProviders: async ({ deps }, { providers }) => {
      expect(providers).toEqual({ selected: { apiKey: "private" } });
      const row = { ...current[0]!, baseUrl: "stale", model: "stale" };
      Object.defineProperty(row, "vaultRecord", { value: secretRecord });
      await deps.repo.replaceWorkspace({ workspaceId: "ws", plan: () => ({ upserts: [row], tombstoneProviderIds: ["other"] }) });
      return { selected: { apiKeyConfigured: true } };
    } });
  expect(rows[0]).toMatchObject({ baseUrl: "https://new.example", model: "new-model" });
  expect(rows[1]).toEqual(current[1]);
});

function fixture() {
  const repo: MediaProviderCredentialRepoPort = { listByWorkspaceId: vi.fn(async () => []), upsert: vi.fn(), deleteByProviderIds: vi.fn(), replaceWorkspace: vi.fn() };
  const deps: MediaProviderToolDeps = { workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "granted" }), mediaProviderCredentialRepo: repo,
    clock: { nowMs: () => 0 }, idGen: { newId: () => "fresh" }, siteAssistantSecretSealer: { seal: vi.fn(), open: vi.fn() },
    siteAssistantSecretKeyring: { activeKey: vi.fn(), deriveSigningSecret: vi.fn(), derive: vi.fn() },
    mediaProviderRegistry: { listProviders: () => [{ id: "selected", label: "Selected", hint: "", integrated: true }],
      modelsForSurface: () => [{ id: "model", provider: "selected", label: "Model", hint: "", caps: ["t2i"] }], findProvider: () => null },
  };
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: () => 0 } };
  const host: Parameters<typeof saveMediaCredential>[0]["host"] = {
    getMediaProviderCredentials: async () => ({ selected: { apiKeyConfigured: true, apiKeyHint: { length: 10, last4: "tail" } } }),
    saveProviders: vi.fn(), assertCredentialFreeField: vi.fn(), credentialText: ({ id }) => id, formatCredentialHint: () => "hint",
    secureCard: vi.fn(),
  };
  return { deps, surfaces, host };
}

it("abort after the lock prevents the save", async () => {
  const f = fixture(); const controller = new AbortController();
  const planApplied = vi.fn();
  f.deps.mediaProviderCredentialRepo.replaceWorkspace = async ({ plan }) => {
    controller.abort(new Error("aborted after lock"));
    const patch = plan({ existing: [] });
    planApplied(patch); return patch.upserts;
  };
  f.host.saveProviders = async ({ deps }) => {
    await deps.repo.replaceWorkspace({ workspaceId: "ws", plan: () => ({ upserts: [], tombstoneProviderIds: [] }) });
    return {};
  };
  f.host.secureCard = async ({ save }) => { await save({ value: "private", signal: controller.signal }); return { saved: true, provider: "selected", configured: true }; };
  await expect(saveMediaCredential({ deps: f.deps, surfaces: f.surfaces, host: f.host,
    ctx: { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { provider: "selected" }, signal: controller.signal } })).rejects.toThrow("aborted after lock");
  expect(planApplied).not.toHaveBeenCalled();
});

it("listing returns presence only", async () => {
  const f = fixture();
  const registration = buildMediaProviderRegistrations(f)[0]!;
  expect(await registration.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: {}, signal: new AbortController().signal })).toEqual({ providers: [
    { id: "selected", label: "Selected", integrated: true, configured: true, kinds: ["image", "video"] },
  ] });
});

it("credential-card outcomes distinguish saved, blank, failed and cancelled without echoing a submitted value", async () => {
  const f = fixture();
  f.deps.mediaProviderRegistry = { ...f.deps.mediaProviderRegistry,
    listProviders: () => [{ id: "selected", label: "Selected", hint: "", integrated: false }] };
  f.host.credentialText = ({ id }) => ({ saved: "Key saved.", blank: "Enter a key.", generationUnavailable: "Generation is not available." })[id];
  f.host.formatCredentialHint = ({ hint }) => hint?.last4 ? `Ends in ${hint.last4}` : "";
  const genericFailure = 'Nothing was saved. Check the key and the server credential store, then try again.';
  const records: unknown[] = [];
  const tokenHint = { length: 16, last4: "4567" };
  f.host.secureCard = async ({ prep, result, outcome }) => {
    for (const run of [
      { status: "saved", saved: { configured: true, tokenHint } }, { status: "blank" }, { status: "cancelled" },
      { status: "failed", safeMessage: "Choose another key." }, { status: "failed", safeMessage: genericFailure },
    ] as const) records.push([result({ prep, run }), outcome({ prep, run })]);
    return result({ prep, run: { status: "cancelled" } });
  };
  const ctx = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { provider: "selected" }, signal: new AbortController().signal };
  const declined = { saved: false, provider: "selected", configured: true };
  expect(await saveMediaCredential({ ...f, ctx })).toEqual(declined);
  expect(records).toEqual([
    [{ saved: true, provider: "selected", configured: true, tokenHint, connection: "not_tested",
      message: "Ends in 4567. Key saved. Generation is not available." },
    { title: "Provider key saved", state: "success", message: "Ends in 4567. Key saved. Generation is not available." }],
    [{ ...declined, message: "Enter a key." }, { title: "Provider key not saved", state: "failure", message: "Enter a key." }],
    [declined, undefined],
    [{ ...declined, message: "Choose another key." }, { title: "Provider key not saved", state: "failure", message: "Choose another key." }],
    [declined, { title: "Provider key not saved", state: "failure", message: genericFailure }],
  ]);
  expect(vi.mocked(f.host.saveProviders).mock.calls).toEqual([]);
});

it("media-provider contribution dispatches its safe configured marker using the chosen workspace", async () => {
  const f = fixture();
  const getMediaProviderCredentials = vi.fn(f.host.getMediaProviderCredentials);
  const [registration] = contributeMediaProviderTools({ host: { ...f.host, getMediaProviderCredentials } }).build(f.deps, f.surfaces);
  const input = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  expect(await registration!.handler(input)).toEqual({ providers: [{ id: "selected", label: "Selected", integrated: true, configured: true, kinds: ["image", "video"] }] });
  expect(getMediaProviderCredentials.mock.calls).toEqual([[{ repo: f.deps.mediaProviderCredentialRepo }, { workspaceId: "ws" }]]);
});
