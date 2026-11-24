/**
 * @file The apply-time sequence for an address-clash overwrite: preflight, retire the live holder,
 * create the incoming row, and roll the retire back if the create does not land. Everything
 * host-shaped (row/handler/context types, the downgrade wording, baseline refresh and the item
 * idempotency key derivation) is injected through `collaborators`, so the sequence and its
 * retry keys are owned here once.
 */

/** The live row a retiring row names at plan time. */
export interface ApplyRetireTarget { readonly entityType: string; readonly entityId: string; readonly hash: string }

export interface ApplyRetireRow<TTarget extends ApplyRetireTarget = ApplyRetireTarget> {
  readonly entityType: string;
  readonly entityId: string;
  readonly retires: TTarget;
}

/** The handler operations this sequence drives. `planRetire`/`retire` are optional on a handler
 *  that never offers a retire; the sequence blocks the row if one is missing at apply time. */
export interface ApplyRetireHandler<TEntity, TTarget extends ApplyRetireTarget> {
  planRetire?(input: { entity: TEntity }, optional?: object): Promise<{ readonly entityId: string; readonly hash: string } | null>;
  retire?(input: { target: TTarget; principalId: string; idempotencyKey: string }, optional?: object):
    Promise<{ changeSetId: string; undo(): Promise<void> }>;
  apply(input: { entity: TEntity; expectedVersion: undefined; principalId: string; idempotencyKey: string }, optional?: object):
    Promise<{ changeSetId: string }>;
}

export interface ApplyRetireContext {
  readonly principalId: string;
  readonly runId: string;
  recordContentApplied(input: { itemKey: string; changeSetId: string; retiredChangeSetId: string }, optional?: object): Promise<void>;
}

/** One writing row being applied. `current` is what the destination holds for the row's OWN id. */
export interface ApplyRetireStep<TRow extends ApplyRetireRow, TEntity, THandler, TCtx extends ApplyRetireContext> {
  readonly row: TRow;
  readonly ctx: TCtx;
  readonly key: string;
  readonly entity: TEntity;
  readonly handler: THandler;
  readonly current: unknown | null;
}

/** Host-owned pieces. `TResult` is the host's per-row result shape. */
export interface ApplyRetireCollaborators<TRow extends ApplyRetireRow, TEntity, THandler, TCtx extends ApplyRetireContext, TResult> {
  /** The row with its outcome downgraded; nothing was written. */
  downgradedRow(input: { row: TRow; outcome: "conflict" | "blocked"; reason: string }): TResult;
  /** The downgrade a failure from `handler.apply()` calls for, or the failure itself rethrown. */
  downgradeOrRethrow(input: { error: unknown; row: TRow; handler: THandler }): TResult;
  /** Stable command key for this row's source version (never run-scoped). */
  itemIdempotencyKey(input: { ctx: TCtx; entity: TEntity }): string;
  /** Remember what landed so the next plan compares against it. */
  refreshBaseline(input: { row: TRow; entity: TEntity; ctx: TCtx }): Promise<void>;
  /** Success result carrying both change set ids. */
  appliedResult(input: { row: TRow; changeSetId: string; retiredChangeSetId: string }): TResult;
}

/** publish-overwrite-live-plan §4/S5 — an address-clash overwrite. This row's own entity id must
 *  still be free at the destination (unlike a slug clash, "someone already holds THIS id" here
 *  would mean a genuine create race, not the live holder this row is about to retire), and the
 *  live row row.retires named at plan time must still be exactly what a FRESH planRetire() sees —
 *  closing the same plan/apply window every other outcome requires, just applied to a target that
 *  lives outside this row's own id. Both checks run BEFORE either write, so a stale retire target
 *  never reaches handler.retire()/apply() at all. */
