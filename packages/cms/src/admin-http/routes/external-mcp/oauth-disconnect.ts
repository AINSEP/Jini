import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { ExternalMcpOAuthDisconnectEnvelope } from "@jini-ai/core/contracts/site/cms-external-mcp";

import {
  authorizeExternalMcp, externalMcpParam, invalidServerMapping, rejectExternalMcpError, secretStoreMapping,
  type ExternalMcpCodedError, type ExternalMcpErrorMapping, type ExternalMcpErrorPredicate, type ExternalMcpFieldError,
  type ExternalMcpRoutePrincipal,
} from "./shared.js";

/** A provider-side OAuth failure, as the host's OAuth client classifies it. */
export interface ExternalMcpProviderOAuthError extends ExternalMcpCodedError {
  retryable: boolean;
  operatorAction: string;
  retryAfterSeconds?: number | undefined;
}

/** A stored authorization that cannot be refreshed: the operator must sign in again from settings. */
export interface ExternalMcpReauthRequiredError extends ExternalMcpCodedError { settingsLink: string }

/** The deps this route reads: the host OAuth service's `disconnect` and the classifiers of its OAuth error ladder. */
export interface ExternalMcpOAuthDisconnectRouteDeps {
  workspaceId: string;
  disconnect: (required: { serverId: string }) => Promise<unknown>;
  isApiConnectionError: ExternalMcpErrorPredicate<ExternalMcpCodedError>;
  isValidationError: ExternalMcpErrorPredicate<ExternalMcpFieldError>;
  isReauthRequiredError: ExternalMcpErrorPredicate<ExternalMcpReauthRequiredError>;
  isSecretStoreUnconfiguredError: ExternalMcpErrorPredicate<{ message: string }>;
  isOAuthError: ExternalMcpErrorPredicate<ExternalMcpProviderOAuthError>;
}

/** The provider refusal body: retry facts the operator can act on. @complexity O(1). */
function providerOAuthBody({ err }: { err: ExternalMcpProviderOAuthError }, _optional: Record<string, never> = {}): unknown {
  return {
    error: err.message,
    code: err.code,
    details: {
      retryable: err.retryable,
      operatorAction: err.operatorAction,
      ...(err.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: err.retryAfterSeconds }),
    },
  };
}

/** The family's OAuth error ladder, in the host's order; unmapped → the host's 500. @complexity O(1). */
function oauthErrorMappings({ deps }: { deps: ExternalMcpOAuthDisconnectRouteDeps }, _optional: Record<string, never> = {}): readonly ExternalMcpErrorMapping[] {
  return [
    {
      matches: deps.isApiConnectionError,
      status: ({ err }) => ((err as ExternalMcpCodedError).code === "access-denied" ? 403 : 400),
      body: ({ err }) => ({ error: (err as ExternalMcpCodedError).message, code: (err as ExternalMcpCodedError).code }),
    },
    invalidServerMapping({ isValidationError: deps.isValidationError }),
    {
      matches: deps.isReauthRequiredError,
      status: () => 409,
      body: ({ err }) => {
        const reauth = err as ExternalMcpReauthRequiredError;
        return { error: reauth.message, code: reauth.code, details: { retryable: false, settingsLink: reauth.settingsLink } };
      },
    },
    secretStoreMapping({ isSecretStoreUnconfiguredError: deps.isSecretStoreUnconfiguredError }),
    {
      matches: deps.isOAuthError,
      // 502 for "we could not reach them", 400 for "they refused us or we asked wrongly" — the two
      // demand different things of the operator (wait/check network vs. check configuration), and
      // collapsing them would tell someone behind a flaky network that their client id is wrong.
      status: ({ err }) => ((err as ExternalMcpProviderOAuthError).code === "OAUTH_PROVIDER_UNREACHABLE" ? 502 : 400),
      body: ({ err }) => providerOAuthBody({ err: err as ExternalMcpProviderOAuthError }),
    },
  ];
}

/**
 * `DELETE .../mcp-servers/:serverId/oauth` — drops the stored authorization.
 *
 * Clears the token and returns the connection to `disconnected`. It does NOT delete the row: the
 * operator's command, args and allowlist survive, so reconnecting is one click rather than a
 * re-entry. Deleting the server itself is the existing DELETE route's job.
 *
 * Its tools refuse from the next call, the same as DELETE — `external-mcp-revocation.ts`'s per-call
 * gate refuses a `disconnected` OAuth connection on every federated call. `restartRequired` stays
 * true because the running assistant still holds the open connection and lists the tools until it
 * restarts. Unlike DELETE, reconnecting makes them work again without a restart, once the row is
 * back to `connected`.
 *
 * Not rate-limited: it makes no outbound call, so the self-DoS the other two guard against does not
 * exist here.
 */
export const externalMcpOAuthDisconnectRoute = defineJsonRoute<{ serverId: string }, ExternalMcpOAuthDisconnectEnvelope, ExternalMcpOAuthDisconnectRouteDeps, ExternalMcpRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/oauth",
  parse: (raw) => ok({ value: { serverId: externalMcpParam({ params: raw.params, name: "serverId" }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    try {
      await deps.disconnect({ serverId: input.serverId });
    } catch (err) {
      return rejectExternalMcpError({ err, mappings: oauthErrorMappings({ deps }) });
    }
    return ok({ value: { disconnected: true, restartRequired: true } });
  },
});
