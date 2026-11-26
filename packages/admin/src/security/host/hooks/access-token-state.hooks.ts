import { customCredentialReplaceReadyToSave, accessTokenWorksForChanged } from "../../custom-credential-forms.js";
import { type AccessTokenRow, type AccessTokenProviderRef } from "../../access-token-rows.js";
import { type AccessTokenProviderInfo } from "../../access-token-providers.js";
import type { AccessTokensDependencies, DraftFields, BusyState, AddFormEntry, CustomDraftFields, AccessTokenExistingRowState, AccessTokenAddFormState } from "./use-access-tokens.hooks.js";

export const IDLE: BusyState = { saving: false, error: null };

export function blankDraft(): DraftFields {
  return { name: "", token: "", values: {}, username: "", worksFor: [] };
}

/** Seed a row's editable metadata while keeping its secret input blank. */
export function existingTokenDraft({ row, draft }: { row: AccessTokenRow; draft: DraftFields | undefined }): DraftFields {
  return draft ?? { ...blankDraft(), name: row.name, username: row.username ?? "", worksFor: row.worksFor ?? [] };
}

export function blankAddFormEntry(): AddFormEntry {
  return { visible: false, draft: blankDraft(), saving: false, error: null };
}

export function blankCustomDraft(): CustomDraftFields {
  return { name: "", category: "general", baseUrl: "", additionalHosts: "", token: "", username: "", worksFor: [] };
}

/** Create-only form metadata: let Jini suggest exact option ids until the user selects or clears.
 * Returns a draft patch without I/O or mutation. O(options) time/space on a label change.
 */
export function addWorksForPatch({ draft, patch, options, deps }: {
  deps: AccessTokensDependencies;
  draft: Pick<DraftFields, "worksFor" | "worksForEdited">;
  patch: Partial<Pick<DraftFields, "name" | "worksFor">>;
  options: { value: string; label: string }[];
}, _options = {}) {
  const { suggestCredentialWorksFor } = deps;
  const worksForEdited = draft.worksForEdited || patch.worksFor !== undefined;
  const worksFor = !worksForEdited && patch.name !== undefined
    ? suggestCredentialWorksFor({ label: patch.name, providers: options.map(option => ({ id: option.value, vendorId: option.value })) })
    : patch.worksFor ?? draft.worksFor;
  return { worksFor, worksForEdited };
}

/** The `addForms`/`existingDrafts` map key for one provider — a plain string join rather than a
 *  nested `Record<kind, Record<providerId, ...>>`, since every lookup already has both parts
 *  available and a flat map avoids an extra existence check on the outer key at every read.
 *  @complexity O(1). */
export function addFormKey(ref: AccessTokenProviderRef): string {
  return `${ref.kind}:${ref.providerId}`;
}

/** Merges one saved row with its own draft/busy state — defaults name to the row's current display
 *  name (Replace's "current Name pre-filled" behavior) and username to the row's own saved username
 *  (2026-09-01: a custom row's `username` is now a plaintext read-model field, {@link
 *  AccessTokenRow.username}'s own doc), with Token/Account left blank, same "never read a secret
 *  back" posture every credential form in this app already has.
 *  @complexity O(1). */
export function existingRowState(
  { row, draft, busy, info, deps }: {
    deps: AccessTokensDependencies;
    row: AccessTokenRow;
    draft: DraftFields | undefined;
    busy: BusyState | undefined;
    info: AccessTokenProviderInfo;
  },
  _optional: Record<string, never> = {},
): AccessTokenExistingRowState {
  const { accessTokenExistingRowReadyToSave, requiredFieldsFilled } = deps;
  const d = existingTokenDraft({ row, draft });
  const b = busy ?? IDLE;
  const readyToSave = accessTokenExistingRowReadyToSave({ deps: { requiredFieldsFilled, accessTokenWorksForChanged, customCredentialReplaceReadyToSave }, SOURCE_CONTROL: "source-control", fields: { ref: { kind: row.kind, providerId: row.providerId }, ...d }, row, info });
  return { row, name: d.name, token: d.token, values: d.values, username: d.username, worksFor: d.worksFor, readyToSave, saving: b.saving, error: b.error };
}

/** @complexity O(1). */
export function addFormState({ entry, info, deps }: { deps: AccessTokensDependencies; entry: AddFormEntry | undefined; info: AccessTokenProviderInfo }, _optional: Record<string, never> = {}): AccessTokenAddFormState {
  const { accessTokenRowReadyToSave, requiredFieldsFilled } = deps;
  const e = entry ?? blankAddFormEntry();
  const readyToSave = accessTokenRowReadyToSave({ deps: { requiredFieldsFilled }, fields: { ref: { kind: info.kind, providerId: info.providerId }, ...e.draft }, info });
  return { visible: e.visible, name: e.draft.name, token: e.draft.token, values: e.draft.values, username: e.draft.username, worksFor: e.draft.worksFor, readyToSave, saving: e.saving, error: e.error };
}

