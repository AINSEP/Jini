/**
 * @file `trash_item` — one generic "move this to the Trash" tool, built as a fifth DOOR onto the four
 * per-domain delete tools rather than a fifth PATH around them.
 *
 * Read this before touching it. The tool was first rejected (see `agent-tools.ts`'s header history)
 * because a generic `trash_item(entityType, entityId)` looked like a way past the four gates
 * `content_post_delete`, `comments_trash_comment`, `media_trash_asset` and `redirects_tombstone`
 * each carry. The owner asked for it anyway, so it is built so that none of those gates can be
 * skipped:
 *
 *  - **It writes nothing itself.** After resolving the row it invokes that kind's own, ALREADY-BUILT
 *    delete handler, unchanged — so the domain's own permission check
 *    and its own write path all run exactly as they do when the model calls that tool by name.
 *    Calling `TrashPort.trash` directly instead would have looked equivalent and been a regression:
 *    the domain paths also append the post revision, write the comment moderation log, run comment
 *    status hooks and emit `entry.unpublished` (SEO's sitemap invalidation) in the same transaction
 *    as the marker and the index row. A direct call would silently skip all of that.
 *  - **The permission comes from the delegate, never from a Trash-wide map.**
 *    `TRASH_PERMISSION_BY_ENTITY_TYPE` gates *restoring* a comment on `comments.moderate`, but
 *    *trashing* one needs `comments.delete`. Reusing that map here would have made this tool weaker
 *    than the one it sits beside.
 *  - **Kind and table cannot diverge.** The model-supplied `entityType` selects ONE delegate, and
 *    both the permission pre-checked here and every read and write after it are that delegate's,
 *    against that kind's own table. Naming `comment` for a post's id reads the comments table,
 *    finds nothing, and stops, so there is no row whose real kind differs from the one that was
 *    authorized. The purge route needs `authorizeItem` because it addresses a trash row by its OWN
 *    id, and the stored row carries a kind the request never states. Here the request names the
 *    kind, and it is the only kind ever touched.
 *
 * Why this is a post-processing pass (like `assistant/content-read-tool.ts`) and not a
 * `ToolContributor`: it needs the four delegates' built handlers, which exist only once every
 * contributor has run. `buildAssistantToolRegistrations` calls {@link deriveTrashItemRegistrations}
 * after that loop.
 *
 * It holds no `TrashPort` at all, so it has no route to the Trash's permanent-delete operation. The
 * test file proves that behaviorally rather than leaving it to this sentence.
 */

import {
  buildDomainRegistrations,
  indexCatalogById,
  requireInputRecord,
  requireString,
  type AgentToolSideEffect,
  type ToolHandler,
  type ToolRegistration,
  type AgentToolDefinition,
  type ToolMetadataById,
} from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/args.js";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
// `ToolInputError` so a refusal reaches the model with its message intact rather than as a redacted
// 500 — see `features/comments/tool-registrations.ts`'s identical import.
import { ToolInputError } from "@jini-ai/core";
import type { TrashActor, TrashEntityType } from "./ports.js";
import type { TrashEntry, TrashRegistry } from "./registry-types.js";
import type { TrashPort } from "./ports.js";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { readLiveSnapshot } from "./sql/entry-sql.js";
import type { moveToTrash } from "./site/move-to-trash.js";

export const TRASH_ITEM_TOOL_ID = "trash_item";

/**
 * The slice of the route-deps bag `trash_item` reads. Structural, like `TrashToolDeps`, so this
 * module has no back-edge into the composition root.
 */
export interface TrashItemToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  /** Membership in the live adapter map, read on every call. */
  isTrashableEntityType(required: { entityType: TrashEntityType }, optional?: Record<string, never>): boolean;
  registry: TrashRegistry;
  delegates: ReadonlyMap<TrashEntityType, TrashItemDelegate>;
  readLiveVersion(required: { entry: TrashEntry; workspaceId: string; entityId: string }): Promise<{ version: number | null } | null>;
  /** Bound host mover reauthorizes, rereads and compares before the atomic marker write. */
  moveToTrash(required: {
    workspaceId: string; entityType: TrashEntityType; entityId: string; actor: TrashActor;
    expectedVersion?: number | null | undefined;
  }): Promise<{ ok: true; version: number | null } | { ok: false; reason: string; permission?: string; code?: string; count?: number }>;
  actorPluginId: string;
  userKind: TrashEntityType;
  presentation: Parameters<typeof buildTrashItemAgentToolCatalog>[0]["presentation"];
  metadata: ToolMetadataById;
}

