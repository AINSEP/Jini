import { abortGuardedCredentialRepo } from "@jini-ai/integrations/vendor-credentials/abort-guarded-repo";
import { expect, it, vi } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { SecretCardForm, SurfaceCardOutcome, SurfaceCardSecretRun, SurfaceCardsPort } from "@jini-ai/core/contracts/cards";
import type { CanonicalSourceControlKeys, SourceControlCredentialSetRecord, SourceControlCredentialSetRepoPort, SourceControlCredentialSummary } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { VaultPutRecord } from "@jini-ai/core/contracts/vault";
import { InMemoryVaultRepo } from "@jini-ai/platform/secrets/credential-sets";
import { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken } from "@jini-ai/platform/secrets/credential-token";
import { credentialCreateTarget, credentialScopes } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { SourceControlCredentialDuplicateLabelError, type SourceControlProviderRegistry } from "../store.js";
import { abortGuardedSourceControlRepo, proposeSourceControlCredential, PROPOSE_CREDENTIAL_CLOSED, type SourceControlCredentialSetupDeps } from "../credential-setup.js";

it("an aborted secure-card submission cannot save a credential", async () => {
  const abort = new AbortController();
  const reason = new Error("run ended after the operator submitted");
  const f = cardFixture();
  f.deps.defineSecretCardTool = spec => ({
    toolId: spec.toolId, secretFieldNames: () => [],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      spec.form({ prep });
      abort.abort(reason);
      await expect(spec.save({
        prep, values: { label: "Editorial copy", personalToken: "submitted-token", login: "studio" }, signal: abort.signal,
      })).rejects.toBe(reason);
      return spec.result({ prep, run: { status: "abandoned" } });
    },
  });
  expect(await f.run(confirmationInput, abort.signal)).toEqual({
    saved: false, credentialId: null, provider: "forge", label: "Editorial copy", cancelled: false, message: PROPOSE_CREDENTIAL_CLOSED,
  });
  expect(f.create).not.toHaveBeenCalled();
  expect(await f.canonical.list({ workspaceId: "site" })).toEqual([]);
});

const confirmationInput = { provider: "forge", label: "Editorial copy" };
const provider: ReturnType<SourceControlProviderRegistry["list"]>[number] = {
  descriptor: { id: "forge", label: "Forge", apiOrigin: "https://forge.example", module: "forge.mjs", credential: {
    tokenField: "personalToken",
    fields: [
      { name: "personalToken", label: "Personal token", required: true, secret: true },
      { name: "login", label: "Login", required: true },
      { name: "pin", label: "Optional PIN", required: false, secret: true },
    ],
  } },
  pluginId: "forge-plugin", module: { create: () => { throw new Error("unexpected plugin build"); } },
};

