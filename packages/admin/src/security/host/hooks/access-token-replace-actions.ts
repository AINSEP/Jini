import { customCredentialReplaceReadyToSave, accessTokenWorksForChanged, buildCustomCredentialUpdatePatch, customCredentialNameTaken } from "../../custom-credential-forms.js";
import { accessTokenDuplicateNameMessage } from "../../security-i18n.js";
import { accessTokenNameTaken, type AccessTokenRow, type AccessTokenProviderRef } from "../../access-token-rows.js";
import { type AccessTokenFormFields as CredentialAccessTokenFormFields, accessTokenProviderInfo, accessTokenRowProviderInfo } from "../../access-token-providers.js";
import type { AccessTokenActionContext } from "./access-token-actions.js";
import { blankDraft, existingTokenDraft, IDLE } from "./access-token-state.hooks.js";
import { writeCredential, accessTokenSubmitErrorMessage } from "./access-token-store-operations.js";
import { mergeCredential } from "./access-token-actions.js";

  /** {@link replaceToken}'s `kind: "custom"` branch — a custom row has no `CredentialAccessTokenFormFields`
   *  shape to build (no `ref`-keyed catalog lookup, no descriptor `values`), so it reuses only what genuinely
   *  applies: {@link customCredentialReplaceReadyToSave}'s readiness rule (rename-alone, username-alone,
   *  or either together is ready, same as a new token — see that function's own doc for why this is
   *  NOT {@link accessTokenReplaceReadyToSave}) and {@link customCredentialNameTaken}'s workspace-wide
   *  duplicate check (see that function's own doc for why it is NOT {@link accessTokenNameTaken}).
   *  Split out purely to keep {@link replaceToken} itself under this repo's complexity gate. */
async function replaceCustomCredential({ context, row }: { context: AccessTokenActionContext; row: AccessTokenRow }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { credentialDraftError, requiredFieldsFilled, accessTokenExistingRowReadyToSave, ACCESS_TOKEN_PROVIDER_COPY } = deps;
  const { providers } = context.queries;
  const { setCustomCredentials } = context.stores;
  const { existingDrafts, setExistingDrafts, setExistingBusy } = context.drafts;
  const { rows } = context;
    const draft = existingTokenDraft({ row, draft: existingDrafts[row.id] });
    const fields: CredentialAccessTokenFormFields = { ref: { kind: "custom", providerId: row.providerId }, ...draft };
    const error = credentialDraftError({ value: fields.token }, { locale });
    if (error) { setExistingBusy(prev => ({ ...prev, [row.id]: { saving: false, error } })); return; }
    if (!accessTokenExistingRowReadyToSave({ deps: { requiredFieldsFilled, accessTokenWorksForChanged, customCredentialReplaceReadyToSave }, SOURCE_CONTROL: "source-control", fields, row, info: accessTokenRowProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, row }) })) return;
    if (customCredentialNameTaken({ rows: (rows ?? []).filter(candidate => candidate.scope === row.scope), name: fields.name }, { excludeId: row.id })) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenDuplicateNameMessage({ locale, name: fields.name.trim(), provider: t("this workspace") }) } }));
      return;
    }
    setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: true, error: null } }));
    const nameChanged = fields.name.trim() !== row.name.trim();
    const hasToken = fields.token.trim() !== "";
    try {
      const result = await port.custom.update({ id: row.id, input: buildCustomCredentialUpdatePatch({ fields, nameChanged, hasToken, currentUsername: row.username }, { currentWorksFor: row.worksFor }) });
      // PUT returns credential metadata; retain the latest attachment snapshot from the inventory.
      setCustomCredentials(prev => ({ status: "ok", rows: (prev.rows ?? []).map(item => item.id === result.id
        ? { ...result, usedBy: item.usedBy, usedByThisSite: item.usedByThisSite } : item) }));
      // Reset to `result.username`, not `fields.username` or blank — `result` is the server's own
      // post-write state, so it is correct whether the operator typed a new username, left it blank
      // to PRESERVE the one already saved (`buildCustomProviderConnectionInput` omits a blank
      // username from the payload rather than sending `""` — see this file's own header), or this
      // save carried no `connection` at all (a rename-only patch). Seeding from `fields.username`
      // instead would show a stale value whenever the omit-to-preserve path fired; seeding blank
      // would resurrect the exact "saved username reads as empty" bug this file exists to fix.
      setExistingDrafts((prev) => ({ ...prev, [row.id]: { ...blankDraft(), name: fields.name.trim(), username: result.username ?? "", worksFor: result.worksFor } }));
      setExistingBusy((prev) => ({ ...prev, [row.id]: IDLE }));
    } catch (err) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenSubmitErrorMessage({ deps, err, t, locale, providerLabel: t("this workspace"), attemptedName: fields.name }) } }));
    }
  }

