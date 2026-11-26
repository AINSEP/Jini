import type { Dispatch, SetStateAction, RefObject } from "react";
import type { AdminPublishCredentialProviderId, AdminPublishCredentialSummary, AdminPublishCredentialVerification } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { AdminPublishTargetCredentialSpec } from "../rules.js";
import type { Translate } from "@jini-ai/core/text";
import type { usePublishCredentials, RowFormState } from "./use-publish-credentials.hooks.js";
import { defaultCredentialForProvider, credentialFormReadyToSave, buildCredentialConnectionInput, PUBLISH_CREDENTIAL_ROW_LABEL } from "../rules.js";
import { patchRow, rowFormStateFor, rowFormStateAfterSave } from "./publish-credential-draft.js";

/** Translates a rejected create/update into the exact string {@link usePublishCredentials}'s `save`
 *  stores as that row's `error` — pulled out of `save` for the same complexity-budget reason
 *  `StaticSiteTab.tsx`'s per-provider field split documents one file over. Layers
 *  `classifyCredentialSubmitError`'s (`@jini-ai/admin/shell/lib/credential-submit-error`) specific cases over the shared
 *  `describeApiError` base case, same "check specific codes first, fall through to the shared base"
 *  convention `lib/api.ts`'s own `describeApiError` doc recommends every screen follow. The
 *  duplicate-label case reads oddly translated verbatim from the server ("a credential labeled...")
 *  since this UI no longer shows labels at all, so it gets its own row-shaped sentence instead of the
 *  server's own wording — this case should be unreachable in normal use (save always targets an
 *  existing row's id once one exists) and can only fire on a genuine write race.
 *  @complexity O(1). */
function publishCredentialSubmitErrorMessage({ err, t, locale, deps }: { err: unknown; t: Translate; locale: string; deps: Parameters<typeof usePublishCredentials>[0]["deps"] }, _options = {}): string {
  const classified = deps.classifyCredentialSubmitError({ error: err });
  if (classified.kind === "duplicate-label") return t("This connection was already saved — reload the page and try again.");
  if (classified.kind === "validation") return deps.publishCredentialSaveErrorMessage({ locale, error: deps.translateCredentialMessage({ message: classified.detail, locale }) });
  return deps.publishCredentialSaveErrorMessage({ locale, error: deps.describeApiError({ e: err, fallback: t("Unknown error") }) });
}

  /** Validate the draft before checking the in-flight guard, so even a duplicate click reports
   *  invalid edits made while the original request is pending. */
function canSaveCredential(
    { providerId, spec, values, credentials, savingRef, deps, locale, setFormStates }: Pick<Parameters<typeof usePublishCredentials>[0], "locale" | "deps"> & {
  credentials: AdminPublishCredentialSummary[] | undefined;
  setFormStates: Dispatch<SetStateAction<Record<AdminPublishCredentialProviderId, RowFormState>>>;
  savingRef: RefObject<Set<AdminPublishCredentialProviderId>>;
} & {
      providerId: AdminPublishCredentialProviderId;
      spec: AdminPublishTargetCredentialSpec | undefined;
      values: Readonly<Record<string, string>>;
    },
    _options = {}
  ): boolean {
    if (spec) {
      const error = deps.credentialDraftError({ value: values[spec.tokenField] ?? '' }, { locale, required: !defaultCredentialForProvider({ credentials: credentials ?? [], providerId }) });
      if (error) { patchRow({ setFormStates, providerId, patch: current => ({ ...current, error }) }); return false; }
    }
    return spec !== undefined && credentialFormReadyToSave({ spec: spec, values: values }) && !savingRef.current.has(providerId);
  }

