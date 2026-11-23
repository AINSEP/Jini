// The local trash fork was removed; @jini-ai/cms/trash owns the shared adapter/hooks.
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import type { NavigationEventName, NavMenuChangedPayload, NavMenuEntry } from "../index.js";

/**
 * @file Menu-flavored trash follow-up hooks (T5, plan §3): emits the same
 * `navigation.menu.updated`/`navigation.menu.deleted` events Jini's own `deleteMenu` emits, so a
 * menu moved through the generic trash pipeline is indistinguishable, downstream, from one deleted
 * the old way.
 *
 * The hooks fire with only `{workspaceId, entityId, at}`-shaped payloads — no `slug` — but the
 * outbox event payload needs one. The trap: by `afterHide`/`beforePurge` time the row's `status` is
 * already `'trash'`, so the now-filtered `findById` (see the host's SQLite menu repo) returns `null` and can't
 * supply it — hence `findByIdIncludingTrashed` for both. `afterUnhide` is the one hook where a
 * normal `findById` works: the row is live again by the time it fires.
 */

/** The exact slice `SqliteMenuRepo` (real) and the hermetic in-memory composition twin both satisfy
 *  structurally — this file names no concrete adapter. */
export interface MenuTrashLookup {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<NavMenuEntry | null>;
  findByIdIncludingTrashed(required: { workspaceId: UUID; id: UUID }): Promise<NavMenuEntry | null>;
}

export interface MenuTrashFollowUpDeps {
  menuRepo: MenuTrashLookup;
  outbox: OutboxPort;
  idGen: IdGeneratorPort;
  clock: ClockPort;
}

/** `@jini-ai/cms/trash`'s `TrashFollowUpHooks` shape, declared structurally — no
 *  import of the host's trash feature (domains never import from trash), composed at
 *  the host's composition deps. */
export interface MenuTrashFollowUpHooks {
  afterHide?(required: { workspaceId: string; entityId: string; at: string }): Promise<void>;
  afterUnhide?(required: {
    workspaceId: string;
    entityId: string;
    priorMarker: string;
    at: string;
  }): Promise<void>;
  beforePurge?(required: { workspaceId: string; entityId: string }): Promise<unknown>;
  afterPurge?(required: { workspaceId: string; entityId: string; priorState: unknown }): Promise<void>;
}

/** @complexity O(1): builds one event from an already-loaded menu row. */
function buildEvent(
  { deps, name, workspaceId, menu }: { deps: MenuTrashFollowUpDeps; name: NavigationEventName; workspaceId: UUID; menu: NavMenuEntry },
  _optional = {}
): DomainEvent<NavMenuChangedPayload> {
  const payload: NavMenuChangedPayload = { menuId: menu.id, slug: menu.slug };
  return {
    id: deps.idGen.newId(),
    name,
    occurredAt: clockNowIso({ clock: deps.clock }),
    aggregateId: menu.id,
    workspaceId,
    payload,
  };
}

/**
 * Builds the `TrashFollowUpHooks` for `menu`. Wiring point for the host composition roots'
 * `trashFollowUpHooks.set("menu", ...)` (composition lock).
 * @complexity O(1) per hook: one lookup, at most one outbox enqueue.
 */
export function buildMenuTrashFollowUpHooks(deps: MenuTrashFollowUpDeps): MenuTrashFollowUpHooks {
  // `OutboxPort.enqueue`'s `DomainEvent` parameter defaults its payload generic to
  // `Record<string, unknown>`; a named `interface` payload (`NavMenuChangedPayload`, as opposed to a
  // type alias/object literal) isn't automatically assignable to that without an explicit index
  // signature — same TS quirk documented at Jini `packages/cms/src/redirects/redirects.ts`'s own
  // `outbox.enqueue(event as unknown as DomainEvent)` call, which names this exact payload type as
  // the example. `NavMenuChangedPayload` stays unchanged (owned by Jini), so the widening is a
  // call-site cast, not a payload-type change.
  const enqueue = (event: DomainEvent<NavMenuChangedPayload>) => deps.outbox.enqueue(event as unknown as DomainEvent);
  return {
    afterHide: async ({ workspaceId, entityId }) => {
      const menu = await deps.menuRepo.findByIdIncludingTrashed({ workspaceId, id: entityId });
      if (menu) await enqueue(buildEvent({ deps, name: "navigation.menu.updated", workspaceId, menu }));
    },
    afterUnhide: async ({ workspaceId, entityId }) => {
      const menu = await deps.menuRepo.findById({ workspaceId, id: entityId });
      if (menu) await enqueue(buildEvent({ deps, name: "navigation.menu.updated", workspaceId, menu }));
    },
    beforePurge: ({ workspaceId, entityId }) => deps.menuRepo.findByIdIncludingTrashed({ workspaceId, id: entityId }),
    afterPurge: async ({ workspaceId, priorState }) => {
      const menu = priorState as NavMenuEntry | null;
      if (menu) await enqueue(buildEvent({ deps, name: "navigation.menu.deleted", workspaceId, menu }));
    },
  };
}