/**
 * One kind `trash_item` accepts, and the delete tool it routes to.
 *
 * `permission` is that tool's declared gate, checked HERE before any read, so a principal who could
 * not call the delegate learns nothing about whether the row exists and never has a dialog raised
 * for them. The delegate checks again itself (the same redundant-but-harmless pre-check
 * `media_trash_asset`'s wrapper makes). `assistant/__tests__/tool-registrations.trash-item.test.ts`
 * pins every entry to its delegate's own catalog declaration.
 */
export interface TrashItemDelegate {
  readonly entityType: TrashEntityType;
  readonly toolId: string;
  readonly permission: string;
  /**
   * Builds the delegate's own input from the entity id, reading that kind's OWN table where the
   * delegate needs a field the model does not hold. `null` = no such row of this kind.
   */
  toDelegateInput(required: { entityId: string }): Promise<Record<string, unknown> | null>;
}

/**
 * Moves one user (or API-key principal) to the Trash. Bound at composition to the SAME `trashUser`
 * the admin `DELETE users/:principalId` route calls (`server/runtime/composition/trash-user-tool-port.ts`),
 * so its owner/built-in-admin caller gate, self/seeded-owner/last-owner refusals and idempotent
 * "already in Trash" no-op all apply unchanged. A port, not an import: `trashUser` lives in
 * `features/identity` and needs the identity repo bag, which this feature never holds.
 *
 * `user` is a bespoke Trash adapter, not a `TRASHABLE` registry entry (see `adapters/user.ts`), so
 * the generic `moveToTrash` path cannot reach it, and there is no per-domain trash tool to delegate
 * to either: the identity catalog is package-owned and has only the permanent `identity_user_delete`.
 * Refusals are thrown as `ToolInputError` by the binder, already worded for the model.
 */
export type TrashUserPort = (required: { principalId: string; callerPrincipalId: string }) => Promise<{ noop: boolean }>;

/**
 * `trash_item`'s catalog entry, with `entityType`'s enum limited to `reachableKinds`.
 *
 * The one source of the entry: {@link buildTrashItemAgentToolCatalog} (the declared side the assistant
 * contract tests compare against) and {@link deriveTrashItemRegistrations} (the published descriptor)
 * both build it here, so the two cannot drift apart.
 *
 * @complexity O(k + a*k) for k reachable kinds and a host aliases; O(k + a) output space.
 */
function trashItemToolDefinition(
  { kinds, presentation }: Parameters<typeof buildTrashItemAgentToolCatalog>[0],
  _optional = {},
): AgentToolDefinition {
  return {
    name: TRASH_ITEM_TOOL_ID,
    description: presentation.description,
    // The strongest delegate classification: this tool can reach every bound delegate.
    sideEffects: "deletes-durable-state",
    // The floor only; the handler checks the selected delegate's own permission.
    authorization: { permission: presentation.floorPermission },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "entityId"],
      properties: {
        entityType: {
          type: "string",
          enum: [...kinds, ...[...presentation.aliases].filter(([, target]) => kinds.includes(target)).map(([alias]) => alias)],
          aliases: ["kind"],
          description: presentation.entityTypeDescription,
        },
        entityId: { type: "string", minLength: 1, description: presentation.entityIdDescription },
      },
    },
  };
}

/**
 * `trash_item`'s declared catalog: one entry, the kinds supplied by the host. The derived catalog uses the
 * reachable delegate and registry kinds, then the user kind when the host binds {@link TrashUserPort}.
 *
 * Deliberately NOT part of the listing/restoration catalog. That catalog is proven to hold exactly two
 * tools by `__tests__/tool-registrations.purge-ban.test.ts`, and this tool is built by a
 * post-processing pass, not by the trash contributor.
 *
 * @complexity O(k + a*k), inherited from the definition's alias membership checks.
 */
