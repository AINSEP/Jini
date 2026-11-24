import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";

/** A stored credential as the server describes it: safe metadata only, never the token. */
export interface StoredCredentialView {
  isSet: boolean;
  masked: string | null;
  tokenHint?: CredentialTokenHint | null;
}

/** What {@link useCredentialHint} reads from the host. */
export interface UseCredentialHintArgs {
  hint?: CredentialTokenHint | null;
  /** The host's locale-aware hint formatter (the host owns the copy and its translations). */
  formatCredentialHint: (required: { hint: CredentialTokenHint | null | undefined; locale: string }) => string;
  /** The host's current admin locale hook. */
  useAdminLocale: () => string;
}

/** What {@link useStoredCredentialHint} reads from the host. */
export interface UseStoredCredentialHintArgs {
  stored: StoredCredentialView | null;
  storedKeyIsForOtherEndpoint?: boolean;
  /** The host's stored-hint formatter: the hint when the key is set on this endpoint, else the legacy mask. */
  storedCredentialHint: (
    required: { stored: StoredCredentialView | null; storedKeyIsForOtherEndpoint?: boolean },
    optional: { locale: string },
  ) => string | undefined;
  /** The host's current admin locale hook. */
  useAdminLocale: () => string;
}

/** Formats only the server-derived safe hint; the browser never has a stored token to inspect. */
export function useCredentialHint({ hint, formatCredentialHint, useAdminLocale }: UseCredentialHintArgs, _optional = {}): string {
  const locale = useAdminLocale();
  return formatCredentialHint({ hint, locale });
}

/** The placeholder for a saved credential field, in the operator's locale. */
export function useStoredCredentialHint(
  { stored, storedKeyIsForOtherEndpoint, storedCredentialHint, useAdminLocale }: UseStoredCredentialHintArgs,
  _optional = {},
): string | undefined {
  const locale = useAdminLocale();
  return storedCredentialHint({ stored, ...(storedKeyIsForOtherEndpoint === undefined ? {} : { storedKeyIsForOtherEndpoint }) }, { locale });
}
