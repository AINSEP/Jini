/** Authorization ports; custom actor kinds use the injected actor-identity resolver. */
// Keep actor classification independent of any identity feature. Record the actual actor kind
// in audit data; calling an automated credential a user would falsely attribute it to a human.
// A custom kind is not an authorization grant: the injected authorization gate still decides.
export type PrincipalKind = "user" | "agent" | "api_key" | (string & {});

/** The host binds its identity evaluator as a closure; core must not import the identity feature. */
export type AuthorizeFn = (required: {
  principalId: string;
  permission: string;
  workspaceId: string;
}, optional?: {
  entityType?: string;
  entityId?: string;
}) => Promise<{ allowed: boolean; reason: string }>;

/**
 * Instance-wide mutations need a separate evaluator, without a workspace id. Using a sentinel
 * workspace either finds no principal or lets one tenant's admin approve a cross-tenant mutation.
 * A workspace authorization result must never stand in for authority over the whole instance.
 */
export type InstanceAuthorizeFn = (params: {
  principalId: string;
  permission: string;
}) => Promise<{ allowed: boolean; reason: string }>;
