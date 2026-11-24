import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { TrashEntityType } from "../../../trash/index.js";

/**
 * @file Shared guards for the `trash` admin route specs: the selection limits, the actor id, the
 * Trash-surface entry gate and the per-kind check the restore/purge routes inject.
 *
 * The four routes are one admin surface (list, restore, permanently delete, move one item in).
 * Which permission gets a principal onto that surface, and which permission each KIND of row needs,
 * is the host's product policy: both arrive as injected functions, so this file only owns the
 * HTTP contract around them.
 */

/** Rows per page when the caller does not say. Matches the screen's own first render. */
export const DEFAULT_TRASH_PAGE_SIZE = 50;

/** Hard ceiling on `limit`, so a caller-supplied number can never turn one request into a scan. */
export const MAX_TRASH_PAGE_SIZE = 200;

/** The most rows one restore or purge request may name. Each is its own transaction. */
export const MAX_TRASH_SELECTION = 200;

/** The principal fields these routes read: only the id, as the actor and the authorization subject. */
export interface TrashRoutePrincipal { id: string }

/** A route whose body is validated after the principal and the entry gate, so `parse` only carries it. */
export interface TrashBodyInput { body: unknown }

/**
 * The entry gate onto the Trash surface, bound by the host to its own RBAC with its own entry
 * permission. Injected rather than asked through the route's `authorize` handle because the host's
 * authorizer receives exactly `{ principalId, permission, workspaceId }` here — no entity type: the
 * gate is on the surface, not on any one kind of row. Returns the permission it checked so a denial
 * can name it.
 */
export type TrashEntryGateFn = (required: { principalId: string }) => Promise<{ permission: string; allowed: boolean; reason: string }>;

/** Whether the principal may act on one kind of trashed thing — the host's per-kind policy. */
export type TrashKindGateFn = (required: { principalId: string; entityType: TrashEntityType; entityId?: string }) => Promise<{ allowed: boolean }>;

/** The authenticated principal's id. A mount without one is a wiring bug, so it fails closed. @complexity O(1). */
export function trashActorId({ context }: { context: TrashRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("trash admin route has no authenticated principal");
  return context.id;
}

/**
 * Asks the injected entry gate and refuses with the host's standard 403 body
 * (`principal '<id>' is not authorized for '<permission>' (<reason>)`, `details` naming both) when
 * it says no. The list, restore and purge routes all apply it, for the same reason: the Trash is
 * one surface, and three routes on it disagreeing about who is allowed onto it is how one of them
 * later gets widened alone. Per-row checks still decide what each request actually touches.
 * @complexity O(1) plus the injected gate.
 */
export async function requireTrashEntry(
  { authorizeEntry, principalId }: { authorizeEntry: TrashEntryGateFn; principalId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  const { permission, allowed, reason } = await authorizeEntry({ principalId });
  if (!allowed) rejectRoute({
    status: 403, error: `principal '${principalId}' is not authorized for '${permission}' (${reason})`,
    code: "FORBIDDEN", details: { permission, reason },
  });
}

/** The selection-size rule restore and purge share: a non-empty array of at most {@link MAX_TRASH_SELECTION}. @complexity O(1). */
export function readSelection({ body, field }: { body: unknown; field: string }, _optional: Record<string, never> = {}): unknown[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>)[field];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRASH_SELECTION) return null;
  return raw;
}
