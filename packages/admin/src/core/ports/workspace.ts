/**
 * @file `AdminWorkspacePort` — the tenant/site the admin is currently operating on.
 *
 * ## This port models tenancy generically; Tovu's own client does not
 *
 * Tovu's `api.ts` hard-codes `export const WORKSPACE_ID = "workspace-local";` at line 1 and bakes
 * that constant into every route it builds (`/workspaces/${WORKSPACE_ID}/...`) — today's Tovu is a
 * single-workspace-per-instance product, and its client reflects that. This port deliberately does
 * not carry a workspace id as a parameter on any method here: each method operates on "the
 * workspace the current client/transport is scoped to". A genuinely multi-workspace host resolves
 * *which* workspace that is at the transport/route-group-factory layer (a later, per-host slice —
 * e.g. constructing one client per workspace, or a factory parameterized by workspace id), not by
 * threading an id through every call on this port. Baking a `workspaceId` parameter into every
 * method here would be designing for a host shape (multi-workspace-per-client) that does not yet
 * exist anywhere in the corpus this port was derived from.
 *
 * ## `deleteWorkspace` exists on the contract; Tovu's reference implementation always refuses it
 *
 * Tovu's `DELETE /workspaces/:id` route (SPEC-044 REQ-05/INV-03) is real and reachable, but its
 * write-path unconditionally rejects with a `LAST_WORKSPACE`-class conflict when deleting would
 * leave zero workspaces — which, in a single-workspace-per-instance deployment, is every call. The
 * method stays on this port because the guard is a product policy of *today's* Tovu, not a
 * statement that workspace deletion is meaningless in general; a host that supports genuinely
 * disposable workspaces needs this method to work. A panel built against this port should not
 * assume `deleteWorkspace` succeeds just because the call is well-formed and authorized.
 */

/** The workspace (tenant/site) itself. */
export interface AdminWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

export interface AdminWorkspacePort {
  getWorkspace(): Promise<AdminWorkspace>;
  updateWorkspace(patch: { name?: string; slug?: string }): Promise<AdminWorkspace>;
  /** May unconditionally reject — see the file header. */
  deleteWorkspace(): Promise<void>;
}