export function buildTrashItemAgentToolCatalog(
  required: {
    kinds: readonly TrashEntityType[];
    presentation: {
      description: string;
      entityTypeDescription: string;
      entityIdDescription: string;
      floorPermission: string;
      aliases: ReadonlyMap<string, TrashEntityType>;
    };
  },
  _optional = {},
): readonly AgentToolDefinition[] {
  return [trashItemToolDefinition(required)];
}

/**
 * The wiring layer's own classification of `trash_item`, separate from its catalog entry's
 * `sideEffects`. Exported so `assistant/tool-registrations.ts` can fold it into the assistant-wide
 * risk map as well: without that, the whole-surface cross-check (`assertRiskMetadataIsWirable`) would
 * treat this wired tool as unclassified.
 */
export const trashItemDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // Routes into `content_post_delete` (`deletes-durable-state`) among others; see the catalog entry.
  [TRASH_ITEM_TOOL_ID, "deletes-durable-state"],
]);

/**
 * Maps one non-ok host move outcome to the `ToolInputError` the generic path throws.
 *
 * The default preserves new host refusal reasons, including a blocker code, instead of
 * returning an undefined message when the host adds a reason.
 *
 * Exported so each reason's message is asserted directly: the generic handler only reaches the
 * non-`not-found` reasons through races (a version bump, a revoked grant) a tool test cannot stage.
 *
 * @complexity O(1).
 */
export function moveToTrashOutcomeToError({ entityType, entityId, outcome }: { entityType: TrashEntityType; entityId: string; outcome: Extract<Awaited<ReturnType<TrashItemToolDeps["moveToTrash"]>>, { ok: false }> }, _optional = {}): ToolInputError {
  switch (outcome.reason) {
    case "not-found":
      return new ToolInputError({ message: `trash_item: ${entityType} '${entityId}' was not found. Nothing was changed.` });
    case "forbidden":
      return new ToolInputError({ message: `trash_item: not authorized for '${outcome.permission}'. Nothing was changed.` });
    case "version-changed":
      return new ToolInputError({ message: `trash_item: ${entityType} '${entityId}' changed during removal. Reload and try again. Nothing was changed.` });
    case "unknown-type":
      return new ToolInputError({ message: `trash_item: '${entityType}' is not a kind of thing the Trash can hold. Nothing was changed.` });
    default: {
      const fallback = outcome as { reason: string; code?: string };
      const code = fallback.code ? ` (${fallback.code})` : "";
      return new ToolInputError({ message: `trash_item: could not move ${entityType} '${entityId}' to the Trash: ${fallback.reason}${code}. Nothing was changed.` });
    }
  }
}

/**
 * Builds the ONE handler for a GENERIC `TRASHABLE` kind (no bespoke delegate): pre-checks the
 * registry entry's own permission, reads its live display (not-found -> `ToolInputError`), then
 * immediately calls `moveToTrash` — never
 * `TrashPort.trash` directly, so this stays the same single chokepoint `POST /trash/items` calls.
 *
 * @complexity O(1) plus the registry adapter read and removal.
 */
function buildGenericTrashHandler(spec: { entityType: TrashEntityType; entry: TrashEntry; routeDeps: TrashItemToolDeps }, _optional = {}): ToolHandler {
  const { entityType, entry, routeDeps } = spec;
  return async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const entityId = requireString({ input: input, key: "entityId" });

    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: entry.permission }, { entityType, entityId });

    /**
     * Reads the live display + version for one GENERIC `TRASHABLE` entity (no bespoke delegate) — the
     * SAME column-only query (`entry-sql.ts`'s `readLiveSnapshot`) `moveToTrash` runs right before it
     * calls `TrashPort.trash`; this tool reads it first for the same version check. `notTrashed` excludes a row already in the Trash, same as `moveToTrash`'s own not-found
     * reading — a caller cannot re-trash what already looks gone from its own point of view.
     *
     * @complexity O(1): one indexed row read.
     */
    const snapshot = await routeDeps.readLiveVersion({ entry, workspaceId: routeDeps.workspaceId, entityId });
    if (!snapshot) {
      throw new ToolInputError({ message: `trash_item: ${entityType} '${entityId}' was not found. Nothing was changed.` });
    }

    const actor: TrashActor = { principalId: ctx.principal.id, pluginId: routeDeps.actorPluginId };
    const moved = await routeDeps.moveToTrash({ workspaceId: routeDeps.workspaceId, entityType, entityId, actor, expectedVersion: snapshot.version ?? undefined });
    if (!moved.ok) throw moveToTrashOutcomeToError({ entityType, entityId, outcome: moved });
    return { entityType, entityId, via: "moveToTrash", outcome: { trashed: true, cancelled: false, version: moved.version } };

  };
}

