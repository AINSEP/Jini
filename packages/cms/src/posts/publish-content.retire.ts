
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { executeCommand } from "@jini-ai/cms/core";

import { contentHash } from "@jini-ai/cms/publish/content/content-hash";

import { applyRunActor } from "@jini-ai/cms/publish/content/repo-handler";

import type { RetireTarget } from "@jini-ai/cms/publish/content/type-registry";
import type { PackedEntity } from "@jini-ai/cms/publish/transfer";

import { restorePostForward } from "./post-trash.js";
import { retirePostForReplacement } from "./post-retire.js";
import { PostConflictError, PostNotFoundError, ROOT_SLUG, type PostRecord } from "@jini-ai/cms/posts/post";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { packedStateOf, type PublishContentDeps, type PostPorts } from "./publish-content.js";

  /**
   * S4's read half (`publish-overwrite-live-plan-2026-09-24.md` §4/§5) — reports the live row a
   * slug-clash overwrite would retire, or `null` when there is none. Never writes.
   *
   * The three conditions under which there is nothing to retire, matching precheck's own
   * slug-taken branch it is meant to answer for:
   * - the slug is free, or already held by `entity` itself — nothing to overwrite;
   * - `entity.id` already exists at this destination — a same-id collision needs a different remedy
   *   (a kind change, S11) than retiring some unrelated row;
   * - the slug is {@link ROOT_SLUG} — the home page has no other address to move to
   *   ({@link retirePostForReplacement}'s own refusal, mirrored here so the box is never even offered).
   *
   * @complexity O(1) — two indexed repo reads, same as precheck.
   */
  async function planRetire({ deps, postRepo, stateOf, entity }: {
    deps: PublishContentDeps; postRepo: PostPorts["repo"] | undefined;
    stateOf: (row: PostRecord) => ReturnType<typeof packedStateOf>; entity: PackedEntity;
  }): Promise<RetireTarget | null> {
    if (!postRepo) return null;
    const slug = entity.state.slug;
    if (typeof slug !== "string" || slug.length === 0 || slug === ROOT_SLUG) return null;

    const holder = await postRepo.findBySlug({ workspaceId: deps.workspaceId, slug });
    if (!holder || holder.id === entity.id) return null;

    const existingHere = await postRepo.findById({ workspaceId: deps.workspaceId, id: entity.id });
    if (existingHere) return null;

    return {
      entityType: holder.kind,
      entityId: holder.id,
      entityLabel: holder.title,
      hash: contentHash({ entityType: holder.kind, state: await stateOf(holder) }),
    };
  }

  /**
   * S4's write half — retires `target` (moves it to Trash under a renamed slug, never in place)
   * through the same `executeCommand` gateway `apply()` uses, wrapping
   * {@link retirePostForReplacement} exactly the way `routes/pages/delete.ts:46-92` wraps
   * `deletePost`: `operation: "delete"`, inverse is the holder's own prior `deletedAt` — `null` for a
   * live holder, its trash time for one that was already trashed. A revert must put the row back
   * exactly where it was, not always un-trash it: `retirePostForReplacement` only renames an
   * already-trashed holder (its own doc), so a literal `{deletedAt: null}` inverse would un-trash a
   * row the human had trashed before this run ever touched it.
   *
   * `captureInverse` reads `target`'s CURRENT row and closes over it as `holder`; `execute` reuses
   * that same read as `retirePostForReplacement`'s required `expectedVersion`, rather than a second,
   * later read, because `executeCommand` guarantees `captureInverse` resolves before `execute` runs
   * (`core/commands/command.ts`'s own "Order matters: idempotency check -> inverse capture ->
   * execute -> record"). The apply loop (S5) is what re-verifies `target.hash` against a FRESH
   * `planRetire()` immediately before calling this — a holder that changed between plan and apply is
   * caught there, not here.
   *
   * `undo()` restores `holder` forward through {@link restorePostForward} — the same primitive
   * the apply rollback uses — and is also what the gateway's `mutation.rollback` calls on a
   * change-set-record failure, so every path that can need to "put this retire back" restores
   * identically.
   *
   * @complexity O(1) plus `executeCommand`'s own cost, same as `apply()`.
   */
  async function retire({ deps, entityType, postRepo, stateOf, input }: {
    deps: PublishContentDeps; entityType: PostKind; postRepo: PostPorts["repo"] | undefined;
    stateOf: (row: PostRecord) => ReturnType<typeof packedStateOf>;
    input: { target: RetireTarget; principalId: string; idempotencyKey: string };
  }): Promise<{ changeSetId: string; undo(): Promise<void> }> {
    const { changeSets, authorize, outbox } = deps;
    const forgetRemovedPost = deps.ports.post?.forgetRemoved;
    const removePost = deps.ports.post?.remove;
    const missingGateway = !changeSets || !authorize || !outbox;
    if (missingGateway || !postRepo || !forgetRemovedPost || !removePost) {
      throw new Error(
        `publish-content: ${entityType}.retire() requires PublishContentDeps.changeSets/authorize/` +
          "outbox and ports.post.repo/forgetRemoved/remove — wire them from the real apply-loop " +
          "composition root (features/publish-content/apply-loop.ts)."
      );
    }
    const gatewayDeps = { clock: deps.clock, idGen: deps.idGen, changeSets, outbox, authorize };
    // The apply run's vouched actor (admin user or assistant agent), refused when absent — never an invented user.
    const actor = applyRunActor({ deps, principalId: input.principalId });
    const { target } = input;

    let holder: PostRecord | null = null;

    const undoRetire = async () => {
      await undoRetiredPost({ holder, postRepo, deps, outbox, forgetRemovedPost, input });
    };

    const { changeSetId } = await executeCommand({
      deps: gatewayDeps,
      command: {
        workspaceId: deps.workspaceId,
        actor,
        summary: `Retire ${target.entityType} '${target.entityId}' for publish overwrite`,
        permission: "content.write",
        idempotencyKey: input.idempotencyKey,
      },
      mutation: {
        entityType: target.entityType,
        entityId: target.entityId,
        operation: "delete",
        captureInverse: async () => {
          holder = await postRepo.findById({ workspaceId: deps.workspaceId, id: target.entityId });
          return captureRetiredPostInverse({ holder, target, stateOf });
        },
        execute: () => executePostRetire({ holder, deps, postRepo, outbox, removePost, target, input }),
        captureEntityVersion: ({ result }) => result.post.version,
        rollback: undoRetire,
      },
    });

    return { changeSetId, undo: undoRetire };
  }
