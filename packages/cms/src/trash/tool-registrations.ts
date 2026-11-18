/**
 * @file Trash's agent-tool wiring: `trash_list_items` and `trash_restore_item`, and nothing else.
 *
 * Read `agent-tools.ts`'s header first — it names the separate confirmed-purge contributor, and why
 * a `trash_item` tool is built by the host rather than here.
 *
 * Authorization shape: the trash service takes no `authorize` dependency at all, so, like
 * Redirects, this is the layer that gates (the single evaluator, located at the handler). The
 * permission is not one Trash permission but **the permission that domain's own delete tool
 * already required**, resolved per row by the host's policy. Restoring a post is undoing the post
 * delete tool; anything weaker than the gate on the delete would make the Trash a way around it.
 *
 * Host policy is bound by the host, not here: the host's tool metadata (search vocabulary,
 * approval/confirmation policy) is applied around these registrations with `withToolMetadata`, and
 * the per-kind permissions, visibility filter, days-left rule and kind lists arrive as
 * `deps.trashPolicy`.
 */
// `ToolInputError` specifically — the marker the daemon's `ToolExecutor` reads to tag a rejection
// `errorKind: 'validation'` rather than the redacted-500 `'internal'` bucket a bare `Error` gets.
import {
  buildDomainRegistrations,
  indexCatalogById,
  optionalString,
  readToolLimit,
  requireInputRecord,
  requireString,
  ToolInputError,
  type AgentToolSideEffect,
  type ToolHandler,
  type ToolRegistration,
} from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/args.js";
import { buildTrashAgentToolCatalog } from "./agent-tools.js";
import type { TrashEntityType, TrashItem, TrashPort } from "./ports.js";

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

/** The principal id the boot-time widget adoption writes as its actor
 *  (`../widgets/write-service.ts`'s `ADOPTION_ACTOR`) — duplicated from the host admin Trash list
 *  route's constant of the same name/value rather than imported, so this domain-facing tool file
 *  carries no back-edge into any HTTP layer. */
const SYSTEM_ACTOR_PRINCIPAL_ID = "system";

/** The user listing `trash_list_items` reads, structurally: only the members the handler calls. */
interface TrashUserLister {
  list(required: { workspaceId: string }): Promise<readonly { principalId: string; username: string }[]>;
}

/**
 * The product policy the Trash tools need and do not own: which permission each kind requires, the
 * entry permission, the per-row visibility filter, the days-left rule and the two kind lists (one
 * for the unknown-kind message, one for the published enum). The host binds every member.
 */
export interface TrashToolPolicy {
  permissionFor(entityType: TrashEntityType): string | null;
  readPermission: string;
  filterVisible(input: { principalId: string; items: readonly TrashItem[] }): Promise<readonly TrashItem[]>;
  daysRemaining(input: { now: string; until: string }): number;
  /** The kinds the unknown-kind refusal names: not de-duplicated, in the host's order. */
  messageKinds(): readonly TrashEntityType[];
  /** The kinds the catalog's entityType enum publishes: de-duplicated, in the host's order. */
  catalogKinds(): readonly TrashEntityType[];
}

/** The exact slice of dependencies Trash's tool handlers read; the host supplies the policy. */
export interface TrashPackageToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  trash: TrashPort;
  clock: { nowIso(): string };
  userRepo: TrashUserLister;
  trashPolicy: TrashToolPolicy;
}

/**
 * The human-facing text for who deleted an item, in priority order: the account's username, else
 * `"system"` for the boot-time adoption actor, else a plain fallback for a removed/unknown account
 * — never the raw principal id. `" + AI"` is appended when a plugin acted, mirroring the admin
 * frontend's actor-label separator, but literal rather
 * than localized: this is a model-facing JSON field, not UI copy.
 *
 * @complexity O(1) — one map lookup.
 */