/**
 * Builds the handler for one bespoke-delegate kind: pre-checks the delegate's own permission, resolves
 * the delegate's input from that kind's own table (not-found -> `ToolInputError`), then runs the
 * delegate's ALREADY-BUILT handler unchanged.
 *
 * @complexity O(1) plus the delegate's own resolve read and write.
 */
function buildDelegateTrashHandler(spec: { delegate: TrashItemDelegate; delegateHandler: ToolHandler; routeDeps: TrashItemToolDeps }, _optional = {}): ToolHandler {
  const { delegate, delegateHandler, routeDeps } = spec;
  const entityType = delegate.entityType;
  return async (ctx, options = {}) => {
    const input = requireInputRecord({ input: ctx.input });
    const entityId = requireString({ input: input, key: "entityId" });
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: delegate.permission }, { entityType, entityId });

    const delegateInput = await delegate.toDelegateInput({ entityId });
    if (!delegateInput) {
      throw new ToolInputError({ message: `trash_item: ${entityType} '${entityId}' was not found. Nothing was changed.` });
    }

    // The same `ctx` preserves the caller, signal and audit identity,
    // with only the input swapped for the delegate's own shape. Forward the interactive
    // options too, so a delegate that asks the human retains its confirmation channel.
    const outcome = await delegateHandler({ ...ctx, input: delegateInput }, options);
    return { entityType, entityId, via: delegate.toolId, outcome };
  };
}

/**
 * Builds the handler for `user`: hands the id and the calling principal to {@link TrashUserPort}.
 * No permission pre-check here — `trashUser`'s own caller gate (owner or built-in `admin` role, by
 * role name, never a grant) is the gate, and the Trash's `user -> "*"` restore permission would wrongly
 * refuse the built-in admin it allows.
 *
 * @complexity O(1) plus `trashUser`'s own cost (O(n) in principals for its owner-count guard).
 */
function buildUserTrashHandler({ trashUser, userKind }: { trashUser: TrashUserPort; userKind: TrashEntityType }, _optional = {}): ToolHandler {
  return async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const entityId = requireString({ input: input, key: "entityId" });
    const { noop } = await trashUser({ principalId: entityId, callerPrincipalId: ctx.principal.id });
    return { entityType: userKind, entityId, via: "trashUser", outcome: { trashed: true, cancelled: false, alreadyInTrash: noop } };
  };
}

/** Index only delegates whose existing delete handlers are present in this composition. */
function buildDelegateTrashHandlers(required: {
  registrations: readonly ToolRegistration[];
  delegates: ReadonlyMap<TrashEntityType, TrashItemDelegate>;
  routeDeps: TrashItemToolDeps;
}, _options: Record<string, never> = {}): Map<TrashEntityType, ToolHandler> {
  const { delegates, routeDeps } = required;
  const registered = new Map(required.registrations.map((registration) => [registration.descriptor.id, registration.handler]));
  const handlerByEntityType = new Map<TrashEntityType, ToolHandler>();
  for (const delegate of delegates.values()) {
    const delegateHandler = registered.get(delegate.toolId);
    if (delegateHandler) handlerByEntityType.set(delegate.entityType, buildDelegateTrashHandler({ delegate, delegateHandler, routeDeps }));
  }
  return handlerByEntityType;
}

/**
 * Builds the `trash_item` registration over the already-built registration list.
 *
 * @param required.registrations every registration `buildAssistantToolRegistrations`' contributor
 *        loop produced. Each delegate's handler is taken from here and reused unchanged.
 * @param required.deps the bound delegates, live reads, mover and host policy for these registrations.
 * @param optional.trashUser makes `user` an accepted kind; absent = `user` is not accepted.
 * @returns one registration, or none when neither a delegate's tool nor any registry entry is
 *          reachable. A list so the caller appends it the way it appends
 *          `deriveContentReadRegistrations`' output.
 * @complexity O(r + k) to index the registrations and the registry; each call is O(1) plus one row
 *             read for a delegate kind that resolves, or one row read and removal for a generic kind.
 *
 * A kind with neither a registered delegate nor a registry entry is left out of the schema.
 * Live adapter membership is checked again on invocation and in the refusal's "Expected one of".
 * Deliberately not a throw during derivation: many compositions
 * (and most tests) build a catalog without every domain, and failing the whole assistant catalog
 * because one domain is absent would take every other tool down with it.
 */
