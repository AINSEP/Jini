import type { OAuthClient } from "@jini-ai/core/contracts/oauth";
import { MemberLoginError } from "../server/login-types.js";
import type { LoginProvider } from "@jini-ai/core/contracts/site/user-management-server";

/** Card label and exact token URL come from the pinned preset, never a browser or assistant input.
 * @returns False without opening the vault when the matching card is absent/incomplete.
 * @complexity O(c) credential metadata rows, one existing vault-owner read.
 */
export async function hasLoginCredentials(required: {
  deps: { describe: (required: { workspaceId: string; label: string }, optional?: Record<string, never>) => Promise<{ username?: string | null | undefined; baseUrl?: string | null | undefined } | null> }; workspaceId: string; provider: LoginProvider;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const saved = await required.deps.describe({ workspaceId: required.workspaceId, label: required.provider.credentialLabel });
  return Boolean(saved?.username?.trim() && saved.baseUrl === required.provider.tokenEndpoint);
}

/** Open only the provider's own API card. Username = client ID; sealed token = client secret.
 * @throws LOGIN_UNAVAILABLE for absent/misbound credentials and vault failures, with no raw cause.
 * @complexity O(c) metadata selection plus one selected credential-envelope open.
 */
export async function resolveLoginCredentials(required: {
  deps: { resolve: (required: { workspaceId: string; label: string }, optional?: Record<string, never>) => Promise<{ baseUrl?: string | null | undefined; connection: { username?: string | null | undefined; token?: string | null | undefined } } | null> }; workspaceId: string; provider: LoginProvider;
}, _optional: Record<string, never> = {}): Promise<OAuthClient> {
  try {
    const saved = await required.deps.resolve({ workspaceId: required.workspaceId, label: required.provider.credentialLabel });
    if (!saved?.connection.username?.trim() || !saved.connection.token || saved.baseUrl !== required.provider.tokenEndpoint) {
      throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
    }
    return { clientId: saved.connection.username, clientSecret: saved.connection.token, authMethod: required.provider.clientAuthentication };
  } catch {
    throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  }
}