async function validateRetire<TRow extends ApplyRetireRow, TEntity, THandler extends ApplyRetireHandler<TEntity, TRow["retires"]>, TCtx extends ApplyRetireContext, TResult>(
  { step, collaborators }: {
    step: ApplyRetireStep<TRow, TEntity, THandler, TCtx>;
    collaborators: ApplyRetireCollaborators<TRow, TEntity, THandler, TCtx, TResult>;
  },
  _optional = {},
): Promise<TResult | null> {
  const { row, entity, handler, current } = step;
  if (current !== null) {
    return collaborators.downgradedRow({ row, outcome: "conflict", reason: `${row.entityType} '${row.entityId}' was created on the destination between plan and apply` });
  }
  if (!handler.planRetire || !handler.retire) {
    return collaborators.downgradedRow({
      row,
      outcome: "blocked",
      reason: `internal inconsistency: no planRetire()/retire() on the ${row.entityType} handler for a retire-offered row at apply time`,
    });
  }
  const freshTarget = await handler.planRetire({ entity });
  if (!freshTarget || freshTarget.entityId !== row.retires.entityId || freshTarget.hash !== row.retires.hash) {
    return collaborators.downgradedRow({ row, outcome: "conflict", reason: `the live ${row.entityType} at this address changed after this run's plan was built` });
  }
  return null;
}

export async function applyRetiringRow<TRow extends ApplyRetireRow, TEntity, THandler extends ApplyRetireHandler<TEntity, TRow["retires"]>, TCtx extends ApplyRetireContext, TResult>(
  { step, collaborators }: {
    step: ApplyRetireStep<TRow, TEntity, THandler, TCtx>;
    collaborators: ApplyRetireCollaborators<TRow, TEntity, THandler, TCtx, TResult>;
  },
  _optional = {},
): Promise<TResult> {
  const { row, ctx, key, entity, handler } = step;
  const refused = await validateRetire({ step, collaborators });
  if (refused) return refused;
  const itemIdempotencyKey = collaborators.itemIdempotencyKey({ ctx, entity });
  let retireResult: { changeSetId: string; undo(): Promise<void> } | undefined;
  let changeSetId: string;
  try {
    if (!handler.retire) throw new Error("Publish content handler has no retire operation");
    retireResult = await handler.retire({
      target: row.retires,
      principalId: ctx.principalId,
      // Scoped to this run: `undo()` restores forward and leaves the retire's change set (and its
      // key) in the ledger, so a key shared across runs would make every retry after an undone
      // retire fail as "already executed".
      idempotencyKey: `${itemIdempotencyKey}:retire:${ctx.runId}`,
    });
    ({ changeSetId } = await handler.apply({
      entity,
      expectedVersion: undefined, // current === null (checked above) — this is always a create.
      principalId: ctx.principalId, // always the operator, never the source entity's author.
      idempotencyKey: itemIdempotencyKey,
    }));
  } catch (error) {
    await undoRetire({ error, retireResult, row });
    return collaborators.downgradeOrRethrow({ error, row, handler });
  }
  // Both writes landed. A failure from here on is accounting only, so it fails the run (keeping
  // `content_applied` and both change-set ids) instead of undoing anything.
  await ctx.recordContentApplied({ itemKey: key, changeSetId, retiredChangeSetId: retireResult.changeSetId });
  await collaborators.refreshBaseline({ row, entity, ctx });
  return collaborators.appliedResult({ row, changeSetId, retiredChangeSetId: retireResult.changeSetId });
}

async function undoRetire({ error, retireResult, row }: {
  error: unknown; retireResult: { undo(): Promise<void> } | undefined; row: ApplyRetireRow;
}, _optional = {}): Promise<void> {
  // The retire already landed but the create it was clearing the address FOR did not — put the
  // holder back rather than leaving it retired with nothing to show for it (this handler's own
  // `retire()` doc: the apply loop is the one caller besides its own gateway rollback that calls
  // `undo()` directly). Only here: once the create has landed, the new row holds the address and
  // putting the holder back would collide with it.
  if (retireResult) {
    try {
      await retireResult.undo();
    } catch (undoError) {
      const cause = error instanceof Error ? error.message : String(error);
      const undoCause = undoError instanceof Error ? undoError.message : String(undoError);
      throw new Error(
        `${row.entityType} '${row.entityId}' was not created (${cause}), and putting the retired ` +
        `${row.retires.entityType} '${row.retires.entityId}' back failed too (${undoCause}) — restore it from Trash`
      );
    }
  }
}