// One handler per accepted kind, in model-visible order: delegates, generic registry kinds, user.
// Read the registry at derivation time so a newly registered kind requires no tool-code edit.
export function deriveTrashItemRegistrations(
  { registrations, deps }: { registrations: readonly ToolRegistration[]; deps: TrashItemToolDeps },
  { trashUser }: { trashUser?: TrashUserPort } = {},
): ToolRegistration[] {
  const handlerByEntityType = buildDelegateTrashHandlers({ registrations, delegates: deps.delegates, routeDeps: deps });
  for (const [entityType, entry] of deps.registry) {
    if (!handlerByEntityType.has(entityType)) handlerByEntityType.set(entityType, buildGenericTrashHandler({ entityType, entry, routeDeps: deps }));
  }
  if (trashUser && !handlerByEntityType.has(deps.userKind)) {
    handlerByEntityType.set(deps.userKind, buildUserTrashHandler({ trashUser, userKind: deps.userKind }));
  }
  if (handlerByEntityType.size === 0) return [];
  const reachableKinds = [...handlerByEntityType.keys()];
  const handlers: Record<string, ToolHandler> = {
    trash_item: async (ctx, options = {}) => {
      const input = requireInputRecord({ input: ctx.input });
      const requestedType = requireString({ input, key: "entityType" });
      // Aliases retain their existing storage/trash owner, including its revisions and hooks.
      const entityType = deps.presentation.aliases.get(requestedType) ?? requestedType;
      // Against the live adapter map on every call, never a captured membership list.
      const kindHandler = handlerByEntityType.get(entityType);
      if (kindHandler && deps.isTrashableEntityType({ entityType })) return kindHandler({ ...ctx, input: { ...input, entityType } }, options);
      requireString({ input, key: "entityId" });
      const accepted = reachableKinds.filter((kind) => deps.isTrashableEntityType({ entityType: kind }));
      throw new ToolInputError({ message: `trash_item: '${entityType}' is not a kind of thing the Trash can hold. Expected one of: ${accepted.join(", ")}. ` +
          "Nothing was changed." });
    },
  };
  return buildDomainRegistrations({ metadata: deps.metadata,
    domain: "trash-item",
    catalogModule: "trash/trash-item-tool.ts",
    catalog: indexCatalogById({ catalog: buildTrashItemAgentToolCatalog({ kinds: reachableKinds, presentation: deps.presentation }) }),
    handlers,
    derivedRisk: trashItemDerivedRisk,
  });
}

