// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";

import { localizePublishTargets, localizeSourceControlProviders } from "../../../shell/lib/descriptor-i18n.js";
import type { AdminCustomCredentialSummary, AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlCredentialSummary } from "../../../source-control/api/source-control-api.types.js";
import { accessTokenDuplicateNameMessage, accessTokenMakeDefaultErrorMessage, accessTokenRemoveErrorMessage, accessTokenSaveErrorMessage } from "../../security-i18n.js";
import type { AccessTokenRow } from "../../access-token-rows.js";
import { useAccessTokens, type AccessTokensArgs } from "../hooks/use-access-tokens.hooks.js";

/**
 * @file Drives `access-token-add-actions.ts`, `access-token-replace-actions.ts` and `access-token-actions.ts` through the real
 * `useAccessTokens` assembly (real stores, drafts and row derivation) over a scripted port. The
 * injected deps are fakes with recognizable output, so each assertion names which collaborator ran.
 */

const publishCredential = (over: Partial<AdminPublishCredentialSummary> = {}): AdminPublishCredentialSummary => ({
  credentialType: "vendor", configured: true, accountLabel: null, id: "pub-1", providerId: "host", label: "Main host key",
  isDefault: true, maskedToken: "tail", updatedAt: "2026-01-01", createdAt: "2026-01-01", worksFor: ["host"], ...over,
} as AdminPublishCredentialSummary);

const customCredential = (over: Partial<AdminCustomCredentialSummary> = {}): AdminCustomCredentialSummary => ({
  credentialType: "custom", configured: true, id: "cus-1", label: "Example API", category: "general", baseUrl: "https://api.example.test",
  additionalHosts: [], worksFor: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", scope: "site", usedBy: ["a"], usedByThisSite: true, ...over,
} as AdminCustomCredentialSummary);

const sourceCredential = (over: Partial<AdminSourceControlCredentialSummary> = {}): AdminSourceControlCredentialSummary => ({
  configured: true, id: "src-1", providerId: "source", label: "Source key", isDefault: true, maskedToken: "tail",
  updatedAt: "2026-01-01", createdAt: "2026-01-01", ...over,
} as AdminSourceControlCredentialSummary);

