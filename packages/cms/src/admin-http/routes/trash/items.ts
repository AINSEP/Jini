import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { TrashActor, TrashEntityType } from "../../../trash/index.js";
import { trashActorId, type TrashBodyInput, type TrashRoutePrincipal } from "./shared.js";

/**
 * Outcome of one move. `version` is the entity's version AFTER the flip (`null` for a kind with no
 * version column) — the same success shape `TrashPort.trash` answers.
 */
export type TrashMoveOutcome =
  | { ok: true; version: number | null }
  | { ok: false; reason: "unknown-type" }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "forbidden"; permission: string }
  | { ok: false; reason: "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number };

/**
 * Moves one entity of any trashable kind into the Trash. Injected because the kind registry, the
 * live-row read, the self-moving kinds and the per-kind permission are all the host's: the function
 * resolves the kind, checks that kind's own permission for the actor, and answers in
 * {@link TrashMoveOutcome}.
 */
export type TrashMoveFn = (required: { workspaceId: string; entityType: TrashEntityType; entityId: string; actor: TrashActor }) => Promise<TrashMoveOutcome>;

/** The deps this route reads. */
export interface TrashMoveRouteDeps {
  workspaceId: string;
  moveToTrash: TrashMoveFn;
}

/** The success envelope. */
export interface AdminTrashMoveEnvelope { ok: true; version: number | null }

type Refusal = Exclude<TrashMoveOutcome, { ok: true }>;
type RefusalContext = { entityType: string; principalId: string };

/**
 * The words for one `blocked` refusal, by its `code`. `TERM_HAS_CHILDREN` is the taxonomy kind's
 * blocker; `THEME_ACTIVE` and `ALREADY_IN_TRASH` come from the theme mover and its folder adapter.
 * Any other code gets a generic sentence; `code`/`count` stay machine-readable either way.
 */
const BLOCKED_MESSAGES: Readonly<Record<string, (count: number) => string>> = {
  TERM_HAS_CHILDREN: (count) => `this term has ${count} sub-terms — move them under another parent, or delete them permanently, first`,
  THEME_ACTIVE: () => "this is the site's active theme — switch to another theme first",
  ALREADY_IN_TRASH: () => "an item with this id is already in the Trash — restore or permanently delete that one first",
};

/** @complexity O(1). */
function blockedMessage({ code, count }: { code: string; count: number }, _optional: Record<string, never> = {}): string {
  const message = Object.hasOwn(BLOCKED_MESSAGES, code) ? BLOCKED_MESSAGES[code] : undefined;
  return message ? message(count) : `this item cannot be moved to the Trash (${code})`;
}

/** Each refusal's exact admin HTTP status and body, by reason (the hand-written `switch`). */
const MOVE_REFUSALS: { readonly [R in Refusal["reason"]]: (outcome: Extract<Refusal, { reason: R }>, at: RefusalContext) => { status: number; body: Record<string, unknown> } } = {
  "unknown-type": (_o, { entityType }) => ({ status: 404, body: { error: `'${entityType}' is not a kind the Trash can hold`, code: "TRASH_UNKNOWN_TYPE" } }),
  "not-found": () => ({ status: 404, body: { error: "item was not found", code: "NOT_FOUND" } }),
  forbidden: ({ permission }, { principalId }) => ({ status: 403, body: {
    error: `principal '${principalId}' is not authorized for '${permission}'`, code: "FORBIDDEN", details: { permission },
  } }),
  "version-changed": () => ({ status: 409, body: { error: "the item changed since it was last read", code: "TRASH_VERSION_CHANGED" } }),
  blocked: (outcome) => ({ status: 409, body: { error: blockedMessage(outcome), code: outcome.code, count: outcome.count } }),
};

/**
 * Map the move's refusal to the admin HTTP contract. Thrown as a `RouteRefusalError` rather than
 * through `rejectRoute` because two bodies carry fields that helper does not write: `blocked` adds a
 * machine-readable `count`, and the kind `forbidden` names only the permission in `details` (the
 * move's decision carries no reason).
 * @complexity O(1).
 */
function rejectMove({ outcome, at }: { outcome: Refusal; at: RefusalContext }, _optional: Record<string, never> = {}): never {
  const respond = MOVE_REFUSALS[outcome.reason] as (o: Refusal, c: RefusalContext) => { status: number; body: Record<string, unknown> };
  throw new RouteRefusalError(respond(outcome, at));
}

/** Reads `{ type, id }`, or `null` when the body is not a usable one. @complexity O(1). */
function readBody({ body }: { body: unknown }, _optional: Record<string, never> = {}): { type: string; id: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { type, id } = body as { type?: unknown; id?: unknown };
  if (typeof type !== "string" || type.length === 0) return null;
  if (typeof id !== "string" || id.length === 0) return null;
  return { type, id };
}

/**
 * POST move one entity of any trashable kind into the Trash.
 *
 * Unlike restore/purge, this route takes exactly ONE item, not a selection: it is the generic
 * replacement for every per-domain `DELETE`/`POST .../trash` path, and none of those ever deleted
 * more than one row per call either. There is deliberately no coarse entry gate here (unlike
 * list/restore/purge, which all gate onto the shared Trash SCREEN before their own per-row check) —
 * the injected move checks the one permission that matters, the kind's own, exactly as every bespoke
 * delete path already does. The principal is read before the body, as the hand-written route did,
 * so a missing session wins over a malformed body.
 */
export const trashMoveRoute = defineJsonRoute<TrashBodyInput, AdminTrashMoveEnvelope, TrashMoveRouteDeps, TrashRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/trash/items",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context }) => {
    const principalId = trashActorId({ context });
    const body = readBody({ body: input.body });
    if (!body) rejectRoute({ status: 400, error: "expected { type, id }", code: "INVALID_INPUT" });
    const outcome = await deps.moveToTrash({ workspaceId: deps.workspaceId, entityType: body.type, entityId: body.id, actor: { principalId } });
    if (!outcome.ok) rejectMove({ outcome, at: { entityType: body.type, principalId } });
    return ok({ value: { ok: true, version: outcome.version } });
  },
});
