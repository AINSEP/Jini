import type { Dispatch, SetStateAction } from "react";
import type { AdminPublishCredentialProviderId, AdminPublishCredentialSummary } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { usePublishCredentials, RowFormState, SelectionState, PublishCredentialRowState } from "./use-publish-credentials.hooks.js";
import { defaultCredentialForProvider } from "../rules.js";

export function blankRowFormState(): RowFormState {
  return { values: {}, saving: false, error: null, verifying: false, verification: undefined, verifyError: null, verifiedCredentialId: null };
}

/**
 * A row's form state once its save has succeeded: blank, as before — unless the operator edited the
 * draft while the request was in flight (the inputs stay editable; only Save disables). That newer
 * draft was never sent, so it is kept whole rather than blanked into a "Connected" row that implies
 * it was saved (terra review 2026-09-20, finding 4's sibling). Kept whole, not per field, so a
 * two-field provider's draft stays savable as one piece.
 * @complexity O(1).
 */
export function rowFormStateAfterSave(current: RowFormState, sent: Readonly<Record<string, string>>): RowFormState {
  return current.values === sent ? blankRowFormState() : { ...blankRowFormState(), values: current.values };
}

/** A provider's form state, blank until its row is first touched. @complexity O(1). */
export function rowFormStateFor(states: Readonly<Record<string, RowFormState>>, providerId: AdminPublishCredentialProviderId): RowFormState {
  return states[providerId] ?? blankRowFormState();
}

  // Every write below goes through this, so a row never touched before starts from a blank state.
export function patchRow(
    { providerId, patch, setFormStates }: { setFormStates: Dispatch<SetStateAction<Record<AdminPublishCredentialProviderId, RowFormState>>>; providerId: AdminPublishCredentialProviderId; patch: (current: RowFormState) => RowFormState },
    _options = {},
  ) {
    setFormStates((prev) => ({ ...prev, [providerId]: patch(rowFormStateFor(prev, providerId)) }));
  }

export function setField(
    { providerId, fieldName, value, targets, deps, locale, setFormStates }: Pick<Parameters<typeof usePublishCredentials>[0], "locale" | "targets" | "deps"> & {
  setFormStates: Dispatch<SetStateAction<Record<AdminPublishCredentialProviderId, RowFormState>>>;
} & { providerId: AdminPublishCredentialProviderId; fieldName: string; value: string },
    _options = {},
  ) {
    const spec = targets?.find(target => target.id === providerId)?.credential;
    const secret = fieldName === spec?.tokenField || spec?.fields.some(field => field.name === fieldName && field.secret);
    patchRow({ setFormStates, providerId, patch: (current) => ({ ...current, values: { ...current.values, [fieldName]: value }, ...(secret ? { error: deps.credentialDraftError({ value }, { locale }) } : {}) }) });
  }

export function rows({ credentials, targets, formStates, selections }: Pick<Parameters<typeof usePublishCredentials>[0], "targets"> & {
  credentials: AdminPublishCredentialSummary[] | undefined;
  formStates: Record<AdminPublishCredentialProviderId, RowFormState>;
  selections: Partial<Record<AdminPublishCredentialProviderId, SelectionState>>;
}, _optional = {}): readonly PublishCredentialRowState[] | undefined {
  return credentials === undefined || targets === undefined
      ? undefined
      : targets.flatMap((target) => {
          if (target.credential === undefined) return [];
          const formState = rowFormStateFor(formStates, target.id);
          const saved = defaultCredentialForProvider({ credentials, providerId: target.id });
          const verdictIsForSaved = saved !== undefined && formState.verifiedCredentialId === saved.id;
          return {
            providerId: target.id,
            label: target.label,
            credential: target.credential,
            saved,
            values: formState.values,
            saving: formState.saving,
            error: formState.error,
            verifying: formState.verifying,
            verification: verdictIsForSaved ? formState.verification : undefined,
            verifyError: verdictIsForSaved ? formState.verifyError : null,
            selectingCredentialId: selections[target.id]?.pendingId ?? null,
            selectError: selections[target.id]?.error ?? null,
          };
        });

}