const categories = [{ id: "all" as const, label: "All" }, { id: "hosting" as const, label: "Hosting" }];
const providerCopy = { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" };

function setup(options: { projectKeysAvailable?: boolean; custom?: AdminCustomCredentialSummary[] } = {}) {
  const port: AccessTokensArgs["port"] = {
    publish: {
      list: vi.fn(async () => ({ credentials: [publishCredential()], executionMode: "hosted-api-only" as const })),
      create: vi.fn(async (input) => publishCredential({ id: "pub-2", label: input.label, isDefault: false, worksFor: input.worksFor ?? [] })),
      update: vi.fn(async ({ id, input }) => publishCredential({ id, label: input.label ?? "Main host key", worksFor: input.worksFor ?? ["host"] })),
      remove: vi.fn(),
    },
    sourceControl: {
      list: vi.fn(async () => ({ credentials: [] })),
      create: vi.fn(async (input) => sourceCredential({ id: "src-2", label: input.label })),
      update: vi.fn(async ({ id }) => sourceCredential({ id })),
      remove: vi.fn(),
    },
    custom: {
      list: vi.fn(async () => ({ credentials: options.custom ?? [customCredential()], ...(options.projectKeysAvailable ? { projectKeysAvailable: true } : {}) })),
      create: vi.fn(async (input) => customCredential({ id: "cus-2", label: input.label, scope: input.scope })),
      update: vi.fn(async ({ id, input }) => {
        // The PUT answer carries no attachment snapshot; the hook must keep the inventory's own.
        const { usedBy: _usedBy, usedByThisSite: _usedByThisSite, ...metadata } = customCredential({ id, label: input.label ?? "Example API", username: "saved-user", worksFor: input.worksFor ?? [] });
        return metadata;
      }),
      remove: vi.fn(), useKey: vi.fn(),
    },
    publishTargets: { list: vi.fn(async () => [{ id: "host", label: "Host", configFields: [], credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true }] } }]) },
    sourceControlProviders: { list: vi.fn(async () => [{ id: "source", label: "Source" }]) },
  } as unknown as AccessTokensArgs["port"];
  const ready = { add: true, existing: true };
  const deps: AccessTokensArgs["deps"] = {
    ACCESS_TOKENS_RESOURCE: "credentials", ACCESS_TOKEN_CATEGORIES: categories, ACCESS_TOKEN_PROVIDER_COPY: providerCopy,
    LEGACY_SENTINEL_LABELS: { publish: "default", "source-control": "default" }, localizePublishTargets, localizeSourceControlProviders,
    sourceControlProviderInfoFromDescriptor: ({ descriptor }) => ({ id: descriptor.id, label: descriptor.label, tokenPageUrl: "", scopeGuidanceKey: "", fields: [] }),
    withPromotedDefault: vi.fn(),
    credentialDraftError: vi.fn(({ value }: { value: string }) => (value === "bad" ? "draft-error" : null)),
    describeApiError: ({ e, fallback }) => `${(e as Error).message}|${fallback}`,
    isApiError: (_error): _error is AdminHttpError => false,
    translateCredentialMessage: ({ message }) => message, requiredFieldsFilled: () => true,
    suggestCredentialWorksFor: vi.fn(({ label }: { label: string }) => [`suggested-for-${label}`]),
    buildCredentialConnectionInput: vi.fn(), buildSourceControlConnectionInput: vi.fn(),
    accessTokenExistingRowReadyToSave: () => ready.existing, accessTokenRowReadyToSave: () => ready.add,
    buildAccessTokenConnectionInput: vi.fn(({ fields }) => ({ token: fields.token }) as never),
    buildAccessTokenUpdatePatch: vi.fn(({ fields, nameChanged }) => (nameChanged ? { label: fields.name.trim() } : { connection: { token: fields.token } as never })),
    classifyAccessTokenSubmitError: () => ({ kind: "generic" }),
  };
  const hook = renderHook(() => useAccessTokens({ port, locale: "en", t: (key) => `t(${key})`, deps, hooks: { useFetchQuery, useSettlementGeneration, useContentRefreshSubscription: () => {} } }));
  return { port, deps, ready, ...hook };
}

type Hook = ReturnType<typeof setup>;
const rows = (hook: Hook): AccessTokenRow[] => (hook.result.current.groups ?? []).flatMap((group) => group.rows.map((state) => state.row));
const rowState = (hook: Hook, id: string) => (hook.result.current.groups ?? []).flatMap((group) => group.rows).find((state) => state.row.id === id);
const addForm = (hook: Hook, kind: string, providerId: string) =>
  (hook.result.current.groups ?? []).find((group) => group.info.kind === kind && group.info.providerId === providerId)?.addForm;
const requireRow = (hook: Hook, id: string): AccessTokenRow => {
  const found = rows(hook).find((row) => row.id === id);
  if (!found) throw new Error(`row ${id} not on screen`);
  return found;
};

async function loaded(options?: Parameters<typeof setup>[0]) {
  const hook = setup(options);
  await waitFor(() => expect(rows(hook).map((row) => row.id).sort()).toEqual((options?.custom ?? [customCredential()]).map((c) => c.id).concat("pub-1").sort()));
  await waitFor(() => expect(addForm(hook, "source-control", "source")).not.toBeUndefined());
  return hook;
}

const HOST = { kind: "publish" as const, providerId: "host" };
const SOURCE = { kind: "source-control" as const, providerId: "source" };