function cardFixture(action: "submit" | "cancelled" | "expired" | "blank" | "abandoned" = "submit") {
  const forms: SecretCardForm[] = [];
  const outcomes: (SurfaceCardOutcome | undefined)[] = [];
  const records: SourceControlCredentialSummary[] = [];
  const create = vi.fn<NonNullable<CanonicalSourceControlKeys["create"]>>(async ({ workspaceId, connection }, options) => {
    options?.signal?.throwIfAborted();
    if (workspaceId !== "site" || connection.providerId !== "forge") throw new Error("Unexpected save target");
    const summary: SourceControlCredentialSummary = {
      id: "selected-key", providerId: "forge", label: "Editorial copy", configured: true, isDefault: false, accountLabel: null,
      tokenHint: { length: 18, last4: "0017" }, createdAt: "2026-11-01", updatedAt: "2026-11-02",
    };
    records.push(summary);
    return summary;
  });
  const canonical: CanonicalSourceControlKeys = {
    create, supports: ({ providerId }) => providerId === "forge",
    list: async ({ workspaceId }) => workspaceId === "site" ? [...records] : [],
    describe: async () => null, resolve: async () => null, remove: async () => ({ owned: false }), update: async () => ({ owned: false }),
  };
  const vault = new InMemoryVaultRepo({});
  const store: SourceControlCredentialSetRepoPort = {
    canonical, vault, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), findById: async () => null,
    findDefaultByProvider: async () => null, listByProvider: async () => [], listByWorkspace: async () => [],
  };
  const defineSecretCardTool: SurfaceCardsPort["defineSecretCardTool"] = (spec, options) => ({
    toolId: spec.toolId, secretFieldNames: () => [],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      if (ctx.signal.aborted) {
        const run = { status: "abandoned" } as const;
        outcomes.push(spec.outcome({ prep, run }));
        return spec.result({ prep, run });
      }
      forms.push(spec.form({ prep }));
      const run = await (async (): Promise<SurfaceCardSecretRun<Awaited<ReturnType<typeof spec.save>>>> => {
        if (action !== "submit") return { status: action };
        try {
          const saved = await spec.save({
            prep, signal: ctx.signal, values: {
              label: "Editorial copy", personalToken: "fake-primary--0017", login: "studio", pin: " pair-pin ", unexpected: "must-not-cross-the-port",
            },
          });
          return { status: "saved", saved };
        } catch (error) {
          options?.logFailure?.({ toolId: spec.toolId, exchangeId: "fixture-exchange", saved: false });
          return { status: "failed", safeMessage: options?.safeError?.(error) ?? options?.text?.saveFailure ?? "Missing safe save error" };
        }
      })();
      outcomes.push(spec.outcome({ prep, run }));
      return spec.result({ prep, run });
    },
  });
  const loadSourceControlProviders = vi.fn<SourceControlCredentialSetupDeps["loadSourceControlProviders"]>(async ({ workspaceId }) => {
    if (workspaceId !== "site") throw new Error("Unexpected registry workspace");
    return { list: () => [provider], get: ({ providerId }) => providerId === "forge" ? provider : undefined, refusals: [] };
  });
  const findPluginCredentialCard = vi.fn<SourceControlCredentialSetupDeps["findPluginCredentialCard"]>(async () => undefined);
  const reportCredentialFailure = vi.fn();
  const applyPluginCredentialCard = vi.fn<SourceControlCredentialSetupDeps["applyPluginCredentialCard"]>(({ form }) => form);
  const buildSourceControlProvider = vi.fn<SourceControlCredentialSetupDeps["buildSourceControlProvider"]>(async () => ({ ok: false, message: "not needed" }));
  const deps: SourceControlCredentialSetupDeps = {
    deps: { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken, credentialCreateTarget, credentialScopes, abortGuardedCredentialRepo },
    defineSecretCardTool, applyPluginCredentialCard, findPluginCredentialCard,
    askThenReport: async () => { throw new Error("fixture drives the card port directly"); },
    credentialSaveToolId: "credential_save", credentialFormUriHost: "credentials.test",
    backupRepositoryRules: "Use a private repository.",
    credentialText: ({ id, locale }) => `${locale}: ${CREDENTIAL_MESSAGES[id]}`,
    formatCredentialHint: ({ hint }) => hint ? `Ends in ${hint.last4}` : "",
    assertCredentialFreeField: vi.fn(), reportCredentialFailure, buildSourceControlProvider,
    isProjectKeyCreateConflictError: (_error): _error is Error => false,
    workspaceId: "site", authorize: async () => ({ allowed: true }),
    sourceControlCredentialSetRepo: store,
    siteAssistantSecretSealer: { seal: async () => { throw new Error("canonical key store owns sealing"); }, open: async () => { throw new Error("form must not open an old key"); } },
    siteAssistantSecretKeyring: { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(), deriveSigningSecret: async () => new Uint8Array() },
    clock: { nowMs: () => 0 }, idGen: { newId: () => "unexpected-legacy-id" }, loadSourceControlProviders,
  };
  const run = (input: unknown = confirmationInput, signal = new AbortController().signal) => {
    const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "owner" }, input, signal };
    return proposeSourceControlCredential({ ctx, deps, surfaces: { surfaceExchanges: {} as never } });
  };
  return { deps, store, vault, run, forms, outcomes, canonical, create, loadSourceControlProviders, findPluginCredentialCard, reportCredentialFailure, applyPluginCredentialCard };
}

