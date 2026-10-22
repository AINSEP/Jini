/**
 * @file `withFollowUps` — lets one Trash type finish a hide, restore or purge its own generic marker
 * flip cannot express, without teaching the generic table adapter anything about that type. T1's
 * generalization of the A0 `withRestoreFollowUp` sketch (plan §2 T1 item 6) into one decorator with
 * three optional hooks, so T5/T6 (menus, terms, taxonomies) register their own event/revision
 * follow-ups the same way `widget` already does, rather than each writing a bespoke wrapper.
 *
 * Every hook:
 *  - runs inside the op's own transaction — `TrashPort.trash`/`restore`/`purgeSelected` (`write-
 *    service.ts`) already wrap the adapter call in `deps.transaction`, and this decorator's hooks run
 *    from inside that same call, so a hook backed by the same host database connection
 *    joins it automatically (the transaction runner must be reentrant);
 *  - runs only on an OK/`"purged"` result that actually changed something — a no-op outcome
 *    (`not-found`, `version-changed`, `blocked`, `already-gone`) never fires one, because nothing
 *    changed, and neither does `hide`/`unhide`'s own idempotent "already in the target state" branch,
 *    which also reports `ok: true` with no transition; `TrashMarkerResult.noop` (`ports.ts`) is what
 *    tells that branch apart from a real one, since both otherwise share the same `ok: true` shape
 *    (T1c, `follow-ups.test.ts` — the two were conflated here until that dispatch's direct test of
 *    this file caught it: a re-hide/re-unhide of an already-trashed/already-live row used to refire
 *    the hook);
 *  - propagates a throw, which rolls the whole op back (the state change and the hook are one unit).
 *
 * `afterPurge` is paired with `beforePurge`: the row is gone the instant `purge` reports `"purged"`
 * (a DELETE is visible to later reads in the SAME transaction even before COMMIT), so anything a
 * purge hook needs to see about the row's pre-purge state (a taxonomy revision's
 * `previousStateJson`) has to be read BEFORE the delete runs. `beforePurge`'s return value is handed
 * back to `afterPurge` untouched — this file never interprets it, keeping every hook's own shape a
 * type-specific concern for its host composition, not for this shared service.
 */
import type { TrashAdapter, TrashPurgeOutcome } from "./ports.js";

/** Finishes one hide. Only fires when `hide` actually transitioned the row (never on the idempotent
 *  "already trashed" branch, and never when `hide` returned `blocked`/`not-found`/`version-changed`). */
export type HideFollowUp = (required: { workspaceId: string; entityId: string; at: string; }) => Promise<void>;

/** Finishes one restore. Receives the Trash row's stored `priorMarker`; never called without one —
 *  same contract the A0 `RestoreFollowUp` (widget adoption) already relied on. */
export type UnhideFollowUp = (required: {
  workspaceId: string;
  entityId: string;
  priorMarker: string;
  at: string;
}) => Promise<void>;

/** Reads whatever "prior state" a purge follow-up needs, before the row is deleted. Runs even when
 *  the purge that follows turns out NOT to succeed (a version race) — it is a read, not a write, so
 *  that costs nothing beyond one extra query on an already-rare path. */
export type BeforePurge = (required: { workspaceId: string; entityId: string; }) => Promise<unknown>;

/** Finishes one purge. `priorState` is exactly what `beforePurge` returned (`undefined` when the
 *  caller registered no `beforePurge`). Fires only on a `"purged"` outcome. */
export type AfterPurge = (required: { workspaceId: string; entityId: string; priorState: unknown; }) => Promise<void>;

export interface TrashFollowUpHooks {
  afterHide?: HideFollowUp;
  afterUnhide?: UnhideFollowUp;
  beforePurge?: BeforePurge;
  afterPurge?: AfterPurge;
}

/**
 * Wraps `adapter` so its `hide`/`unhide`/`purge` also run whichever of `hooks`'s optional callbacks
 * applies, per the OK/success rule in the file header. An entry with no hooks at all should not call
 * this — host composition only wraps entries that have at least one.
 *
 * @complexity O(1) beyond the adapter's own methods and whichever hook fires.
 */
export function withFollowUps(required: { adapter: TrashAdapter; }, hooks: TrashFollowUpHooks = {}): TrashAdapter {
  const { adapter } = required;
  return {
    entityType: adapter.entityType,

    async hide(hideRequired, hideOptional) {
      const result = await adapter.hide(hideRequired, hideOptional);

      // Idempotent flips also report ok:true; noop is the signal that no transition occurred.
      if (result.ok && !result.noop && hooks.afterHide) {
        await hooks.afterHide({ workspaceId: hideRequired.workspaceId, entityId: hideRequired.entityId, at: hideRequired.at });
      }
      return result;
    },

    async unhide(unhideRequired, unhideOptional) {
      const result = await adapter.unhide(unhideRequired, unhideOptional);
      const priorMarker = unhideOptional?.priorMarker;

      // The same noop guard prevents an already-live row from re-firing a restore follow-up.
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
