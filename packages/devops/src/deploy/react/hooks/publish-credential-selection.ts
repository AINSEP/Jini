import type { Dispatch, SetStateAction, RefObject } from "react";
import type { AdminPublishCredentialProviderId, AdminPublishCredentialSummary } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { usePublishCredentials, SelectionState } from "./use-publish-credentials.hooks.js";
import { defaultCredentialForProvider, withPromotedDefault } from "../rules.js";

export async function selectCredential({ providerId, credentialId, credentials, selectingRef, setSelections, port, setCredentials, locale, deps }: Pick<Parameters<typeof usePublishCredentials>[0], "port" | "locale" | "deps"> & {
  credentials: AdminPublishCredentialSummary[] | undefined;
  setCredentials: Dispatch<SetStateAction<AdminPublishCredentialSummary[] | undefined>>;
  setSelections: Dispatch<SetStateAction<Partial<Record<AdminPublishCredentialProviderId, SelectionState>>>>;
  selectingRef: RefObject<Set<AdminPublishCredentialProviderId>>;
} & { providerId: AdminPublishCredentialProviderId; credentialId: string }, _options = {}): Promise<void> {
    const current = defaultCredentialForProvider({ credentials: credentials ?? [], providerId });
    if (current?.id === credentialId || selectingRef.current.has(providerId)) return;
    selectingRef.current.add(providerId);
    setSelections((prev) => ({ ...prev, [providerId]: { pendingId: credentialId, error: null } }));
    let error: string | null = null;
    try {
      const promoted = await port.updateCredential({ id: credentialId, input: { isDefault: true } });
      setCredentials((prev) => withPromotedDefault({ credentials: prev ?? [], promoted }));
      await reconcileCredentials({ port, setCredentials });
    } catch (err) {
      error = deps.publishCredentialSelectErrorMessage({ locale, error: deps.describeApiError({ e: err, fallback: "unknown error" }) });
    } finally {
      selectingRef.current.delete(providerId);
      setSelections((prev) => ({ ...prev, [providerId]: { pendingId: null, error } }));
    }
  }

  /** Best-effort re-read after a promotion the server already confirmed. A failure is deliberately
   *  swallowed: the local list was already updated from the server's own response, so it is correct —
   *  surfacing an error here would tell the operator the switch failed when it did not. */
async function reconcileCredentials({ port, setCredentials }: Pick<Pick<Parameters<typeof usePublishCredentials>[0], "port"> & {
  setCredentials: Dispatch<SetStateAction<AdminPublishCredentialSummary[] | undefined>>;
}, "port" | "setCredentials">, _optional = {}): Promise<void> {
    try {
      const refreshed = await port.listCredentials();
      setCredentials(refreshed.credentials);
    } catch {
      // See this function's doc — the confirmed local promotion stands.
    }
  }
