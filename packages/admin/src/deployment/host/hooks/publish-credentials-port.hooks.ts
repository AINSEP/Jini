import type { AdminPublishConnectionInput, AdminPublishCredentialSummary, AdminPublishCredentialsSnapshot, AdminPublishCredentialVerification } from "@jini-ai/admin/security/api/security-api.types";

/** A saved credential plus the server's save-time verification of it, when the write carried a
 *  `connection` — `POST`/`PUT .../credentials` verify what was just saved and return the verdict
 *  beside the summary (`publish-credentials.ts`'s header). Absent for an `isDefault`-only write. */
export type PublishCredentialSaveResult = AdminPublishCredentialSummary & {
  verification?: AdminPublishCredentialVerification;
};

/**
 * @file What `usePublishCredentials` needs from the outside world, as an interface rather than a
 * direct host API import — same shape as the host's static-publish port.
 */
export interface PublishCredentialsPort {
  /** Every configured credential for this workspace, plus the server's own `executionMode` — see
   *  `AdminPublishCredentialsSnapshot`'s own doc. */
  listCredentials(): Promise<AdminPublishCredentialsSnapshot>;
  /** Creates one named connection. Rejects with an `ApiError` (`code: "DUPLICATE_LABEL"`) if this
   *  workspace already has a credential with the same label. */
  createCredential(input: { label: string; connection: AdminPublishConnectionInput; isDefault?: boolean }, optional?: {}): Promise<PublishCredentialSaveResult>;
  /** Updates a credential's label, connection, and/or default status. Omitting `connection` keeps the
   *  stored secret untouched — see the host hook's header for why the form can
   *  never send a half-blank one. */
  updateCredential(
    required: { id: string; input: { label?: string; connection?: AdminPublishConnectionInput; isDefault?: boolean } },
    optional?: {}
  ): Promise<PublishCredentialSaveResult>;
  /** Idempotent — deleting an id that is already gone still resolves. */
  deleteCredential(required: { id: string }, optional?: {}): Promise<void>;
  /** Re-checks one already-saved credential against its real provider right now — see
   *  `api.verifyPublishCredential`'s own doc for why this is a real `200` result even when the
   *  provider rejects the credential, not a thrown error. */
  verifyCredential(required: { id: string }, optional?: {}): Promise<AdminPublishCredentialVerification>;
}