it("renders the declared human-only fields and saves a canonical token under its wire name", async () => {
  const f = cardFixture();
  const signal = new AbortController().signal;
  expect(await f.run(confirmationInput, signal)).toEqual({
    saved: true, credentialId: "selected-key", provider: "forge", label: "Editorial copy",
    tokenHint: { length: 18, last4: "0017" }, connection: "saved", message: "Ends in 0017. en: Saved, not tested.",
  });
  expect(f.forms).toEqual([{
    title: "Connect Forge", description: "Type the secret here. The assistant never sees it. Use a private repository.", submitLabel: "Save credential",
    fields: [
      { kind: "string", name: "label", label: "Label", required: true, value: "Editorial copy" },
      { kind: "string", name: "personalToken", label: "Personal token", required: true, secret: true, allowBlank: false },
      { kind: "string", name: "login", label: "Login", required: true },
      { kind: "string", name: "pin", label: "Optional PIN", required: false, secret: true, allowBlank: true },
    ],
  }]);
  expect(f.findPluginCredentialCard).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", loadCards: undefined, saveKind: "source-control", target: "forge" });
  expect(f.create).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "site", connection: { providerId: "forge", token: "fake-primary--0017", login: "studio", pin: "pair-pin" },
  }, { signal });
  expect(await f.canonical.list({ workspaceId: "site" })).toMatchObject([{ id: "selected-key", label: "Editorial copy" }]);
  expect(f.outcomes).toEqual([{ title: "Credential saved", state: "success", message: "Ends in 0017. en: Saved, not tested." }]);
});

it.each([
  ["cancelled", true, "The person cancelled the form. Nothing was saved.", undefined],
  ["expired", false, "The form closed without an answer (it timed out or the chat run ended). Nothing was saved.", undefined],
  ["abandoned", false, "The form closed without an answer (it timed out or the chat run ended). Nothing was saved.", undefined],
  ["blank", false, "en: Enter a token. Spaces alone are not a token.",
    { title: "Credential not saved", state: "failure", message: "en: Enter a token. Spaces alone are not a token." }],
] as const)("reports a %s form without treating it as a save", async (action, cancelled, message, outcome) => {
  const f = cardFixture(action);
  expect(await f.run({ provider: "forge" })).toEqual({ saved: false, credentialId: null, provider: "forge", label: "default", cancelled, message });
  expect(f.outcomes).toEqual([outcome]);
  expect(await f.canonical.list({ workspaceId: "site" })).toEqual([]);
  expect(f.create).not.toHaveBeenCalled();
});

it("does not build a form or read plugins for an already ended run", async () => {
  const f = cardFixture();
  const abort = new AbortController();
  abort.abort();
  expect(await f.run(confirmationInput, abort.signal)).toEqual({
    saved: false, credentialId: null, provider: "forge", label: "Editorial copy", cancelled: false,
    message: "The chat run ended before the form opened. Nothing was saved.",
  });
  expect(f.forms).toEqual([]);
  expect(f.outcomes).toEqual([undefined]);
  expect(f.loadSourceControlProviders).not.toHaveBeenCalled();
  expect(f.findPluginCredentialCard).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});

