import { toolMetadata } from '@jini-ai/core/tool-metadata/identity';
import { ToolInputError } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type DerivedRiskByToolId, type ToolRegistration, type AgentToolDefinition } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { ToolContributor } from "@jini-ai/core";
import type { PolicyRepoPort, PolicyPermissionRepoPort } from "../core/index.js";

/** Read ports only; no permission grants or user credentials. */
export interface Deps { workspaceId: string; authorize: AuthorizeFn; policyRepo: Pick<PolicyRepoPort, "findById">; policyPermissionRepo: Pick<PolicyPermissionRepoPort, "listByPolicyId">; }

/** Independently derived from the service calls below. */
export const derivedRisk: DerivedRiskByToolId = new Map([
  // policyRepo.findById + policyPermissionRepo.listByPolicyId: reads only.
  ["identity_policy_list_permissions", "none"],
]);
/**
 * Builds the handler with injectable admin-service dependencies.
 * @param deps - Workspace, authorization and service ports.
 * @returns One registration; readOnly follows the independently checked risk.
 * @throws ToolInputError for actionable input refusals; authorization and service failures propagate.
 * @complexity O(1) wiring; handler cost follows the wrapped service.
 */
export function buildRegistrations({ deps, policy: hostPolicy }: { deps: Deps; policy: { permission: string; policyReadToolId: string } }, _optional = {}): ToolRegistration[] {
/** Catalog for the admin service exposed through this standalone contributor. */
const catalog: AgentToolDefinition[] = [{
  name: "identity_policy_list_permissions",
  description: `Reads the permissions and resource constraints granted by one policy. Call to explain what a role can do after finding its policy id with ${hostPolicy.policyReadToolId}. Returns {policyPermissions}, an empty array when nothing is granted. Read-only: no grants or revocations. Unknown policies are refused with lookup guidance.`,
  sideEffects: "none",
  authorization: { permission: hostPolicy.permission },
  inputSchema: { type: "object", additionalProperties: false, required: ["policyId"], properties: { policyId: { type: "string", minLength: 1 } } },
}];

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "identity-policy-list-permissions", catalogModule: "features/identity/permission-list-tool.ts",
    catalog: indexCatalogById({ catalog: catalog }), derivedRisk,
    handlers: { identity_policy_list_permissions: async ctx => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: hostPolicy.permission });
      const input = requireInputRecord({ input: ctx.input });
      const policyId = input.policyId;
      if (typeof policyId !== "string" || policyId.trim() === "") throw new ToolInputError({ message: "policyId must be a non-empty string." });
      const policy = await deps.policyRepo.findById({ workspaceId: deps.workspaceId, id: policyId });
      if (!policy) throw new ToolInputError({ message: `policy '${policyId}' was not found. Use ${hostPolicy.policyReadToolId} to find a policy id.` });
      return { policyPermissions: await deps.policyPermissionRepo.listByPolicyId({ workspaceId: deps.workspaceId, policyId }) };
    } },
  });
}
/** Installs this distinct domain without replacing its existing sibling tools. */
export function contributeIdentityPolicyListPermissionsTools({ policy }: { policy: { permission: string; policyReadToolId: string } }, _optional = {}): ToolContributor<Deps, unknown> {
  return { domain: "identity-policy-list-permissions", build: deps => buildRegistrations({ deps, policy }), risk: derivedRisk };
}
