/** Caller-supplied authorization evaluator shared by content domain write services. */
export interface AuthorizationRequired {
  principalId: string;
  permission: string;
  workspaceId: string;
}
export interface AuthorizationOptional {
  entityType?: string | undefined;
  entityId?: string | undefined;
}
export type AuthorizationPort = (
  required: AuthorizationRequired,
  optional?: AuthorizationOptional,
) => Promise<{ allowed: boolean; reason: string }>;