async function undoRetiredPost({ holder, postRepo, deps, outbox, forgetRemovedPost, input }: {
  holder: PostRecord | null; postRepo: PostPorts["repo"]; deps: PublishContentDeps;
  outbox: NonNullable<PublishContentDeps["outbox"]>; forgetRemovedPost: NonNullable<PostPorts["forgetRemoved"]>;
  input: { principalId: string };
}) {
      if (!holder) return;
      await restorePostForward({
        deps: { repo: postRepo, clock: deps.clock, outbox, forgetRemoved: forgetRemovedPost },
        input: { prior: holder, actorId: input.principalId },
      });
}

async function captureRetiredPostInverse({ holder, target, stateOf }: {
  holder: PostRecord | null; target: RetireTarget; stateOf: (row: PostRecord) => ReturnType<typeof packedStateOf>;
}) {
          if (!holder) {
            throw new PostNotFoundError(`${target.entityType} '${target.entityId}' was not found`);
          }
          // The apply loop's own re-check runs before this read, outside any lock; checking the
          // hash again here, on the row whose version `execute` pins, closes that gap.
          if (contentHash({ entityType: holder.kind, state: await stateOf(holder) }) !== target.hash) {
            throw new PostConflictError(`the live ${target.entityType} at this address changed after this run's plan was built`);
          }
          // The slug too: a retire renames it, so a revert from history must be able to move it back.
          return { deletedAt: holder.deletedAt ?? null, slug: holder.slug };
}

function executePostRetire({ holder, deps, postRepo, outbox, removePost, target, input }: {
  holder: PostRecord | null; deps: PublishContentDeps; postRepo: PostPorts["repo"];
  outbox: NonNullable<PublishContentDeps["outbox"]>; removePost: NonNullable<PostPorts["remove"]>;
  target: RetireTarget; input: { principalId: string };
}) {
          if (!holder) throw new Error("Publish overwrite has no captured post");
          return retirePostForReplacement({
            deps: { repo: postRepo, clock: deps.clock, outbox, remove: removePost },
            input: {
              workspaceId: deps.workspaceId,
              id: target.entityId,
              expectedVersion: holder.version,
              today: todayStamp({ nowIso: clockNowIso({ clock: deps.clock }) }),
              actorId: input.principalId,
            },
          });
}

/** S4 (`publish-overwrite-live-plan-2026-09-24.md`): retire the live row a slug-clash overwrite replaces. */
export function postRetireMethods(deps: PublishContentDeps, kind: PostKind) {
  const entityType = kind;
  const postRepo = deps.ports.post?.repo;
  const stateOf = (row: PostRecord) => packedStateOf({ termPorts: deps.ports.term, row });

  return {
    planRetire: ({ entity }: { entity: PackedEntity }, _optional = {}) => planRetire({ deps, postRepo, stateOf, entity }),
    retire: (input: Parameters<typeof retire>[0]["input"]) => retire({ deps, entityType, postRepo, stateOf, input }),
  };
}

/**
 * `yyyymmdd` from an ISO clock reading — {@link retirePostForReplacement}'s own `today` input shape
 * (`post.ts`'s own doc: "supplied by the caller rather than derived from `clockNowIso({ clock: deps.clock })`'s ISO
 * format"). The one place that derivation happens, so `retire()` above stays a pure caller of it.
 */
function todayStamp({ nowIso }: { nowIso: string }, _optional: Record<string, never> = {}): string {
  return nowIso.slice(0, 10).replace(/-/g, "");
}