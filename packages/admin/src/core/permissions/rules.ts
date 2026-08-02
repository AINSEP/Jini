/**
 * @file Client-side permission-affordance helper.
 *
 * Ported verbatim in behaviour from Tovu's `apps/admin/src/lib/permissions.ts`. The bug that file
 * exists to prevent is worth restating, because it is not obvious and it cost a real lockout:
 *
 * A host's "effective permissions" list is typically flattened to bare permission strings, and an
 * unconstrained owner grant appears in it as the literal `"*"`. A plain
 * `permissions.includes(permission)` check treats `"*"` as just another permission *name* and
 * never matches it against a real permission like `"comments.read"` — which locked the workspace
 * owner out of every permission-gated affordance in the admin. Every call site that checks a
 * permission string should route through this helper rather than reintroducing a literal
 * `.includes()`.
 *
 * ## NOT A SECURITY BOUNDARY
 *
 * This decides whether a button, section, or form renders. It never runs on the server and is
 * never consulted by any route or command handler. A bug here — too permissive or too
 * restrictive — can only show or hide a control; it cannot grant or block the underlying
 * operation, because every mutation and tool call must be independently re-checked server-side.
 * Do not import this into server code, and do not treat a passing call here as proof an action is
 * actually allowed.
 */

/**
 * True iff `permissions` grants `permission` — either an exact match, or the unconstrained owner
 * wildcard `"*"`.
 *
 * @complexity O(n) array scan, n = `permissions.length` (a handful of grant strings for a real
 * principal; never a caller-unbounded collection).
 */
export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}