export async function save(state: Pick<Parameters<typeof usePublishCredentials>[0], "port" | "t" | "locale" | "targets" | "deps"> & {
  credentials: AdminPublishCredentialSummary[] | undefined;
  setCredentials: Dispatch<SetStateAction<AdminPublishCredentialSummary[] | undefined>>;
  formStates: Record<AdminPublishCredentialProviderId, RowFormState>;
  setFormStates: Dispatch<SetStateAction<Record<AdminPublishCredentialProviderId, RowFormState>>>;
  savingRef: RefObject<Set<AdminPublishCredentialProviderId>>;
} & { providerId: AdminPublishCredentialProviderId }, _optional = {}) {
    const { providerId, targets, formStates, credentials, savingRef, port, setCredentials, setFormStates, t, locale, deps } = state;
    const spec = targets?.find((target) => target.id === providerId)?.credential;
    const values = rowFormStateFor(formStates, providerId).values;
    if (!canSaveCredential({ ...state, providerId, spec, values }) || spec === undefined) return;
    savingRef.current.add(providerId);

    const existing = defaultCredentialForProvider({ credentials: credentials ?? [], providerId });
    patchRow({ setFormStates, providerId, patch: (current) => ({ ...current, saving: true, error: null }) });
    try {
      const connection = buildCredentialConnectionInput({ providerId, spec, values });
      const { verification, ...saved } = existing
        ? await port.updateCredential({ id: existing.id, input: { connection } })
        : await port.createCredential({ label: PUBLISH_CREDENTIAL_ROW_LABEL, connection });
      // The response's summary predates the server's own `healAccountLabel` write in the same request.
      const result = verifiedCredentialSummary({ saved, verification });
      setCredentials((prev) => {
        const base = prev ?? [];
        return existing ? base.map((current) => (current.id === result.id ? result : current)) : [...base, result];
      });
      patchRow({ setFormStates, providerId, patch: (current) => ({ ...rowFormStateAfterSave(current, values), verification, verifiedCredentialId: verification ? result.id : null }) });
    } catch (err) {
      patchRow({ setFormStates, providerId, patch: (current) => ({ ...current, saving: false, error: publishCredentialSubmitErrorMessage({ err, t, locale, deps }) }) });
    } finally {
      savingRef.current.delete(providerId);
    }
  }

export async function verify({ providerId, credentials, port, setCredentials, setFormStates, locale, deps }: Pick<Parameters<typeof usePublishCredentials>[0], "port" | "locale" | "deps"> & {
  credentials: AdminPublishCredentialSummary[] | undefined;
  setCredentials: Dispatch<SetStateAction<AdminPublishCredentialSummary[] | undefined>>;
  setFormStates: Dispatch<SetStateAction<Record<AdminPublishCredentialProviderId, RowFormState>>>;
} & { providerId: AdminPublishCredentialProviderId }, _optional = {}): Promise<void> {
    const connected = defaultCredentialForProvider({ credentials: credentials ?? [], providerId });
    if (!connected) return; // Nothing saved for this provider yet — no row for `verify`'s button to have come from.

    patchRow({ setFormStates, providerId, patch: (current) => ({ ...current, verifying: true, verifyError: null, verifiedCredentialId: connected.id }) });
    try {
      const result = await port.verifyCredential({ id: connected.id });
      // Mirrors the server's own `healAccountLabel` write (`publish-credentials.ts`'s route doc) —
      // a `"valid"` result carrying an `accountLabel` updates this row's SAVED summary immediately,
      // rather than waiting on a refetch this hook has no other reason to trigger. `undefined` (no
      // account label on this result) leaves whatever the row already had alone, same "only a truthy
      // finding heals forward" rule the server side follows.
      const accountLabel = result.accountLabel;
      if (accountLabel !== undefined) {
        // `connected` came from a loaded list, and nothing sets the list back to `undefined` once
        // loaded, so `prev` is defined here (the old `prev ?? []` could not fire).
        setCredentials((prev) => {
          if (!prev) throw new Error("publish credentials disappeared during verification");
          return prev.map((c) => (c.id === connected.id ? { ...c, accountLabel } : c));
        });
      }
      patchRow({ setFormStates, providerId, patch: (current) => ({ ...current, verifying: false, verification: result, verifyError: null }) });
    } catch (err) {
      patchRow({ setFormStates, providerId, patch: (current) => ({
        ...current,
        verifying: false,
        verifyError: deps.publishCredentialVerifyErrorMessage({ locale, error: deps.describeApiError({ e: err, fallback: "unknown error" }) }),
      }) });
    }
  }

/** Verification may heal the saved account label without erasing an absent finding. */
function verifiedCredentialSummary({ saved, verification }: {
  saved: AdminPublishCredentialSummary; verification: AdminPublishCredentialVerification | undefined;
}): AdminPublishCredentialSummary {
  return verification?.accountLabel !== undefined ? { ...saved, accountLabel: verification.accountLabel } : saved;
}
