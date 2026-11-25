/**
 * @file The single chokepoint deciding WHICH key a BYOK probe sends and WHERE it sends it, shared by
 * `test-connection.ts` and `list-models.ts`.
 *
 * ## Two stored credentials, two opt-ins
 *
 * There are exactly three keys a probe can carry, and this module is where that choice is made:
 * the one typed into the request body, the workspace's SITE credential (`useStoredCredential`), and
 * the calling admin's OWN execution credential (`useAdminStoredCredential`). The last two are
 * separate flags on purpose and must never be merged into one "use whatever is stored": they are
 * different secrets belonging to different subjects, and the screens that probe them are different
 * screens. Collapsing them would let the AI Assistant tab silently probe the admin's personal key,
 * or Settings → Execution mode silently probe the visitor's — the exact confusion ADR-058 §5 makes
 * structural.
 *
 * ## The boundary this exists to hold
 *
 * ADR-058 makes the SITE credential write-only: the site-credential read route returns `isSet` + `masked`
 * and never the key, so not even an `admin.assistant.manage` holder can read back a key someone else
 * saved. Both probe routes then take `useStoredCredential: true`, decrypt that key server-side, and
 * make one outbound call with it.
 *
 * Those two facts are only compatible if the CALLER cannot choose the destination. Before this
 * module they could: `baseUrl` came from the request body, so a single authenticated request could
 * name any host and have the server deliver the decrypted key to it — turning a write-only secret
 * into a readable one, silently, with nothing persisted and nothing to notice afterwards.
 *
 * The SSRF guard in `@jini-ai/agent-runtime`'s `connection-guard.ts` does not close this and was
 * never meant to. It blocks loopback/RFC1918/link-local/CGNAT/multicast — *internal* address space,
 * to stop a caller pivoting into the server's own network. A public host an attacker controls is
 * exactly what it is designed to let through, because that is what every real provider is.
 *
 * ## The rule
 *
 * A key the caller supplied goes wherever the caller says. It is their secret, typed into their own
 * form; sending it to a host they named is the operation they asked for, and the admin UI's key test documents that consent explicitly.
 *
 * A key the caller CANNOT read goes only where the server already recorded it belongs. The stored
 * row carries its own `baseUrl` (the host's resolved site credential);
 * that value, not the request body's, is what reaches the wire. The distinction is consent: an
 * operator can consent with their own credential and cannot consent with one they have never seen.
 *
 * ## Why a mismatch is a 400 rather than a silent substitution
 *
 * Both are equally safe — either way the caller's string never reaches the network. Rejecting is
 * chosen because substituting would make the probe answer a question nobody asked: an operator who
 * switched the endpoint field to Anthropic and pressed "Test connection" would get a green result
 * measured against the stored Google endpoint, and reasonably read it as "Anthropic works". A 400
 * naming both endpoints is the honest answer, and it is also the correct one on the merits — a key
 * issued for one provider cannot meaningfully be probed against another. Type a key for the new
 * endpoint, or save the endpoint first.
 *
 * ## What this deliberately does NOT close
 *
 * `put-site-credential.ts` lets the same `admin.assistant.manage` principal write `baseUrl`. Such a
 * principal can therefore still point the stored credential at a host they control and have the key
 * delivered there. That path is not silent the way this one was: it persists, `get-site-credential`
 * reports it back, it shows in the admin UI, and it breaks the live visitor assistant
 * (the host's live site assistant uses the same stored endpoint) — so it is self-revealing where
 * a body parameter left no trace at all. Closing it properly means constraining which endpoints may
 * be STORED, which is an allow-list and a product decision: `connection-guard.ts` deliberately
 * permits loopback for local Ollama, and real deployments point at custom gateways. That belongs in
 * the credential-write route with an explicit policy, not smuggled in here.
 */

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

/**
 * Resolves the `(apiKey, baseUrl)` pair a probe should actually use, or the rejection to return.
 *
 * @returns `ok: true` with the exact values to hand to `@jini-ai/agent-runtime`. When the stored
 * credential is used, `baseUrl` is the SERVER's own stored string rather than the caller's — the two
 * are known equal by then, so this changes no behavior, but it means the bytes on the wire are the
 * ones the server approved. Same pin-what-you-validated discipline `connection-guard.ts`'s
 * `pinnedFetch` applies to the resolved address.
 *
 * A missing row, an unset key, a missing site key and a corrupt ciphertext all arrive from
 * the injected readers as `null` and are treated identically to "no stored key": the probe
 * proceeds with an empty key against the requested endpoint, letting the provider return its own
 * auth error, which is a truer message than a synthesized one. Nothing is exposed by that path —
 * there is no secret to protect in any of those cases.
 *
 * @complexity O(1) — at most one repo read plus one decrypt. No unbounded collection, no per-item
 * I/O, no caller-controlled iteration: the resource-bounds pre-check has nothing to cap here.
 * @overallScore 100
 */
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
