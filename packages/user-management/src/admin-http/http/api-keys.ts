import type { PrincipalRecord } from "../../core/types.js";
import type { ApiKeyRecord } from "../../identity/api-key-types.js";

/**
 * @file Admin-facing api-key response DTOs (mirrors `./users.ts`'s pattern).
 *
 * Purpose:
 * The one place that decides what an api-key row may show a client. `ApiKeyRecord.keyHash` has no
 * field on any shape here, so there is nothing to forward by accident (INV-05) — the same
 * structural defence `AdminUserResponse` uses against `UserRecord.passwordHash`.
 *
 * `rawKey` is the deliberate exception, and it is NOT read off a record: `toApiKeyIssueResponse`
 * takes it as a separate argument, because the only value that ever carries it is `issueApiKey`'s
 * in-memory return, never a row. A second call for the same key cannot re-emit it.
 */

/** Admin-facing shape of a principal minted by `APIKEY_PRINCIPAL_CREATE`. */
export interface AdminApiKeyPrincipalResponse {
  id: string;
  kind: "api_key";
  status: PrincipalRecord["status"];
  workspaceId: string;
  displayName: string;
}

/** Admin-facing shape of a freshly issued key — the ONLY shape carrying `rawKey`. */
export interface AdminApiKeyIssueResponse {
  id: string;
  /** Shown exactly once, at issuance. Only the hash is persisted. */
  rawKey: string;
  principalId: string;
  label: string;
  expiresAt: string | null;
}

/** Serialize the minted machine principal. @complexity O(1). @overallScore 100 */
export function toApiKeyPrincipalResponse(principal: PrincipalRecord): AdminApiKeyPrincipalResponse {
  return {
    id: principal.id,
    kind: "api_key",
    status: principal.status,
    workspaceId: principal.workspaceId,
    displayName: principal.displayName,
  };
}

/**
 * Serialize an issued key together with its one-time raw value.
 *
 * @param required.rawKey - passed in separately, never sourced from `apiKey` — see the file header.
 * @complexity O(1).
 * @overallScore 100
 */
export function toApiKeyIssueResponse(required: {
  apiKey: ApiKeyRecord;
  rawKey: string;
}): AdminApiKeyIssueResponse {
  const { apiKey, rawKey } = required;
  return {
    id: apiKey.id,
    rawKey,
    principalId: apiKey.principalId,
    label: apiKey.label,
    expiresAt: apiKey.expiresAt ?? null,
  };
}