it.each([
  [new SourceControlCredentialDuplicateLabelError("This key label is already used."), "This key label is already used."],
  [new CredentialInputError("plain", "label"), "en: Put credentials in the secret field, not in this field."],
  [new Error("unhandled exception with submitted material"), "The person submitted the form but the token could not be saved; the form told them why. Nothing was saved."],
] as const)("returns only safe save-error copy and logs fixed metadata (%s)", async (error, message) => {
  const f = cardFixture();
  f.create.mockRejectedValueOnce(error);
  expect(await f.run()).toEqual({ saved: false, credentialId: null, provider: "forge", label: "Editorial copy", cancelled: false, message });
  expect(f.outcomes).toEqual([{ title: "Credential not saved", state: "failure", message }]);
  expect(f.reportCredentialFailure).toHaveBeenCalledExactlyOnceWith('{"toolId":"credential_save","exchangeId":"fixture-exchange","saved":false}');
  expect(await f.canonical.list({ workspaceId: "site" })).toEqual([]);
});

it("rejects overlong labels and undeclared providers before opening a credential card", async () => {
  const f = cardFixture();
  await expect(f.run({ ...confirmationInput, label: "x".repeat(201) })).rejects.toThrow(
    new ToolInputError({ message: "Credential label must be at most 200 characters." }),
  );
  expect(f.loadSourceControlProviders).not.toHaveBeenCalled();
  await expect(f.run({ ...confirmationInput, provider: "unknown" })).rejects.toThrow(
    new ToolInputError({ message: "No enabled source control provider declares this credential form. Call source_control_get_capabilities for available hosts." }),
  );
  expect(f.loadSourceControlProviders).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site" });
  expect(f.forms).toEqual([]);
  expect(f.create).not.toHaveBeenCalled();
});

it("guards vault mutations after abort while continuing to serve reads", async () => {
  const { deps, store, vault } = cardFixture();
  const abort = new AbortController();
  const repo = abortGuardedSourceControlRepo({ store, signal: abort.signal, deps: deps.deps });
  const row: VaultPutRecord = {
    id: "visible", workspaceId: "site", provider: "forge", ownerKey: "host", kind: "source-control", principalId: null,
    binding: null, sealed: { ciphertext: "sealing-test", nonce: "fixture", alg: "test", keyId: "key" }, label: "Initial",
    last4: null, tokenLength: null, revision: 1, isDefault: true, meta: { accountLabel: null },
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
  };
  const identity = { workspaceId: "site", id: "visible" };
  const query = { workspaceId: "site", provider: "forge", ownerKey: "host", kind: "source-control", principalId: null } as const;
  const guardedVault = repo.vault!;
  expect(await guardedVault.put({ record: row, expectedRevision: null })).toEqual(row);
  const known = { ...row, revision: 2, meta: { accountLabel: "Studio" } };
  expect(await guardedVault.patchMeta({
    ...identity, expectedRevision: 1, patch: { accountLabel: "Studio" }, updatedAt: row.updatedAt,
  })).toEqual(known);
  const disposable = { ...row, id: "disposable", label: "Second", isDefault: false };
  expect(await guardedVault.applyBatch!({ ops: [{ put: { record: disposable, expectedRevision: null } }] })).toEqual([disposable]);
  expect(await guardedVault.delete({ workspaceId: "site", id: "disposable", expectedRevision: 1 })).toBe(true);
  expect(await vault.find({ workspaceId: "site", id: "disposable" })).toBeNull();

  const abortReason = new Error("run ended");
  abort.abort(abortReason);
  const replacement = { ...known, revision: 3, label: "Must not land" };
  await expect(Promise.resolve().then(() => guardedVault.put({ record: replacement, expectedRevision: 2 }))).rejects.toBe(abortReason);
  await expect(Promise.resolve().then(() => guardedVault.applyBatch!({ ops: [{ delete: { ...identity, expectedRevision: 2 } }] }))).rejects.toBe(abortReason);
  await expect(Promise.resolve().then(() => repo.delete(identity))).rejects.toBe(abortReason);
  expect(await guardedVault.find(identity)).toEqual(known);
  expect(await guardedVault.findDefault!(query)).toEqual(known);
  expect(await guardedVault.findOne!({ workspaceId: "site", ownerKey: "host", kind: "source-control", principalId: null })).toEqual(known);
  expect(await guardedVault.list(query)).toEqual([known]);
  expect(await vault.find(identity)).toEqual(known);
});

