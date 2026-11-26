import { buildAdditionalHostsInput, buildCustomProviderConnectionInput, customCredentialNameTaken, customCredentialReadyToSave, type CustomCredentialFormFields } from "../../custom-credential-forms.js";
import { accessTokenDuplicateNameMessage } from "../../security-i18n.js";
import { accessTokenNameTaken, type AccessTokenProviderRef } from "../../access-token-rows.js";
import { type AccessTokenFormFields as CredentialAccessTokenFormFields, accessTokenProviderInfo } from "../../access-token-providers.js";
import type { DraftFields, CustomDraftFields } from "./use-access-tokens.hooks.js";
import type { AccessTokenActionContext } from "./access-token-actions.js";
import { blankAddFormEntry, blankCustomDraft, addWorksForPatch, addFormKey, IDLE } from "./access-token-state.hooks.js";
import { writeCredential, mergeRaw, accessTokenSubmitErrorMessage } from "./access-token-store-operations.js";
import { mergeCredential } from "./access-token-actions.js";

export function openAddForm({ context, ref }: { context: AccessTokenActionContext; ref: AccessTokenProviderRef }, _optional: Record<string, never> = {}): void {
  const { setAddForms } = context.drafts;
    const key = addFormKey(ref);
    setAddForms((prev) => ({ ...prev, [key]: { ...(prev[key] ?? blankAddFormEntry()), visible: true } }));
  }

export function closeAddForm({ context, ref }: { context: AccessTokenActionContext; ref: AccessTokenProviderRef }, _optional: Record<string, never> = {}): void {
  const { setAddForms } = context.drafts;
    setAddForms((prev) => ({ ...prev, [addFormKey(ref)]: blankAddFormEntry() }));
  }

export function setAddField({ context, ref, patch }: { context: AccessTokenActionContext; ref: AccessTokenProviderRef; patch: Partial<DraftFields> }, _optional: Record<string, never> = {}): void {
  const deps = context.args.deps;
  const { locale } = context.args;
  const { credentialDraftError } = deps;
  const { worksForOptions } = context.queries;
  const { setAddForms } = context.drafts;
    const key = addFormKey(ref);
    const token = patch.token;
    if (token !== undefined) setAddForms(prev => ({ ...prev, [key]: { ...(prev[key] ?? blankAddFormEntry()), error: credentialDraftError({ value: token }, { locale, required: true }) } }));
    setAddForms((prev) => {
      const entry = prev[key] ?? blankAddFormEntry();
      const compatibility = ref.kind === "publish" ? addWorksForPatch({ deps, draft: entry.draft, patch, options: worksForOptions }) : {};
      return { ...prev, [key]: { ...entry, draft: { ...entry.draft, ...patch, ...compatibility } } };
    });
  }

export async function createToken({ context, ref }: { context: AccessTokenActionContext; ref: AccessTokenProviderRef }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { credentialDraftError, requiredFieldsFilled, accessTokenRowReadyToSave, buildCredentialConnectionInput, buildSourceControlConnectionInput, buildAccessTokenConnectionInput, ACCESS_TOKEN_PROVIDER_COPY } = deps;
  const { providers } = context.queries;
  const { addForms, setAddForms } = context.drafts;
  const { rows } = context;
    const key = addFormKey(ref);
    const entry = addForms[key] ?? blankAddFormEntry();
    const fields: CredentialAccessTokenFormFields = { ref, ...entry.draft };
    const info = accessTokenProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, ref });
    const error = credentialDraftError({ value: fields.token }, { locale, required: true });
    if (error) { setAddForms(prev => ({ ...prev, [key]: { ...entry, saving: false, error } })); return; }
    if (!accessTokenRowReadyToSave({ deps: { requiredFieldsFilled }, fields, info })) return;
    const providerLabel = info.label;
    if (accessTokenNameTaken({ rows: rows ?? [], ref, name: fields.name })) {
      setAddForms((prev) => ({ ...prev, [key]: { ...entry, error: accessTokenDuplicateNameMessage({ locale, name: fields.name.trim(), provider: providerLabel }) } }));
      return;
    }
    setAddForms((prev) => ({ ...prev, [key]: { ...entry, saving: true, error: null } }));
    try {
      const connection = buildAccessTokenConnectionInput({ deps: { buildCredentialConnectionInput, buildSourceControlConnectionInput }, fields, info });
      const result = await writeCredential({ port, kind: ref.kind, mode: { type: "create", label: fields.name.trim() }, patch: { connection, ...(ref.kind === "publish" ? { worksFor: fields.worksFor } : {}) } });
      mergeCredential({ context, kind: ref.kind, result, isNew: true });
      setAddForms((prev) => ({ ...prev, [key]: blankAddFormEntry() }));
    } catch (err) {
      setAddForms((prev) => ({
        ...prev,
        [key]: { ...entry, saving: false, error: accessTokenSubmitErrorMessage({ deps, err, t, locale, providerLabel, attemptedName: fields.name }) },
      }));
    }
  }