export async function replaceToken({ context, row }: { context: AccessTokenActionContext; row: AccessTokenRow }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { credentialDraftError, requiredFieldsFilled, accessTokenExistingRowReadyToSave, buildCredentialConnectionInput, buildSourceControlConnectionInput, buildAccessTokenUpdatePatch, ACCESS_TOKEN_PROVIDER_COPY } = deps;
  const { providers } = context.queries;
  const { existingDrafts, setExistingDrafts, setExistingBusy } = context.drafts;
  const { rows } = context;
    if (row.kind === "custom") {
      await replaceCustomCredential({ context, row: row });
      return;
    }
    const ref: AccessTokenProviderRef = { kind: row.kind, providerId: row.providerId };
    // `row.username` is always undefined here (it is only ever set for `kind: "custom"` rows — see
    // AccessTokenRow.username's own doc), so this is a no-op today. Kept for symmetry with
    // replaceCustomCredential's identical fallback, so a future publish/source-control provider that
    // grows a saved username inherits the correct prefill automatically instead of silently reading
    // blank the same way custom rows used to.
    const draft = existingTokenDraft({ row, draft: existingDrafts[row.id] });
    const fields: CredentialAccessTokenFormFields = { ref, ...draft };
    const info = accessTokenProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, ref });
    const error = credentialDraftError({ value: fields.token }, { locale });
    if (error) { setExistingBusy(prev => ({ ...prev, [row.id]: { saving: false, error } })); return; }
    if (!accessTokenExistingRowReadyToSave({ deps: { requiredFieldsFilled, accessTokenWorksForChanged, customCredentialReplaceReadyToSave }, SOURCE_CONTROL: "source-control", fields, row, info })) return;
    const providerLabel = info.label;
    if (accessTokenNameTaken({ rows: rows ?? [], ref, name: fields.name }, { excludeId: row.id })) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenDuplicateNameMessage({ locale, name: fields.name.trim(), provider: providerLabel }) } }));
      return;
    }
    setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: true, error: null } }));
    const nameChanged = fields.name.trim() !== row.name.trim();
    const hasToken = fields.token.trim() !== "";
    try {
      const patch = buildAccessTokenUpdatePatch({ deps: { buildCredentialConnectionInput, buildSourceControlConnectionInput, accessTokenWorksForChanged }, fields, nameChanged, hasToken, info }, { currentWorksFor: row.worksFor });
      const result = await writeCredential({ port, kind: row.kind, mode: { type: "update", id: row.id }, patch });
      mergeCredential({ context, kind: row.kind, result, isNew: false });
      // Same symmetry note as this function's draft fallback above: `result` (a publish/source-control
      // summary) never carries a `username` fact, so `row.username ?? ""` — not `result.username` —
      // is the only value available, and it is always "" today for these two kinds.
      setExistingDrafts((prev) => ({ ...prev, [row.id]: { ...blankDraft(), name: fields.name.trim(), username: row.username ?? "", worksFor: "worksFor" in result ? result.worksFor : [] } }));
      setExistingBusy((prev) => ({ ...prev, [row.id]: IDLE }));
    } catch (err) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenSubmitErrorMessage({ deps, err, t, locale, providerLabel, attemptedName: fields.name }) } }));
    }
  }