describe("access-token add actions", () => {
  it("opens, edits and closes a provider's add form, suggesting worksFor only for hosting providers", async () => {
    const hook = await loaded();
    act(() => hook.result.current.openAddForm(HOST));
    expect(addForm(hook, "publish", "host")?.visible).toBe(true);

    act(() => hook.result.current.setAddField(HOST, { name: "Deploy", token: "bad" }));
    expect(hook.deps.credentialDraftError).toHaveBeenCalledWith({ value: "bad" }, { locale: "en", required: true });
    expect(addForm(hook, "publish", "host")).toMatchObject({ name: "Deploy", token: "bad", error: "draft-error", worksFor: ["suggested-for-Deploy"] });

    act(() => hook.result.current.setAddField(SOURCE, { name: "Repo" }));
    expect(addForm(hook, "source-control", "source")).toMatchObject({ name: "Repo", worksFor: [] });

    act(() => hook.result.current.closeAddForm(HOST));
    expect(addForm(hook, "publish", "host")).toMatchObject({ visible: false, name: "", token: "", error: null });
  });

  it("refuses to create with a draft error, an unready form or a duplicate name, without calling the port", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(HOST, { name: "x", token: "bad" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    expect(addForm(hook, "publish", "host")?.error).toBe("draft-error");

    hook.ready.add = false;
    act(() => hook.result.current.setAddField(HOST, { token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    expect(addForm(hook, "publish", "host")?.error).toBeNull();

    hook.ready.add = true;
    act(() => hook.result.current.setAddField(HOST, { name: " main HOST key " }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    expect(addForm(hook, "publish", "host")?.error).toBe(accessTokenDuplicateNameMessage({ locale: "en", name: "main HOST key", provider: "Host" }));
    expect(hook.port.publish.create).not.toHaveBeenCalled();
  });

  it("creates a hosting token with the trimmed label and worksFor, adds the row and resets the form", async () => {
    const hook = await loaded();
    act(() => { hook.result.current.openAddForm(HOST); hook.result.current.setAddField(HOST, { name: " Second ", token: "tok-a" }); });
    await act(async () => { await hook.result.current.createToken(HOST); });
    expect(hook.port.publish.create).toHaveBeenCalledWith({ label: "Second", connection: { token: "tok-a" }, worksFor: ["suggested-for- Second "] });
    expect(requireRow(hook, "pub-2").name).toBe("Second");
    expect(addForm(hook, "publish", "host")).toMatchObject({ visible: false, name: "", saving: false, error: null });
  });

  it("creates a source-control token without a worksFor field", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(SOURCE, { name: "Repo", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(SOURCE); });
    expect(hook.port.sourceControl.create).toHaveBeenCalledWith({ label: "Repo", connection: { token: "tok-a" } });
    expect(requireRow(hook, "src-2").name).toBe("Repo");
  });

  it("shows the save-error sentence when the create call fails, keeping the draft", async () => {
    const hook = await loaded();
    vi.mocked(hook.port.publish.create).mockRejectedValueOnce(new Error("rejected"));
    act(() => hook.result.current.setAddField(HOST, { name: "Second", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    expect(addForm(hook, "publish", "host")).toMatchObject({
      name: "Second", saving: false, error: accessTokenSaveErrorMessage({ locale: "en", error: "rejected|t(unknown error)" }),
    });
  });

  it("edits and resets the custom add form, with token validation and worksFor suggestion", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setCustomAddField({ name: "Mail", token: "bad" }));
    expect(hook.result.current.customAddForm).toMatchObject({ name: "Mail", token: "bad", error: "draft-error", worksFor: ["suggested-for-Mail"] });
    act(() => hook.result.current.resetCustomAddForm());
    expect(hook.result.current.customAddForm).toMatchObject({ name: "", token: "", error: null, saving: false, worksFor: [] });
  });

  it("returns false without saving for a draft error, an incomplete form or a name taken in the same scope", async () => {
    const hook = await loaded();
    let saved = true;
    act(() => hook.result.current.setCustomAddField({ name: "Mail", token: "bad", baseUrl: "https://mail.example.test" }));
    await act(async () => { saved = await hook.result.current.createCustomCredential(); });
    expect(saved).toBe(false);
    expect(hook.result.current.customAddForm.error).toBe("draft-error");

    act(() => hook.result.current.setCustomAddField({ token: "tok-a", baseUrl: "not a url" }));
    await act(async () => { saved = await hook.result.current.createCustomCredential(); });
    expect(saved).toBe(false);

    act(() => hook.result.current.setCustomAddField({ name: " example api ", baseUrl: "https://mail.example.test" }));
    await act(async () => { saved = await hook.result.current.createCustomCredential(); });
    expect(saved).toBe(false);
    expect(hook.result.current.customAddForm.error).toBe(accessTokenDuplicateNameMessage({ locale: "en", name: "example api", provider: "t(this workspace)" }));
    expect(hook.port.custom.create).not.toHaveBeenCalled();
  });

  it("creates a site-scoped custom credential with trimmed fields and resets the form", async () => {
    const hook = await loaded();
    let saved = false;
    act(() => hook.result.current.setCustomAddField({ name: " Mail ", token: "tok-a", username: " me ", baseUrl: " https://mail.example.test ", additionalHosts: "https://cdn.example.test" }));
    await act(async () => { saved = await hook.result.current.createCustomCredential(); });
    expect(saved).toBe(true);
    expect(hook.port.custom.create).toHaveBeenCalledWith({
      scope: "site", label: "Mail", category: "general", baseUrl: "https://mail.example.test",
      connection: { token: "tok-a", username: "me" }, worksFor: ["suggested-for- Mail "], additionalHosts: ["https://cdn.example.test"],
    });
    expect(requireRow(hook, "cus-2").name).toBe("Mail");
    expect(hook.result.current.customAddForm).toMatchObject({ name: "", token: "", saving: false, error: null });
  });

  it("creates in the project scope when project keys are available, and reports a failed create", async () => {
    const hook = await loaded({ projectKeysAvailable: true });
    await waitFor(() => expect(hook.result.current.projectKeysAvailable).toBe(true));
    vi.mocked(hook.port.custom.create).mockRejectedValueOnce(new Error("quota"));
    let saved = true;
    // The site-scoped "Example API" row does not block the same name in the project scope.
    act(() => hook.result.current.setCustomAddField({ name: "Example API", token: "tok-a", baseUrl: "https://mail.example.test" }));
    await act(async () => { saved = await hook.result.current.createCustomCredential(); });
    expect(saved).toBe(false);
    expect(vi.mocked(hook.port.custom.create).mock.calls[0]?.[0]).toMatchObject({ scope: "project", label: "Example API" });
    expect(hook.result.current.customAddForm).toMatchObject({ saving: false, error: accessTokenSaveErrorMessage({ locale: "en", error: "quota|t(unknown error)" }) });
  });
});

describe("access-token replace actions", () => {
  it("guards a hosting replace on draft error, readiness and a duplicate sibling name", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setExistingField({ rowId: "pub-1", patch: { token: "bad" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "pub-1")); });
    expect(rowState(hook, "pub-1")?.error).toBe("draft-error");

    hook.ready.existing = false;
    act(() => hook.result.current.setExistingField({ rowId: "pub-1", patch: { token: "tok-a" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "pub-1")); });
    expect(rowState(hook, "pub-1")?.saving).toBe(false);

    hook.ready.existing = true;
    act(() => hook.result.current.setAddField(HOST, { name: "Second", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    act(() => hook.result.current.setExistingField({ rowId: "pub-1", patch: { name: "second" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "pub-1")); });
    expect(rowState(hook, "pub-1")?.error).toBe(accessTokenDuplicateNameMessage({ locale: "en", name: "second", provider: "Host" }));
    expect(hook.port.publish.update).not.toHaveBeenCalled();
  });

  it("renames a hosting token through the injected patch builder and reseeds the draft from the saved row", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setExistingField({ rowId: "pub-1", patch: { name: " Renamed " } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "pub-1")); });
    expect(hook.deps.buildAccessTokenUpdatePatch).toHaveBeenCalledWith(expect.objectContaining({ nameChanged: true, hasToken: false }), { currentWorksFor: ["host"] });
    expect(hook.port.publish.update).toHaveBeenCalledWith({ id: "pub-1", input: { label: "Renamed" } });
    expect(rowState(hook, "pub-1")).toMatchObject({ name: "Renamed", token: "", saving: false, error: null, worksFor: ["host"] });
    expect(requireRow(hook, "pub-1").name).toBe("Renamed");
  });

  it("replaces a source-control token (no worksFor on the result) and reports a failed hosting replace", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(SOURCE, { name: "Repo", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(SOURCE); });
    act(() => hook.result.current.setExistingField({ rowId: "src-2", patch: { token: "tok-b" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "src-2")); });
    expect(hook.port.sourceControl.update).toHaveBeenCalledWith({ id: "src-2", input: { connection: { token: "tok-b" } } });
    expect(rowState(hook, "src-2")).toMatchObject({ token: "", worksFor: [], error: null });

    vi.mocked(hook.port.publish.update).mockRejectedValueOnce(new Error("expired"));
    act(() => hook.result.current.setExistingField({ rowId: "pub-1", patch: { token: "tok-c" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "pub-1")); });
    expect(rowState(hook, "pub-1")).toMatchObject({ saving: false, token: "tok-c", error: accessTokenSaveErrorMessage({ locale: "en", error: "expired|t(unknown error)" }) });
  });

  it("guards a custom replace on draft error, readiness and a same-scope duplicate", async () => {
    const hook = await loaded({ custom: [customCredential(), customCredential({ id: "cus-9", label: "Other API" })] });
    act(() => hook.result.current.setExistingField({ rowId: "cus-1", patch: { token: "bad" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "cus-1")); });
    expect(rowState(hook, "cus-1")?.error).toBe("draft-error");

    hook.ready.existing = false;
    act(() => hook.result.current.setExistingField({ rowId: "cus-1", patch: { token: "tok-a" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "cus-1")); });

    hook.ready.existing = true;
    act(() => hook.result.current.setExistingField({ rowId: "cus-1", patch: { name: "other api" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "cus-1")); });
    expect(rowState(hook, "cus-1")?.error).toBe(accessTokenDuplicateNameMessage({ locale: "en", name: "other api", provider: "t(this workspace)" }));
    expect(hook.port.custom.update).not.toHaveBeenCalled();
  });

  it("replaces a custom credential, keeping the inventory's usage facts and reseeding the saved username", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setExistingField({ rowId: "cus-1", patch: { name: " Example API v2 ", token: "tok-a" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "cus-1")); });
    expect(hook.port.custom.update).toHaveBeenCalledWith({ id: "cus-1", input: { label: "Example API v2", connection: { token: "tok-a" } } });
    expect(rowState(hook, "cus-1")).toMatchObject({ name: "Example API v2", username: "saved-user", token: "", saving: false, error: null });
    const replaced = requireRow(hook, "cus-1");
    expect(replaced.name).toBe("Example API v2");
    expect(replaced.usedByThisSite).toBe(true);
  });

  it("reports a failed custom replace with the save-error sentence", async () => {
    const hook = await loaded();
    vi.mocked(hook.port.custom.update).mockRejectedValueOnce(new Error("denied"));
    act(() => hook.result.current.setExistingField({ rowId: "cus-1", patch: { token: "tok-a" } }));
    await act(async () => { await hook.result.current.replaceToken(requireRow(hook, "cus-1")); });
    expect(rowState(hook, "cus-1")).toMatchObject({ saving: false, error: accessTokenSaveErrorMessage({ locale: "en", error: "denied|t(unknown error)" }) });
  });
});

/** Mirrors `withPromotedDefault`'s contract: the promoted row becomes the single default. */
const promote = ({ credentials, promoted }: { credentials: { id: string; isDefault: boolean }[]; promoted: { id: string } }) =>
  credentials.map((credential) => ({ ...credential, isDefault: credential.id === promoted.id }));

describe("access-token remove, make-default and custom-key actions", () => {
  it("removes a custom credential and re-reads the custom inventory", async () => {
    const hook = await loaded({ custom: [customCredential(), customCredential({ id: "cus-9", label: "Other API" })] });
    vi.mocked(hook.port.custom.list).mockResolvedValue({ credentials: [customCredential({ id: "cus-9", label: "Other API" })] } as never);
    await act(async () => { await hook.result.current.removeToken(requireRow(hook, "cus-1")); });
    expect(hook.port.custom.remove).toHaveBeenCalledWith({ id: "cus-1" });
    expect(rows(hook).map((row) => row.id).sort()).toEqual(["cus-9", "pub-1"]);
    expect(rowState(hook, "cus-9")).toMatchObject({ saving: false, error: null });
  });

  it("removes a hosting token through the publish port and a source token through the source-control port", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(SOURCE, { name: "Repo", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(SOURCE); });
    vi.mocked(hook.port.publish.list).mockResolvedValue({ credentials: [], executionMode: "hosted-api-only" } as never);
    await act(async () => { await hook.result.current.removeToken(requireRow(hook, "pub-1")); });
    expect(hook.port.publish.remove).toHaveBeenCalledWith({ id: "pub-1" });
    expect(rows(hook).map((row) => row.id)).not.toContain("pub-1");

    await act(async () => { await hook.result.current.removeToken(requireRow(hook, "src-2")); });
    expect(hook.port.sourceControl.remove).toHaveBeenCalledWith({ id: "src-2" });
    expect(hook.port.publish.remove).toHaveBeenCalledTimes(1);
    expect(rows(hook).map((row) => row.id)).toEqual(["cus-1"]);
  });

  it("keeps the row and shows the remove-error sentence when the remove call fails", async () => {
    const hook = await loaded();
    vi.mocked(hook.port.publish.remove).mockRejectedValueOnce(new Error("forbidden"));
    await act(async () => { await hook.result.current.removeToken(requireRow(hook, "pub-1")); });
    expect(rowState(hook, "pub-1")).toMatchObject({
      saving: false, error: accessTokenRemoveErrorMessage({ locale: "en", error: "forbidden|t(unknown error)" }),
    });
  });

  it("does nothing when asked to make the current default the default", async () => {
    const hook = await loaded();
    await act(async () => { await hook.result.current.makeDefault(requireRow(hook, "pub-1")); });
    expect(hook.port.publish.update).not.toHaveBeenCalled();
    expect(rowState(hook, "pub-1")).toMatchObject({ saving: false, error: null });
  });

  it("promotes a hosting token from the server's answer and then adopts the re-read list", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(HOST, { name: "Second", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    vi.mocked(hook.deps.withPromotedDefault).mockImplementation(promote as never);
    const reread = [publishCredential({ isDefault: false }), publishCredential({ id: "pub-2", label: "Second", isDefault: true, worksFor: [] })];
    vi.mocked(hook.port.publish.list).mockResolvedValue({ credentials: reread, executionMode: "hosted-api-only" } as never);
    await act(async () => { await hook.result.current.makeDefault(requireRow(hook, "pub-2")); });
    expect(hook.port.publish.update).toHaveBeenCalledWith({ id: "pub-2", input: { isDefault: true } });
    expect(hook.deps.withPromotedDefault).toHaveBeenCalledWith(expect.objectContaining({ promoted: expect.objectContaining({ id: "pub-2" }) }));
    expect(requireRow(hook, "pub-2").isDefault).toBe(true);
    expect(requireRow(hook, "pub-1").isDefault).toBe(false);
    expect(rowState(hook, "pub-2")).toMatchObject({ saving: false, error: null });
  });

  it("keeps the confirmed promotion on screen when only the reconcile re-read fails", async () => {
    const hook = await loaded();
    vi.mocked(hook.port.sourceControl.create).mockResolvedValueOnce(sourceCredential({ id: "src-3", label: "Repo", isDefault: false }));
    act(() => hook.result.current.setAddField(SOURCE, { name: "Repo", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(SOURCE); });
    vi.mocked(hook.deps.withPromotedDefault).mockImplementation(promote as never);
    vi.mocked(hook.port.sourceControl.list).mockRejectedValue(new Error("offline"));
    await act(async () => { await hook.result.current.makeDefault(requireRow(hook, "src-3")); });
    expect(hook.port.sourceControl.update).toHaveBeenCalledWith({ id: "src-3", input: { isDefault: true } });
    expect(requireRow(hook, "src-3").isDefault).toBe(true);
    expect(rowState(hook, "src-3")).toMatchObject({ saving: false, error: null });
  });

  it("shows the make-default error sentence when the promotion itself is rejected", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setAddField(HOST, { name: "Second", token: "tok-a" }));
    await act(async () => { await hook.result.current.createToken(HOST); });
    vi.mocked(hook.port.publish.update).mockRejectedValueOnce(new Error("conflict"));
    await act(async () => { await hook.result.current.makeDefault(requireRow(hook, "pub-2")); });
    expect(hook.deps.withPromotedDefault).not.toHaveBeenCalled();
    expect(requireRow(hook, "pub-2").isDefault).toBe(false);
    expect(rowState(hook, "pub-2")).toMatchObject({
      saving: false, error: accessTokenMakeDefaultErrorMessage({ locale: "en", error: "conflict|t(unknown error)" }),
    });
  });

  it("attaches a project key once per pending click, reloads every store and clears the busy state", async () => {
    const hook = await loaded({ custom: [customCredential({ scope: "project", id: "cus-p" })], projectKeysAvailable: true });
    let release: () => void = () => {};
    vi.mocked(hook.port.custom.useKey).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }) as never);
    const listCalls = vi.mocked(hook.port.publish.list).mock.calls.length;
    let first: Promise<void> = Promise.resolve();
    act(() => { first = hook.result.current.setCustomKeyUse({ row: requireRow(hook, "cus-p"), use: true }); });
    expect(hook.result.current.customKeyBusy["cus-p"]).toEqual({ saving: true, error: null });
    await act(async () => { await hook.result.current.setCustomKeyUse({ row: requireRow(hook, "cus-p"), use: true }); });
    expect(hook.port.custom.useKey).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await first; });
    expect(hook.port.custom.useKey).toHaveBeenCalledWith({ keyId: "cus-p", use: true });
    expect(vi.mocked(hook.port.publish.list).mock.calls.length).toBeGreaterThan(listCalls);
    expect(hook.result.current.customKeyBusy["cus-p"]).toEqual({ saving: false, error: null });
  });

  it("ignores site-scoped keys, and reports a failed detach so a retry can run", async () => {
    const hook = await loaded({ custom: [customCredential(), customCredential({ scope: "project", id: "cus-p", label: "Project API" })], projectKeysAvailable: true });
    await act(async () => { await hook.result.current.setCustomKeyUse({ row: requireRow(hook, "cus-1"), use: false }); });
    expect(hook.port.custom.useKey).not.toHaveBeenCalled();
    expect(hook.result.current.customKeyBusy["cus-1"]).toBeUndefined();

    vi.mocked(hook.port.custom.useKey).mockRejectedValueOnce(new Error("locked"));
    await act(async () => { await hook.result.current.setCustomKeyUse({ row: requireRow(hook, "cus-p"), use: false }); });
    expect(hook.result.current.customKeyBusy["cus-p"]).toEqual({ saving: false, error: "locked|t(unknown error)" });
    await act(async () => { await hook.result.current.setCustomKeyUse({ row: requireRow(hook, "cus-p"), use: false }); });
    expect(hook.port.custom.useKey).toHaveBeenNthCalledWith(2, { keyId: "cus-p", use: false });
    expect(hook.result.current.customKeyBusy["cus-p"]).toEqual({ saving: false, error: null });
  });
});