export function setCustomAddField({ context, patch }: { context: AccessTokenActionContext; patch: Partial<CustomDraftFields> }, _optional: Record<string, never> = {}): void {
  const deps = context.args.deps;
  const { locale } = context.args;
  const { credentialDraftError } = deps;
  const { worksForOptions } = context.queries;
  const { setCustomAddDraft, setCustomAddBusy } = context.drafts;
    const token = patch.token;
    if (token !== undefined) setCustomAddBusy(prev => ({ ...prev, error: credentialDraftError({ value: token }, { locale, required: true }) }));
    setCustomAddDraft((prev) => ({ ...prev, ...patch, ...addWorksForPatch({ deps, draft: prev, patch, options: worksForOptions }) }));
  }

export function resetCustomAddForm({ context }: { context: AccessTokenActionContext }, _optional: Record<string, never> = {}): void {
  const { setCustomAddDraft, setCustomAddBusy } = context.drafts;
    setCustomAddDraft(blankCustomDraft());
    setCustomAddBusy(IDLE);
  }

  /** Returns whether the save succeeded — `AccessTokensTab.tsx`'s dialog uses this to decide whether
   *  to close itself (native `<dialog>` close is a DOM action this hook does not own, same split
   *  {@link RemoveConfirmDialog} already draws). */
export async function createCustomCredential({ context }: { context: AccessTokenActionContext }, _optional: Record<string, never> = {}): Promise<boolean> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { credentialDraftError } = deps;
  const { customQuery } = context.queries;
  const { setCustomCredentials } = context.stores;
  const { customAddDraft, setCustomAddBusy } = context.drafts;
  const { rows } = context;
    const fields: CustomCredentialFormFields = customAddDraft;
    const scope = customQuery.data?.projectKeysAvailable ? "project" : "site";
    const error = credentialDraftError({ value: fields.token }, { locale, required: true });
    if (error) { setCustomAddBusy({ saving: false, error }); return false; }
    if (!customCredentialReadyToSave(fields)) return false;
    if (customCredentialNameTaken({ rows: (rows ?? []).filter(row => (row.scope ?? "site") === scope), name: fields.name })) {
      setCustomAddBusy({ saving: false, error: accessTokenDuplicateNameMessage({ locale, name: fields.name.trim(), provider: t("this workspace") }) });
      return false;
    }
    setCustomAddBusy({ saving: true, error: null });
    try {
      const result = await port.custom.create({
        scope,
        label: fields.name.trim(),
        worksFor: fields.worksFor,
        category: fields.category,
        baseUrl: fields.baseUrl.trim(),
        additionalHosts: buildAdditionalHostsInput({ raw: fields.additionalHosts }),
        connection: buildCustomProviderConnectionInput(fields),
      });
      setCustomCredentials((prev) => ({ status: "ok", rows: mergeRaw({ list: prev.rows ?? [], result, isNew: true }) }));
      resetCustomAddForm({ context });
      return true;
    } catch (err) {
      setCustomAddBusy({ saving: false, error: accessTokenSubmitErrorMessage({ deps, err, t, locale, providerLabel: t("this workspace"), attemptedName: fields.name }) });
      return false;
    }
  }