it("forwards live legacy writes and blocks each one once the credential form is abandoned", async () => {
  const { deps, store } = cardFixture();
  const abort = new AbortController();
  const record: SourceControlCredentialSetRecord = {
    workspaceId: "site", id: "legacy", providerId: "forge", label: "Original", isDefault: true, accountLabel: null,
    createdAt: "2026-11-01", updatedAt: "2026-11-02", sealed: { ciphertext: "sealed", keyId: "k", nonce: "nonce", alg: "fake" },
  };
  const rows = new Map<string, typeof record>();
  const guarded = abortGuardedSourceControlRepo({
    store: { ...store,
      insert: async value => { rows.set(value.id, value); },
      update: async value => { rows.set(value.id, value); },
      delete: async ({ id }) => { rows.delete(id); },
      findById: async ({ id, workspaceId }) => workspaceId === "site" ? rows.get(id) ?? null : null,
      listByWorkspace: async ({ workspaceId }) => workspaceId === "site" ? [...rows.values()] : [],
      listByProvider: async ({ providerId, workspaceId }) => workspaceId === "site"
        ? [...rows.values()].filter(value => value.providerId === providerId) : [],
      findDefaultByProvider: async ({ providerId, workspaceId }) => workspaceId === "site"
        ? [...rows.values()].find(value => value.providerId === providerId && value.isDefault) ?? null : null,
      updateAccountLabel: async ({ id, accountLabel }) => {
        const value = rows.get(id);
        if (value) rows.set(id, { ...value, accountLabel });
      },
    }, signal: abort.signal, deps: deps.deps,
  });
  const identity = { workspaceId: "site", id: "legacy" };
  const scope = { workspaceId: "site", providerId: "forge" };
  await guarded.insert(record);
  await guarded.update({ ...record, label: "Renamed" });
  await guarded.updateAccountLabel!({ ...identity, accountLabel: "signed-in" });
  const expected = { ...record, label: "Renamed", accountLabel: "signed-in" };
  expect(await guarded.findById(identity)).toEqual(expected);
  const reason = new Error("form abandoned");
  abort.abort(reason);
  await expect(Promise.resolve().then(() => guarded.insert({ ...record, id: "extra" }))).rejects.toBe(reason);
  await expect(Promise.resolve().then(() => guarded.update({ ...record, label: "Must not land" }))).rejects.toBe(reason);
  await expect(Promise.resolve().then(() => guarded.updateAccountLabel!({ ...identity, accountLabel: "Must not land" }))).rejects.toBe(reason);
  await expect(Promise.resolve().then(() => guarded.delete(identity))).rejects.toBe(reason);
  expect(await guarded.listByProvider(scope)).toEqual([expected]);
  expect(await guarded.findDefaultByProvider(scope)).toEqual(expected);
  expect(await guarded.listByWorkspace({ workspaceId: "site" })).toEqual([expected]);
});

it("refuses canonical creation without a provider-owned create action", async () => {
  const { deps, store, canonical } = cardFixture();
  const { create: _create, ...readOnly } = canonical;
  const repo = abortGuardedSourceControlRepo({ store: { ...store, canonical: readOnly }, signal: new AbortController().signal, deps: deps.deps });
  expect(repo.canonical?.supports({ providerId: "forge" })).toBe(true);
  await expect(repo.canonical!.create!({ workspaceId: "site", connection: { providerId: "forge", token: "placeholder-token" } }))
    .rejects.toThrow(new ToolInputError({ message: "Open the provider API key card to save this key." }));
  expect(await canonical.list({ workspaceId: "site" })).toEqual([]);
});
