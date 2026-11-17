import { createApprovalHandler, expandBatchContexts, type ApprovalSteps } from './approval.js';
import { DEFAULT_MAX_BATCH_ITEMS, type BatchItemResult } from './batch-tool-inputs.js';
import { requireInputRecord } from './registration-kit.js';
import { ToolInputError } from './tool-input-errors.js';
import type { ToolExecutionContext, ToolExecutionOptions, ToolHandler } from './tool-registry.js';

/** Prepares one item and takes whatever pin the host needs to refuse a stale change. */
export type PrepareStep<TPrepared> = ApprovalSteps<TPrepared, undefined>['prepare'];

/** What a host supplies to chain batch items that write the same target.
 * - `run` applies one prepared item and reports `committed`, the version that write itself produced
 *   (`undefined` when it wrote nothing, for example a byte-identical write).
 * - `targetKey` names the target an item writes; items with the same key chain, others never do.
 * - `successor` pins the next item for a key to what the previous write committed. It is synchronous
 *   and must not do I/O: a read here would adopt whatever a foreign writer left behind as the baseline,
 *   so the only trusted value is the one the batch's own write reported. */
export interface ChainedBatchSteps<TPrepared, TCommitted> {
  prepare: PrepareStep<TPrepared>;
  run(required: { ctx: ToolExecutionContext; prepared: TPrepared }, optional?: ToolExecutionOptions): Promise<{ output: unknown; committed: TCommitted | undefined }>;
  targetKey(required: { prepared: TPrepared }): string;
  successor(required: { prepared: TPrepared; committed: TCommitted | undefined; previous: TPrepared }): TPrepared;
}

type Entry<TPrepared> = { ctx: ToolExecutionContext; prepared: TPrepared };
type Applied<TPrepared, TCommitted> = { prepared: TPrepared; committed: TCommitted | undefined };

/** The version an item runs with: its prepare-time pin, or the successor of the last item that
 * wrote the same target in this call. */
function pinnedFor<TPrepared, TCommitted>(
  { steps, entry, applied }: { steps: ChainedBatchSteps<TPrepared, TCommitted>; entry: Entry<TPrepared>; applied: Applied<TPrepared, TCommitted> | undefined },
): TPrepared {
  if (!applied) return entry.prepared;
  return steps.successor({ prepared: entry.prepared, committed: applied.committed, previous: applied.prepared });
}

/** Run the entries in order. A failed item skips the later items for its own target only. */
async function runChain<TPrepared, TCommitted>(
  { steps, entries, noun }: { steps: ChainedBatchSteps<TPrepared, TCommitted>; entries: readonly Entry<TPrepared>[]; noun: string },
  options: ToolExecutionOptions,
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = [];
  const applied = new Map<string, Applied<TPrepared, TCommitted>>();
  const failed = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (entry.ctx.signal.aborted) throw abandoned();
    const key = steps.targetKey({ prepared: entry.prepared });
    if (failed.has(key)) {
      results.push({ index, ok: false, error: `Skipped: an earlier change to this ${noun} in the same call failed.` });
      continue;
    }
    try {
      const prepared = pinnedFor({ steps, entry, applied: applied.get(key) });
      const { output, committed } = await steps.run({ ctx: entry.ctx, prepared }, options);
      applied.set(key, { prepared, committed });
      results.push({ index, ok: true, result: output });
    } catch (error) {
      failed.add(key);
      results.push({ index, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/** The wording of the existing direct batch when the call is cancelled. */
function abandoned(): ToolInputError {
  return new ToolInputError({ message: 'This tool call was abandoned before the next change. Retry the remaining changes when ready.' });
}

/** A direct (never asking) batch whose items for the same target apply in order, each pinned to the
 * version the batch's own previous write committed. Reuses the approval owner's input snapshot, item
 * cap, duplicate detection and cancellation checks. A single call returns `run`'s output unchanged;
 * a batch returns `{ batch: true, total, results }` so `batchOutcomeFor` reports partial failures.
 * `createBatchApprovalHandler` is untouched: a person approved a description computed from the first bytes.
 * @param optional.targetNoun What the target is called in the "Skipped" sentence. Default `target`.
 * @throws ToolInputError for malformed, duplicate or over-cap batches and for cancellation; `prepare`
 * failures propagate; a single call's `run` failure propagates; a batch item's failure is its result.
 * @complexity O(input bytes) plus bounded host effects; no reads by core.
 * @example createChainedBatchHandler({ prepare, run, targetKey, successor }, { targetNoun: 'file' });
 */
export function createChainedBatchHandler<TPrepared, TCommitted>(
  required: ChainedBatchSteps<TPrepared, TCommitted>,
  { maxItems = DEFAULT_MAX_BATCH_ITEMS, targetNoun = 'target' }: { maxItems?: number; targetNoun?: string } = {},
): ToolHandler {
  type Batch = { batch: boolean; entries: Entry<TPrepared>[] };
  return createApprovalHandler<Batch, undefined>({
    prepare: async ({ ctx }, options) => {
      const input = requireInputRecord({ input: ctx.input });
      if (!Object.hasOwn(input, 'items')) return { batch: false, entries: [{ ctx, prepared: await required.prepare({ ctx }, options) }] };
      const entries: Entry<TPrepared>[] = [];
      for (const itemCtx of expandBatchContexts({ ctx, input, maxItems })) entries.push({ ctx: itemCtx, prepared: await required.prepare({ ctx: itemCtx }, options) });
      return { batch: true, entries };
    },
    describe: () => ({ ask: false, description: undefined }),
    askHuman: async () => { throw new Error('Direct batches have no approval transport'); },
    notConfirmed: () => { throw abandoned(); },
    run: async ({ prepared }, options) => {
      if (!prepared.batch) return (await required.run(prepared.entries[0]!, options)).output;
      const results = await runChain({ steps: required, entries: prepared.entries, noun: targetNoun }, options);
      return { batch: true, total: results.length, results };
    },
  });
}
