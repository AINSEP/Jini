/**
 * @file Client-side permission-affordance helper.
 *
 * Ported verbatim in behaviour from the reference implementation's `lib/permissions.ts`. The bug that file
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
export function hasPermission({ permissions, permission }: { readonly permissions: readonly string[]; readonly permission: string }): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

/** What {@link isPanelAccessible} reads from a panel: its two permission declarations. */
export interface AdminPanelAccessDeclaration {
  /** All-of: every one must be held. */
  readonly permissions?: readonly string[];
  /** Any-of: at least one must be held. */
  readonly anyOfPermissions?: readonly string[];
}

/** The part of a nav group this rule reads: rows that carry the id of the panel they open. */
export interface AdminNavGroupShape {
  readonly items: readonly { readonly id: string }[];
}

/** A declaration plus the id that ties it to a nav row. */
export type AdminPanelAccessEntry = AdminPanelAccessDeclaration & { readonly id: string };

/**
 * True when the operator may use a panel, from the panel's own permission declarations.
 *
 * `permissions` is a **required key whose value may be `undefined`**: `undefined` means the session
 * has not said yet (fresh sign-in before the host's permission read answers), and every panel shows
 * then rather than flashing an empty nav or a no-access screen at someone who has access. An empty
 * list is a known, empty grant and is not the same thing (it hides every gated panel). It is
 * therefore never an optional property: absent and unknown must not be confusable.
 *
 * Rules: no declaration is accessible; `anyOfPermissions` needs at least one held (or `"*"`);
 * `permissions` (all-of) needs every one held; when both are declared both must pass.
 *
 * Client-side visibility only, never an authorization boundary: the server stays the authority
 * (see the file header).
 *
 * @complexity O(d * m): d declared ids, m held permissions.
 */
export function isPanelAccessible(
  { panel, permissions }: { readonly panel: AdminPanelAccessDeclaration; readonly permissions: readonly string[] | undefined },
  _options: Record<string, never> = {},
): boolean {
  if (permissions === undefined) return true;
  const holds = (permission: string): boolean => hasPermission({ permissions, permission });
  const anyOf = panel.anyOfPermissions ?? [];
  return (anyOf.length === 0 || anyOf.some(holds)) && (panel.permissions ?? []).every(holds);
}

/**
 * The nav with every row the operator cannot use removed.
 *
 * Returns `groups` itself (same reference) while `permissions` is `undefined`. Drops a group once all
 * its rows are hidden, so no heading sits over nothing, and keeps a row whose id names no panel in
 * `panels` (there is nothing to check it against). Client-side visibility only, like
 * {@link isPanelAccessible}.
 *
 * @complexity O(n + p + n * d * m): a Map over p panels, then n nav rows.
 */
export function withoutInaccessiblePanels<G extends AdminNavGroupShape>(
  { groups, panels, permissions }: {
    readonly groups: readonly G[];
    readonly panels: readonly AdminPanelAccessEntry[];
    readonly permissions: readonly string[] | undefined;
  },
  _options: Record<string, never> = {},
): readonly G[] {
  if (permissions === undefined) return groups;
  const panelsById = new Map(panels.map((panel) => [panel.id, panel] as const));
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => isPanelAccessible({ panel: panelsById.get(item.id) ?? {}, permissions })) }))
    .filter((group) => group.items.length > 0);
}