export function bindTrashItemTool(required: {
  kinds: Record<"post" | "comment" | "media" | "redirect" | "widget" | "theme" | "user", string>; delegates: ReadonlyMap<string, Omit<TrashItemDelegate, "toDelegateInput">>;
  actorPluginId: string; presentation: TrashItemToolDeps["presentation"]; metadata: ToolMetadataById; moveToTrash: typeof moveToTrash;
  readLiveSnapshot(input: Parameters<typeof readLiveSnapshot>[0], deps: { kernel: StorageKernel<unknown, unknown>; registry: TrashRegistry }): ReturnType<typeof readLiveSnapshot>;
}, _optional: Record<string, never> = {}) {
  const inputFactories = new Map<string, (required: { deps: { workspaceId: string; postRepo: { findById(required: { workspaceId: string; id: string }): Promise<{ kind: string } | null> }; commentRepo: { findById(required: { workspaceId: string; id: string }): Promise<{ version: number } | null> }; commentsReady: Promise<unknown> }; entityId: string }) => Promise<Record<string, unknown> | null>>([
    [required.kinds.post, async ({ deps, entityId }) => {
      // The row's own `kind`, so a page is deleted as a page and the delegate's kind guard applies.
      const row = await deps.postRepo.findById({ workspaceId: deps.workspaceId, id: entityId });
      // Templates use the Post storage/trash owner; never hand an unsupported editor kind to its tool.
      return row ? { id: entityId, kind: row.kind === "email-template" ? "post" : row.kind } : null;
    }],
    // The delegate requires `expectedVersion`. The version read here is the one the dialog is shown
    // against; if the comment moves before the human confirms, `applyModeration` refuses.
    [required.kinds.comment, async ({ deps, entityId }) => {
      await deps.commentsReady;
      const row = await deps.commentRepo.findById({ workspaceId: deps.workspaceId, id: entityId });
      return row ? { commentId: entityId, expectedVersion: row.version } : null;
    }],
    // The delegate reads the row itself (after its own permission check), so there is nothing to
    // resolve here.
    [required.kinds.media, async ({ deps: _deps, entityId }) => { return { mediaId: entityId }; }],
    [required.kinds.redirect, async ({ deps: _deps, entityId }) => { return { id: entityId }; }],
    // No resolve needed, same as media/redirect above — `widgets_trash_instance`'s own read
    // (a raw `entryRepo.findById`, no payload parse) resolves not-found itself.
    [required.kinds.widget, async ({ deps: _deps, entityId }) => { return { widgetInstanceId: entityId }; }],
    // The theme id IS the entity id; `theme_trash` resolves it against the live registry and owns
    // the active-theme refusal, so nothing is read here.
    [required.kinds.theme, async ({ deps: _deps, entityId }) => { return { themeId: entityId }; }],
  ]);
  const TRASH_ITEM_DELEGATES = new Map([...required.delegates].map(([entityType, delegate]) => [entityType, { ...delegate, toDelegateInput: inputFactories.get(entityType)! }]));
  return { TRASH_ITEM_DELEGATES,
    getTrashItemAgentToolCatalog: () => buildTrashItemAgentToolCatalog({ kinds: [...TRASH_ITEM_DELEGATES.keys(), required.kinds.user], presentation: required.presentation }),
    deriveTrashItemRegistrations: (input: { registrations: readonly ToolRegistration[]; routeDeps: Omit<TrashItemToolDeps, "delegates" | "readLiveVersion" | "moveToTrash" | "actorPluginId" | "userKind" | "presentation" | "metadata"> & Parameters<NonNullable<ReturnType<typeof TRASH_ITEM_DELEGATES.get>>["toDelegateInput"]>[0]["deps"] & { db: StorageKernel<unknown, unknown>; trash: TrashPort; clock: { nowIso(): string } } }, optional: { delegates?: ReadonlyMap<TrashEntityType, NonNullable<ReturnType<typeof TRASH_ITEM_DELEGATES.get>>>; trashUser?: TrashUserPort } = {}) => {
      const { routeDeps } = input;
      // `?? []`: `registry` is typed as required, but plenty of existing test fixtures build a
      // `RouteDeps` double with `as unknown as RouteDeps` and never set it — same "many compositions
      // build a catalog without every domain" reality the comment above already accepts for
      // `isTrashableEntityType`. A missing registry degrades to "no generic kinds," not a crash that
      // takes the whole assistant catalog down with it.
      return deriveTrashItemRegistrations({ registrations: input.registrations, deps: { ...routeDeps, registry: routeDeps.registry ?? new Map(),
        delegates: new Map([...(optional.delegates ?? TRASH_ITEM_DELEGATES)].map(([entityType, delegate]) => [entityType, { ...delegate, toDelegateInput: ({ entityId }: { entityId: string }) => delegate.toDelegateInput({ deps: routeDeps, entityId }) }])),
        // The snapshot's `version` is optional (entries without one); the port wants it explicit.
        readLiveVersion: async (input) => { const row = await required.readLiveSnapshot(input, { kernel: routeDeps.db, registry: routeDeps.registry }); return row && { version: row.version ?? null }; },
        moveToTrash: (input) => required.moveToTrash(input, { registry: routeDeps.registry, trash: routeDeps.trash, authorize: routeDeps.authorize, clock: routeDeps.clock, readLiveSnapshot: input => required.readLiveSnapshot(input, { kernel: routeDeps.db, registry: routeDeps.registry }) }),
        actorPluginId: required.actorPluginId, userKind: required.kinds.user, presentation: required.presentation, metadata: required.metadata,
      } }, { trashUser: optional.trashUser });
    },
  };
}