function resolveActorDisplay(item: TrashItem, usernameByPrincipalId: ReadonlyMap<string, string>): string {
  const username = usernameByPrincipalId.get(item.actorPrincipalId);
  const human = username ?? (item.actorPrincipalId === SYSTEM_ACTOR_PRINCIPAL_ID ? "system" : "deleted user");
  return item.actorPluginId != null ? `${human} + AI` : human;
}

/**
 * One `userRepo.list` call per `trash_list_items` invocation, not one lookup per row — mirrors
 * the host admin Trash list route's username lookup exactly (same "workspace's user count is
 * already assumed small enough for one in-memory pass" reasoning).
 *
 * @complexity O(u) in the workspace's user count, once per call.
 */
async function loadUsernamesByPrincipalId(deps: TrashPackageToolDeps): Promise<ReadonlyMap<string, string>> {
  const users = await deps.userRepo.list({ workspaceId: deps.workspaceId });
  return new Map(users.map((user) => [user.principalId, user.username]));
}

/** Model-facing row. Drops `workspaceId` because every call is already scoped to one.
 *  Exposes the row's id as `trashItemId` for `trash_purge_item`; `trash_restore_item` still takes
 *  the entity's id as `entityId`. */
function toTrashToolView({ item, now, usernameByPrincipalId, daysRemaining }: { item: TrashItem; now: string; usernameByPrincipalId: ReadonlyMap<string, string>; daysRemaining: TrashToolPolicy["daysRemaining"] }, _optional = {}) {
  return {
    trashItemId: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    title: item.displayTitle,
    subtitle: item.displaySubtitle,
    deletedAt: item.trashedAt,
    deletedBy: resolveActorDisplay(item, usernameByPrincipalId),
    permanentlyRemovedAfter: item.purgeAfter,
    daysRemaining: daysRemaining({ now, until: item.purgeAfter }),
  };
}

/**
 * Trash's independent classification of what its own handlers do, compared for equality against
 * the catalog's self-declaration at build time (`assertToolIsWirable`).
 *
 * `purgeSelected` appears in neither map in this listing/restoration contributor, so no id an edit could
 * add here that would wire it by accident — it would have to add a catalog entry and a handler too.
 */
export const trashDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // `TrashPort.list` is a single indexed read of the trash index. It touches no entity at all.
  ["trash_list_items", "none"],
  // Clears the domain marker and drops the index row. Reversible by deleting the item again, so
  // `mutates-durable-state` rather than `deletes-durable-state`: nothing is removed.
  ["trash_restore_item", "mutates-durable-state"],
]);

/** What each handler factory receives (neither handler opens a dialog, so no surface store). */
interface TrashHandlerArgs {
  deps: TrashPackageToolDeps;
}

/**
 * One page of the Trash, filtered to the kinds this principal could restore.
 *
 * The filter runs AFTER the page is fetched rather than as a narrowed `entityTypes` argument,
 * so a page can come back short. That is the honest shape: `nextCursor` still points at the
 * next row in the real keyset, and hiding rows by shrinking the query would make the cursor
 * skip rows the caller IS allowed to see when their permissions change mid-scan.
 */
const trashListItemsHandler = ({ deps }: TrashHandlerArgs): ToolHandler => async (ctx) => {
  const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: deps.trashPolicy.readPermission });

  const requested = readEntityTypes(input);
  const limit = readToolLimit({ input, max: MAX_LIST_LIMIT, fallback: DEFAULT_LIST_LIMIT });
  const now = deps.clock.nowIso();

  const page = await deps.trash.list({
    workspaceId: deps.workspaceId,
    now,
    limit      }, {
    ...(requested === undefined ? {} : { entityTypes: requested }),
    cursor: optionalString({ input: input, key: "cursor" }) ?? null      });

  const visible = await deps.trashPolicy.filterVisible({ principalId: ctx.principal.id, items: page.items });
  // Skip the lookup on an empty page — nothing visible to this principal, or the Trash truly is
  // empty — same as the host admin Trash list route.
  const usernameByPrincipalId =
    visible.length > 0 ? await loadUsernamesByPrincipalId(deps) : new Map<string, string>();
  return {
    items: visible.map((item) => toTrashToolView({ item, now, usernameByPrincipalId, daysRemaining: deps.trashPolicy.daysRemaining })),
    nextCursor: page.nextCursor,
  };
};

