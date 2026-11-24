import type { AdminCustomConnectionInput, AdminCustomCredentialCategoryId, AdminCustomCredentialSummary, AdminCustomCredentialsSnapshot, AdminPublishConnectionInput, AdminPublishCredentialSummary, AdminPublishCredentialsSnapshot } from "@jini-ai/admin/security/api/security-api.types";
import type { AdminPublishTargetDescriptor } from "@jini-ai/admin/deployment/api/deployment-api.types";
import type { AdminSourceControlConnectionInput, AdminSourceControlProviderDescriptor, AdminSourceControlCredentialSummary, AdminSourceControlCredentialsSnapshot } from "@jini-ai/admin/source-control/api/source-control-api.types";

/**
 * @file What `useAccessTokens` needs from the outside world, as an interface rather than a direct
 * host API import — same shape as `deployment/host/hooks/publish-credentials-port.hooks.ts`/
 * `source-control/host/hooks/source-control-credentials-port.hooks.ts`. Two flat method groups (`publish`/
 * `sourceControl`), not one unified CRUD surface: the two stores' create/update calls take
 * differently-shaped connection inputs (`AdminPublishConnectionInput` vs
 * `AdminSourceControlConnectionInput`), and collapsing them into one generic method would just move
 * that distinction into a runtime branch this interface can otherwise let the type system carry.
 */
export interface AccessTokensPort {
  /** The deploy registry's hosts (`GET .../system/publish-targets`) — every host whose descriptor
   *  takes a credential is a publish provider on this page, with its label, fields and help. */
  readonly publishTargets: {
    list(): Promise<readonly AdminPublishTargetDescriptor[]>;
  };
  /** The source-control hosts plugins declare (`GET .../system/source-control/providers`), with
   *  their credential forms. */
  readonly sourceControlProviders: {
    list(): Promise<readonly AdminSourceControlProviderDescriptor[]>;
  };
  readonly publish: {
    list(): Promise<AdminPublishCredentialsSnapshot>;
    create(input: { label: string; connection: AdminPublishConnectionInput; isDefault?: boolean; worksFor?: string[] }, optional?: Record<string, never>): Promise<AdminPublishCredentialSummary>;
    update(
      required: { id: string; input: { label?: string; connection?: AdminPublishConnectionInput; isDefault?: boolean; worksFor?: string[] } },
      optional?: Record<string, never>
    ): Promise<AdminPublishCredentialSummary>;
    /** Idempotent — deleting an id that is already gone still resolves. */
    remove(required: { id: string }, optional?: Record<string, never>): Promise<void>;
  };
  readonly sourceControl: {
    list(): Promise<AdminSourceControlCredentialsSnapshot>;
    create(input: { label: string; connection: AdminSourceControlConnectionInput; isDefault?: boolean }, optional?: Record<string, never>): Promise<AdminSourceControlCredentialSummary>;
    update(
      required: { id: string; input: { label?: string; connection?: AdminSourceControlConnectionInput; isDefault?: boolean } },
      optional?: Record<string, never>
    ): Promise<AdminSourceControlCredentialSummary>;
    /** Idempotent — deleting an id that is already gone still resolves. */
    remove(required: { id: string }, optional?: Record<string, never>): Promise<void>;
  };
  /** Backs the "Add custom provider" capability — a THIRD, separate method group rather than
   *  folding into `publish`/`sourceControl` above, same "differently-shaped connection input"
   *  reasoning this interface's own header gives for keeping those two apart; `create`/`update` also
   *  carry `category`/`baseUrl`, which neither sibling group has at all. */
  readonly custom: {
    list(): Promise<AdminCustomCredentialsSnapshot>;
    /** Uses the same attachment owner and permission as project_key_use. */
    useKey(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<unknown>;
    create(input: {
      scope?: "project" | "site";
      worksFor?: string[];
      label: string;
      category: AdminCustomCredentialCategoryId;
      baseUrl: string;
      additionalHosts?: readonly string[];
      connection: AdminCustomConnectionInput;
    }, optional?: Record<string, never>): Promise<AdminCustomCredentialSummary>;
    update(
      required: { id: string; input: {
        worksFor?: string[];
        label?: string;
        category?: AdminCustomCredentialCategoryId;
        baseUrl?: string;
        additionalHosts?: readonly string[];
        /** Independent of `connection` — see the host API client's `updateCustomCredential` doc for the
         *  omit/`null`/string tri-state and the server-side precedence when both are sent. */
        username?: string | null;
        connection?: AdminCustomConnectionInput;
      } },
      optional?: Record<string, never>
    ): Promise<AdminCustomCredentialSummary>;
    /** Idempotent — deleting an id that is already gone still resolves. */
    remove(required: { id: string }, optional?: Record<string, never>): Promise<void>;
  };
}
