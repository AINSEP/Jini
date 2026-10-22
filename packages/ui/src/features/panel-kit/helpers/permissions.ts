// ADR-021: GET /auth/me flattens effectivePermissions, losing resourceType/constraintJson.
// ADR-006 keeps one server evaluator; every mutation and tool call must be rechecked there.
/** UI affordance check for exact grants or the literal * wildcard; server authorization remains host-owned. */
/**
 * A flattened permission list has lost resource scopes and constraints. Treating '*' as an ordinary
 * name would hide every gated control from wildcard holders, but matching it here only controls UI.
 * Never use this helper to authorize an operation: the server must evaluate the full grants again.
 */
export function hasPermission({ permissions, permission }: { permissions: readonly string[]; permission: string }): boolean {
  return permissions.includes("*") || permissions.includes(permission);
}

