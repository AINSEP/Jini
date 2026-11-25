import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";

/** Only server-derived metadata describes a stored key. A legacy server may still send a mask. */
export function storedCredentialHint(
  { stored, formatHint, storedKeyIsForOtherEndpoint = false }: { stored: { isSet: boolean; masked: string | null; tokenHint?: CredentialTokenHint | null } | null; formatHint: (required: { hint: CredentialTokenHint | null | undefined; locale: string }) => string; storedKeyIsForOtherEndpoint?: boolean },
  { locale = 'en' }: { locale?: string } = {},
): string | undefined {
  if (storedKeyIsForOtherEndpoint || !stored?.isSet) return undefined;
  return formatHint({ hint: stored.tokenHint, locale }) || stored.masked || undefined;
}

