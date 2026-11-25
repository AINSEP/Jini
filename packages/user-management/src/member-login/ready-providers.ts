/** Shared readiness projection for OIDC routes and public plugin exports; never opens secrets. */
import type { LoginProvider } from "@jini-ai/core/contracts/site/user-management-server";

/** Re-admit bundled providers and configured credential metadata on every call.
 * @complexity O(p + c) admitted providers and their credential metadata reads.
 */
export function createReadyLoginProviderList(required: {
  listAdmitted: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<readonly LoginProvider[]>;
  hasCredentials: (required: { workspaceId: string; provider: LoginProvider }, optional?: Record<string, never>) => Promise<boolean>;
}, _optional: Record<string, never> = {}): (input: { workspaceId: string }, options?: Record<string, never>) => Promise<readonly LoginProvider[]> {
  return async ({ workspaceId }, _optional: Record<string, never> = {}) => {
    const providers = await required.listAdmitted({ workspaceId });
    const configured = await Promise.all(providers.map(async provider =>
      await required.hasCredentials({ workspaceId, provider }) ? provider : null));
    return configured.filter((provider): provider is LoginProvider => provider !== null);
  };
}
