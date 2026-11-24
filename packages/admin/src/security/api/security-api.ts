import type { AdminAuthenticatedRequestFn, AdminAuthenticatedRequestOptions, AdminRequestFn } from "../../contracts/admin-request.js";
import type { AdminCredentialCopyResult, AdminCredentialCopySource, AdminCustomConnectionInput, AdminCustomCredentialCategoryId, AdminCustomCredentialsSnapshot, AdminCustomCredentialSummary, AdminPublishConnectionInput, AdminPublishCredentialsSnapshot, AdminPublishCredentialSummary, AdminPublishCredentialVerification } from "./security-api.types.js";

/** What the host injects into {@link createSecurityApi}. */
export interface SecurityApiDeps {
  /** The host's authenticated admin request. */
  request: AdminRequestFn;
  /** The host's authenticated request for body, header and raw-response calls. */
  authenticatedRequest: AdminAuthenticatedRequestFn;
  /** The workspace every path is scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}



/** The admin API calls of the security feature. */
export function createSecurityApi(deps: SecurityApiDeps, _optional: Record<string, never> = {}) {
  const { request, authenticatedRequest, workspaceId } = deps;
  return {
  // Static Site tab "Getting it online" card → credential management (the host's route) — named provider connections for `triggerPublish`, stored
  // encrypted server-side and never read back. See `AdminPublishCredentialSummary`'s own doc for
  // exactly what a saved row can and cannot reveal.
  /** Every configured credential for this workspace, plus the server's own `executionMode` — the
   *  ONLY source of truth for whether this instance can drive a CLI locally or needs a stored
   *  credential to publish at all. Never sniffed client-side; see `AdminPublishExecutionMode`'s doc. */
  listPublishCredentials: () =>
    request<AdminPublishCredentialsSnapshot>({ path: `/workspaces/${workspaceId}/system/publish/credentials` }),
  /** Creates one named connection. `409 DUPLICATE_LABEL` (surfaced as a thrown `ApiError` with that
   *  `code`) if this workspace already has a credential with the same label — labels are the only
   *  human-facing identifier a reader has for telling two connections apart, so silently allowing a
   *  second row with the same one would make the list ambiguous. `isDefault` is optional — omitted
   *  entirely (not `false`) lets the server apply its own default-assignment rule (e.g. a provider's
   *  first-ever saved connection), rather than this admin guessing at it. */
  createPublishCredential: (input: { label: string; connection: AdminPublishConnectionInput; isDefault?: boolean; worksFor?: string[] }) =>
    request<{ credential: AdminPublishCredentialSummary; verification?: AdminPublishCredentialVerification }>({ path: `/workspaces/${workspaceId}/system/publish/credentials` }, { init: {
      method: "POST",
      body: JSON.stringify(input),
    } }),
  /** Updates a credential's label, connection, and/or default status. Omitting `connection` entirely
   *  — never sending it as an empty object or blank fields — is what keeps the stored secret
   *  untouched; see the host's publish-credentials hook header for why the form can never send a
   *  half-blank one. `isDefault: true` makes this the default connection for its provider (the server
   *  owns clearing any previous default for that same provider); omitted leaves default status
   *  unchanged. `worksFor` omitted preserves compatibility; [] clears it without a connection. */
  updatePublishCredential: ({ id, input }: { id: string; input: { label?: string; connection?: AdminPublishConnectionInput; isDefault?: boolean; worksFor?: string[] } }, _optional: Record<string, never> = {}) =>
    request<{ credential: AdminPublishCredentialSummary; verification?: AdminPublishCredentialVerification }>({ path: `/workspaces/${workspaceId}/system/publish/credentials/${encodeURIComponent(id)}` }, { init: {
      method: "PUT",
      body: JSON.stringify(input),
    } }),
  /** `204`, idempotent — deleting an id that is already gone (a stale list, a double click) still
   *  resolves rather than throwing. */
  deletePublishCredential: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
    request<void>({ path: `/workspaces/${workspaceId}/system/publish/credentials/${encodeURIComponent(id)}` }, { init: { method: "DELETE" } }),
  /** Re-checks one already-saved credential against its real provider right now — the human-facing
   *  counterpart to the best-effort verify a create/update already runs automatically, for when that
   *  cached result has gone stale (a rotated token) or was lost (a server restart clears the
   *  in-memory verification cache; see `AdminPublishCredentialSummary.accountLabel`'s doc for why the
   *  DB-persisted half of this survives that even though this specific response does not). Never
   *  4xxs for an unreachable or rejected provider — a failed verification is still a `200` carrying
   *  `status: "invalid" | "unreachable"`, only a genuinely missing credential id 404s. */
  verifyPublishCredential: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
    request<{ verification: AdminPublishCredentialVerification }>({ path: `/workspaces/${workspaceId}/system/publish/credentials/${encodeURIComponent(id)}/verify` }, { init: {
      method: "POST",
    } }),

  /** Owner-only Shared Keys metadata; no other site inventories or credential values. */
  listCredentialCopySources: (_required: Record<string, never>, options: AdminAuthenticatedRequestOptions = {}) =>
    authenticatedRequest<{ sources: AdminCredentialCopySource[] }>({
      path: `/workspaces/${workspaceId}/system/credential-copy`, method: "GET",
    }, options),
  /** Approve one saved key for this site; a key saved on another site is added to Shared Keys first. sourceSiteId is the fixed shared-keys group. */
  copyCredentials: (input: { sourceSiteId: string; ids: string[]; overwrite: boolean }, options: AdminAuthenticatedRequestOptions = {}) =>
    authenticatedRequest<{ results: AdminCredentialCopyResult[] }>({
      path: `/workspaces/${workspaceId}/system/credential-copy`, method: "POST", body: input,
    }, options),

  // Access Tokens page → "Add custom provider" (the host's route) — a user-defined provider (name, base URL, token, optional username,
  // category), stored encrypted server-side and never read back. Structurally mirrors the
  // source-control-credentials block above. `custom-credentials.write`-gated on every verb
  // server-side.
  /** Every configured custom-provider credential for this workspace. */
  listCustomCredentials: () => request<AdminCustomCredentialsSnapshot>({ path: `/workspaces/${workspaceId}/system/custom/credentials` }),
  /** Creates one custom-provider credential. `409 DUPLICATE_LABEL` (surfaced as a thrown `ApiError`
   *  with that `code`) if this workspace already has one with the same `label`. */
  createCustomCredential: (input: {
    scope?: "project" | "site";
    worksFor?: string[];
    label: string;
    category: AdminCustomCredentialCategoryId;
    baseUrl: string;
    /** Omitted = no extra hosts beyond `baseUrl` (server-side default — see
     *  `validateAdditionalHosts`'s own doc). */
    additionalHosts?: readonly string[];
    connection: AdminCustomConnectionInput;
  }) =>
    request<{ credential: AdminCustomCredentialSummary }>({ path: `/workspaces/${workspaceId}/system/custom/credentials` }, { init: {
      method: "POST",
      body: JSON.stringify(input),
    } }),
  /** Updates a credential's label, category, base URL, additional hosts, username, and/or
   *  connection. Omitting `connection` entirely — never sending it as an empty object or blank
   *  fields — is what keeps the stored secret untouched, same contract every sibling credential
   *  update call documents. Omitting `additionalHosts` leaves it unchanged; supplying it REPLACES
   *  the whole list (never merges), matching `updateCustomCredential`'s own server-side contract.
   *  `username` is independent of `connection` (2026-09-01, the server store's own precedence doc): omit
   *  it to leave the saved username exactly as `connection` (if sent) would otherwise set it, send
   *  `null` to clear it, or a non-empty string to set it — with NO token retype required either
   *  way. When both `username` and `connection` are sent in the same call, `username` wins for what
   *  gets stored in the plaintext column (server-side precedence, not a client-side rule).
   *  `worksFor` omitted preserves compatibility; [] clears it without a connection. */
  updateCustomCredential: ({ id, input }: { id: string; input: {
      worksFor?: string[];
      label?: string;
      category?: AdminCustomCredentialCategoryId;
      baseUrl?: string;
      additionalHosts?: readonly string[];
      username?: string | null;
      connection?: AdminCustomConnectionInput;
    } }, _optional: Record<string, never> = {}
  ) =>
    request<{ credential: AdminCustomCredentialSummary }>({ path: `/workspaces/${workspaceId}/system/custom/credentials/${encodeURIComponent(id)}` }, { init: {
      method: "PUT",
      body: JSON.stringify(input),
    } }),
  /** `204`, idempotent. */
  deleteCustomCredential: ({ id }: { id: string }, _optional: Record<string, never> = {}) => request<void>({ path: `/workspaces/${workspaceId}/system/custom/credentials/${encodeURIComponent(id)}` }, { init: { method: "DELETE" } }),
  };
}
