/** Mirrors `connection-guard.ts`'s own `validateBaseUrl` normalization (`trim()` then strip trailing
 *  slashes) so this comparison agrees with the string the guard would actually parse — a stored
 *  `"https://x/"` and a requested `"https://x"` are the same endpoint and must not read as a
 *  mismatch. Deliberately does NOT lowercase: a URL's host is case-insensitive but its path is not,
 *  and folding case here would let `/V1` and `/v1` compare equal. */
function normalizeEndpoint({ baseUrl }: { baseUrl: string }, _optional = {}): string {
  const value = String(baseUrl).trim();
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export interface ProbeCredentialRejection {
  error: string;
  code: "STORED_CREDENTIAL_ENDPOINT_UNSET" | "STORED_CREDENTIAL_ENDPOINT_MISMATCH";
}

export type ProbeCredentialResolution =
  | { ok: true; apiKey: string; baseUrl: string }
  | { ok: false; failure: ProbeCredentialRejection };

export interface ResolveProbeCredentialInput {
  /** The endpoint from the request body. Used as-is for a caller-supplied key; used only as a
   *  equality check against the stored endpoint when the stored key is in play. */
  requestedBaseUrl: string;
  /** The key from the request body, if any. Non-empty always wins — see this file's header. */
  typedKey: string;
  /** `body.useStoredCredential === true`, already narrowed by the caller. Must stay an explicit
   *  opt-in and never be softened to "empty key ⇒ use the stored one": these routes are shared with
   *  Settings → Execution mode, whose key is a DIFFERENT credential (the admin's own), and an
   *  implicit fallback would let an operator with an empty field silently probe with the visitor
   *  credential. */
  useStoredCredential: boolean;
  /**
   * `body.useAdminStoredCredential === true`. Opts in to the CALLING PRINCIPAL'S OWN
   * `admin_execution_credentials` row — never another principal's, because the row is looked up by
   * the session's `principalId` (passed here from `getAuthedPrincipal`), not by anything in the
   * request.
   *
   * Same explicit-opt-in rule as `useStoredCredential`, for the same reason, and the two are
   * deliberately not one flag — see this file's header.
   *
   * Defaults to `false`, so every existing caller is unaffected.
   */
  useAdminStoredCredential?: boolean;
  /** The session principal, required only when `useAdminStoredCredential` is set. Must come from
   *  `getAuthedPrincipal(res)` and NEVER from the request body: it is the whole reason this branch
   *  can only ever open the caller's own row. */
  principalId?: string;
}

export type StoredProbeCredential = { apiKey: string; baseUrl: string | null };

export async function resolveProbeCredential(
  { input, openAdmin, openSite, subjects }: {
    input: ResolveProbeCredentialInput;
    openAdmin: (required: { principalId: string }) => Promise<StoredProbeCredential | null>;
    openSite: (required: Record<string, never>) => Promise<StoredProbeCredential | null>;
    subjects: { admin: string; site: string };
  }, _optional = {},
): Promise<ProbeCredentialResolution> {
  if (input.typedKey.trim()) {
    return { ok: true, apiKey: input.typedKey, baseUrl: input.requestedBaseUrl };
  }
  if (!input.useStoredCredential && !input.useAdminStoredCredential) {
    return { ok: true, apiKey: "", baseUrl: input.requestedBaseUrl };
  }

  if (input.useAdminStoredCredential) {
    return resolveStoredCredentialAgainstItsOwnEndpoint({ stored: await openAdmin({ principalId: String(input.principalId ?? "") }), requestedBaseUrl: input.requestedBaseUrl, subject: subjects.admin });
  }

  return resolveStoredCredentialAgainstItsOwnEndpoint({ stored: await openSite({}), requestedBaseUrl: input.requestedBaseUrl, subject: subjects.site });
}

/**
 * The endpoint pin, shared by both stored-credential branches: a key the caller cannot read may
 * only be sent to the endpoint the SERVER already recorded for it.
 *
 * Extracted rather than duplicated per credential because the rule is a property of "the caller
 * cannot consent to this destination", not of which row the key came from — and a second copy is
 * exactly how one of the two would eventually drift into accepting a body-supplied endpoint. Both
 * stored credentials are write-only to the same permission, so both need it identically.
 *
 * @param stored - The resolved credential, or `null` for every "there is nothing to protect here"
 *   outcome (no row, no key, missing site key, corrupt ciphertext). `null` returns an empty key
 *   against the requested endpoint, letting the provider return its own auth error — a truer message
 *   than a synthesized one, and nothing is exposed because there is no secret in play.
 * @param requestedBaseUrl - The endpoint from the request body. Compared, never sent.
 * @param subject - How the credential is named in the two rejection messages.
 * @returns The `(apiKey, baseUrl)` pair to put on the wire — always the SERVER's own stored
 *   endpoint string, not the caller's, so the bytes sent are the ones the server approved.
 * @complexity O(1) — two string normalizations and one comparison.
 */
function resolveStoredCredentialAgainstItsOwnEndpoint({ stored, requestedBaseUrl, subject }: { stored: { apiKey: string; baseUrl: string | null } | null; requestedBaseUrl: string; subject: string }, _optional = {}): ProbeCredentialResolution {
  if (!stored) {
    return { ok: true, apiKey: "", baseUrl: requestedBaseUrl };
  }

  if (!stored.baseUrl?.trim()) {
    return {
      ok: false,
      failure: {
        error: `the ${subject} has no saved endpoint, so this probe has no approved destination — save a base URL for the credential first, or supply an apiKey in this request`,
        code: "STORED_CREDENTIAL_ENDPOINT_UNSET",
      },
    };
  }

  if (normalizeEndpoint({ baseUrl: stored.baseUrl }) !== normalizeEndpoint({ baseUrl: requestedBaseUrl })) {
    return {
      ok: false,
      failure: {
        // Naming the stored endpoint leaks nothing: `get-site-credential.ts` and
        // `get-execution-credential.ts` both already return `baseUrl` in full to this exact
        // permission. Only the key is write-only.
        error: `the ${subject} is saved for '${stored.baseUrl}' and cannot be probed against '${requestedBaseUrl}' — save the new endpoint first, or supply an apiKey for it in this request`,
        code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH",
      },
    };
  }

  return { ok: true, apiKey: stored.apiKey, baseUrl: stored.baseUrl };
}
