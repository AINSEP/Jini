/**
 * @file What the host's security-permissions hook (`useSecurityPermissions`) needs from the outside
 * world, as an interface rather than a direct API-client import — same shape as the host's
 * comments port (`CommentsPort`) and its external-MCP admissions port's `me`.
 */
export interface SecurityPermissionsPort {
  /** Narrowed to the one field this hook reads — the real `api.me()` also returns `user`, which
   *  this hook never uses. Matches the host's comments port's identical narrowing. */
  me(): Promise<{ effectivePermissions?: string[] }>;
}
