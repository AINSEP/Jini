/** Hooks run inside the calling service transaction. Throws roll back marker and index together. */
import type { TrashAdapter, TrashPurgeOutcome } from "./ports.js";

export type HideFollowUp = (required: { workspaceId: string; entityId: string; at: string }) => Promise<void>;

export type UnhideFollowUp = (required: {
  workspaceId: string;
  entityId: string;
  priorMarker: string;
  at: string;
}) => Promise<void>;

export type BeforePurge = (required: { workspaceId: string; entityId: string }) => Promise<unknown>;

export type AfterPurge = (required: { workspaceId: string; entityId: string; priorState: unknown }) => Promise<void>;

export interface TrashFollowUpHooks {
  afterHide?: HideFollowUp;
  afterUnhide?: UnhideFollowUp;
  beforePurge?: BeforePurge;
  afterPurge?: AfterPurge;
}

export function withFollowUps(required: { adapter: TrashAdapter }, hooks: TrashFollowUpHooks = {}): TrashAdapter {
  const { adapter } = required;
  return {
    entityType: adapter.entityType,

    async hide(hideRequired, hideOptional) {
      const result = await adapter.hide(hideRequired, hideOptional);

      if (result.ok && !result.noop && hooks.afterHide) {
        await hooks.afterHide({ workspaceId: hideRequired.workspaceId, entityId: hideRequired.entityId, at: hideRequired.at });
      }
      return result;
    },

    async unhide(unhideRequired, unhideOptional) {
      const result = await adapter.unhide(unhideRequired, unhideOptional);
      const priorMarker = unhideOptional?.priorMarker;

      if (result.ok && !result.noop && typeof priorMarker === "string" && hooks.afterUnhide) {
        await hooks.afterUnhide({
          workspaceId: unhideRequired.workspaceId,
          entityId: unhideRequired.entityId,
          priorMarker,
          at: unhideRequired.at,
        });
      }
      return result;
    },

    async purge(purgeRequired, purgeOptional): Promise<TrashPurgeOutcome> {
      const priorState = hooks.beforePurge
        ? await hooks.beforePurge({ workspaceId: purgeRequired.workspaceId, entityId: purgeRequired.entityId })
        : undefined;
      const result = await adapter.purge(purgeRequired, purgeOptional);
      if (result === "purged" && hooks.afterPurge) {
        await hooks.afterPurge({ workspaceId: purgeRequired.workspaceId, entityId: purgeRequired.entityId, priorState });
      }
      return result;
    },
  };
}
