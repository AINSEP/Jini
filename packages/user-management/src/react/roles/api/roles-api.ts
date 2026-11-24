import type { AdminPolicy, AdminPolicyPermission, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";

/** What the host injects into {@link createRolesApi}. */
export interface RolesApiDeps {
  /** The host's `authenticatedAdminRequest`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  authenticatedAdminRequest: <T>(required: { path: string; method: string; body?: unknown }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the roles feature, bound to the host's injected collaborators.
 *  @example const rolesApi = createRolesApi({ authenticatedAdminRequest, workspaceId }); */
export function createRolesApi({ authenticatedAdminRequest, workspaceId }: RolesApiDeps, _optional: Record<string, never> = {}) {
  return {
    listRoles: () => authenticatedAdminRequest<{ roles: AdminRole[] }>({ method: "GET", path: `/workspaces/${workspaceId}/roles` }),
    createRole: ({ name }: { name: string }, _optional: Record<string, never> = {}) =>
      authenticatedAdminRequest<{ role: AdminRole }>({ method: "POST", path: `/workspaces/${workspaceId}/roles`, body: { name } }),
    // SPEC-006 0.6.0.
    updateRole: (
      { roleId, name }: { roleId: string; name: string },
      _options: Record<string, never> = {}
    ) =>
      authenticatedAdminRequest<{ role: AdminRole }>({ method: "PATCH", path: `/workspaces/${workspaceId}/roles/${encodeURIComponent(roleId)}`, body: { name } }),
    deleteRole: ({ roleId }: { roleId: string }, _optional: Record<string, never> = {}) =>
      authenticatedAdminRequest<void>({ method: "DELETE", path: `/workspaces/${workspaceId}/roles/${encodeURIComponent(roleId)}` }),
    listPolicies: () => authenticatedAdminRequest<{ policies: AdminPolicy[] }>({ method: "GET", path: `/workspaces/${workspaceId}/policies` }),
    createPolicy: ({ name }: { name: string }, options: { description?: string } = {}) =>
      authenticatedAdminRequest<{ policy: AdminPolicy }>({ method: "POST", path: `/workspaces/${workspaceId}/policies`, body: { name, description: options.description } }),
    // SPEC-006 0.6.0.
    updatePolicy: (
      { policyId }: { policyId: string },
      options: { name?: string; description?: string } = {}
    ) =>
      authenticatedAdminRequest<{ policy: AdminPolicy }>({ method: "PATCH", path: `/workspaces/${workspaceId}/policies/${encodeURIComponent(policyId)}`, body: options }),
    deletePolicy: ({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) =>
      authenticatedAdminRequest<void>({ method: "DELETE", path: `/workspaces/${workspaceId}/policies/${encodeURIComponent(policyId)}` }),
    writePolicyPermission: (
      { policyId, permission }: { policyId: string; permission: string },
      options: { resourceType?: string } = {}
    ) =>
      authenticatedAdminRequest<{ policyPermission: unknown }>({ method: "POST", path: `/workspaces/${workspaceId}/policies/${encodeURIComponent(policyId)}/permissions`, body: { permission, resourceType: options.resourceType || undefined } }),
    listPolicyPermissions: ({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) =>
      authenticatedAdminRequest<{ policyPermissions: AdminPolicyPermission[] }>({ method: "GET", path: `/workspaces/${workspaceId}/policies/${encodeURIComponent(policyId)}/permissions` }),
    removePolicyPermission: ({ policyId, policyPermissionId }: { policyId: string; policyPermissionId: string }) =>
      authenticatedAdminRequest<void>({ method: "DELETE", path: `/workspaces/${workspaceId}/policies/${encodeURIComponent(policyId)}/permissions/${encodeURIComponent(policyPermissionId)}` }),
  };
}