/**
 * Undoes one delete.
 *
 * No confirmation dialog, deliberately: unlike every delete tool, restoring destroys nothing
 * and is itself undone by deleting the item again. Gating it behind a human dialog would make
 * recovering from a mistaken delete harder than making one.
 */
const trashRestoreItemHandler = ({ deps }: TrashHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const entityType = requireString({ input: input, key: "entityType" });
  const entityId = requireString({ input: input, key: "entityId" });

  const permission = deps.trashPolicy.permissionFor(entityType);
  if (!permission) {
    throw new ToolInputError({ message: `trash_restore_item: '${entityType}' is not a kind the Trash can restore. Expected one of: ` +
      `${deps.trashPolicy.messageKinds().join(", ") }.` });
  }
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission }, { entityType, entityId });

  ctx.signal.throwIfAborted();
  const outcome = await deps.trash.restore({
    workspaceId: deps.workspaceId,
    entityType,
    entityId,
    at: deps.clock.nowIso()      }, {
    // Same `principalId` shape the host admin restore route passes, plus
    // `pluginId`: this call always came in through an agent tool, not a human clicking Restore,
    // so whatever an adapter's `restore` records as the actor should say so — same "+ AI"
    // convention `resolveActorDisplay` (above) applies to a trash-side `actorPluginId`.
    actor: { principalId: ctx.principal.id, pluginId: "assistant" }      });
  return outcome === "restored"
    ? { restored: true, entityType, entityId }
    : { restored: false, reason: outcome, entityType, entityId, note: RESTORE_FAILURE_NOTES[outcome] };
};

/**
 * Builds Trash's registrations without the host's tool metadata.
 *
 * @param deps the package-side slice above, policy included.
 * @returns the two registrations. Never a third.
 * @complexity O(k) in the kind count, to build the catalog's enum.
 */
export function buildTrashToolRegistrations({ deps }: { deps: TrashPackageToolDeps }, _optional = {}): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    trash_list_items: trashListItemsHandler({ deps }),
    trash_restore_item: trashRestoreItemHandler({ deps }),
  };

  // Built per call, from the kinds the host policy lists this call — a module-level
  // catalog would freeze the published entityType enum at whatever the host's registry held when
  // this file first loaded, before a later-registered kind (its "resolved at call time" rule)
  // could ever reach it.
  const catalog = indexCatalogById({ catalog: buildTrashAgentToolCatalog(deps.trashPolicy.catalogKinds()) });

  return buildDomainRegistrations({
    domain: "trash",
    catalogModule: "trash/agent-tools.ts",
    catalog,
    handlers,
    derivedRisk: trashDerivedRisk,
  });
}

/** What each non-`restored` outcome means, in the words a model should relay rather than re-guess. */
const RESTORE_FAILURE_NOTES: Record<string, string> = {
  "not-found": "That item is not in the Trash. It may have been restored already, or permanently removed.",
  "version-changed": "The item changed since it was deleted, so nothing was touched. Read it again and retry.",
  "adapter-unavailable":
    "The plugin that owns this kind of item is no longer installed, so it cannot be restored until it is reinstalled. It is still listed.",
};

/** Reads and validates the optional `entityTypes` filter. @complexity O(n) in the filter's length. */
function readEntityTypes(input: Record<string, unknown>): TrashEntityType[] | undefined {
  const raw = input.entityTypes;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) {
    throw new ToolInputError({ message: "trash_list_items: 'entityTypes' must be an array of strings when it is given." });
  }
  return raw as TrashEntityType[];
}

