import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

import type { EntityReverter, RevertRegistry } from "@jini-ai/core/contracts/site/core-commands";

import { updateMenuTree } from "../index.js";
import type { MenuRepoPort, NavItemNode } from "../index.js";

/**
 * @file Menu-domain entity reverters — R4 of
 * the host's plan-publish-repoint-menus plan (2026-09-24) §2.4/§3. The concrete
 * `menu/update` inverse applier Jini `cms/core/commands/revert.ts`'s generic `RevertRegistry` dispatches to,
 * so a repoint change set (R3's `repointReferences`, in the host's navigation publish contributor) is undoable from History
 * like any other publish write. Mirrors the host's post reverters' shape exactly: adapter code,
 * not core, needing real domain knowledge (`MenuRepoPort`, `updateMenuTree`) `core/commands` must
 * never import.
 *
 * v1 scope: only `menu/update` is registered. R3's `repointReferences` is the only writer that
 * produces a `menu` change set today (`apply()`, S3, has no `executeCommand` wrapping yet — see
 * `publish-content.ts`'s own header — so it records no revertible change set of its own to register
 * a reverter for).
 */

/** Adapters the menu reverter needs to read/restore a menu. */
export interface MenuReverterDeps {
  readonly menuRepo: MenuRepoPort;
  readonly clock: ClockPort;
  readonly idGen: IdGeneratorPort;
  /** `updateMenuTree` requires an `outbox` in its own deps (enqueues `navigation.menu.updated`). */
  readonly outbox: OutboxPort;
}

/**
 * Restores a menu's item tree to the `items` captured before a `menu/update` change set — the only
 * pre-image a repoint's inverse carries (R3's `repointReferences`, `captureInverse: async () =>
 * ({items: <prior items>})`). Writes through `updateMenuTree` (never a raw `menuRepo.save()`),
 * unlike the host's two post reverters: menus have no `content.entry.beforeSave` hook
 * chain to avoid re-firing (this file's header — S3's own doc — records that menus have no real
 * command-gateway write path of their own yet either), so there is no BR-08-shaped reason to bypass
 * the domain function the way post's reverters must.
 *
 * `revertChangeSet` (`@jini-ai/cms/core/commands`) already re-reads {@link currentVersion} and
 * refuses with the standard `RevertConflictError` before this ever runs when the menu has moved on
 * since the change set was applied — this function does not duplicate that guard. `updateMenuTree`'s
 * own OCC check (against the version read immediately below) is therefore a second, redundant-by-
 * construction safety net for the narrow race between `revertChangeSet`'s guard read and this write,
 * not the primary conflict path.
 *
 * @complexity O(1) repo calls plus `updateMenuTree`'s own cost (one read, at most one slug-uniqueness
 * read, one write) — bounded, independent of menu or workspace size.
 */
function createMenuUpdateReverter(deps: MenuReverterDeps): EntityReverter {
  return {
    async currentVersion({ workspaceId, entityId }) {
      const menu = await deps.menuRepo.findById({ workspaceId, id: entityId });
      return menu ? menu.version : null;
    },
    async applyInverse({ workspaceId, item }) {
      const inverse = item.inversePayload as { items: readonly NavItemNode[] } | undefined;
      if (!inverse) {
        throw new Error("menu reverter called without an inverse payload");
      }

      const existing = await deps.menuRepo.findById({ workspaceId, id: item.entityId });
      if (!existing) {
        throw new Error(`menu '${item.entityId}' was not found`);
      }

      await updateMenuTree({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox },
        input: { workspaceId, id: item.entityId, expectedVersion: existing.version, items: inverse.items },
      });
    },
  };
}

/** Builds the `menu/update` reverter, closed over the given adapters. */
export function createMenuReverters(deps: MenuReverterDeps): { update: EntityReverter } {
  return { update: createMenuUpdateReverter(deps) };
}

/**
 * Registers the menu-domain reverter(s) into an existing {@link RevertRegistry} and returns it
 * (mutate-and-return, mirroring `RevertRegistry.register`'s own shape) — composition roots call this
 * wrapped around `createPostRevertRegistry(...)`'s result rather than building a second, separate
 * registry, since `revertChangeSet` is handed exactly one registry per run and dispatches every
 * change-set item (post, menu, …) through it.
 */
export function registerMenuReverters({ registry, deps }: { registry: RevertRegistry; deps: MenuReverterDeps }, _optional: Record<string, never> = {}): RevertRegistry {
  const reverters = createMenuReverters(deps);
  registry.register("menu", "update", reverters.update);
  return registry;
}
