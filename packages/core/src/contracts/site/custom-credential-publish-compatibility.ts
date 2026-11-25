import type { CredentialSetSummary } from "../credentials.js";

/** Tells publish targets that a saved credential's compatibility changed. Bound by the host. */
export interface PublishCompatibilityPort {
  /** Loads what invalidation needs BEFORE the credential write. The returned function runs after the write and loads nothing. */
  prepareInvalidation(
    required: { workspaceId: string },
    optional?: Record<string, never>,
  ): Promise<(required: { after: CredentialSetSummary }) => void>;
}
