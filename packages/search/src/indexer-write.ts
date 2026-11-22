import { providerUnknown, type ProviderResult } from '@jini-ai/core/provider-registry';
import { encodeSearchKey, type SearchDocument, type SearchProvider, type SearchProviderContext, type SearchTombstone, type SearchWriteResult, type SearchWriteStatus } from './contract.js';
import { type SearchIndexStatePort, type SearchIndexStateRow, type SearchIndexStatus, type SearchSiteTargets, type SearchSourceRecord, type SearchTarget, type SearchTargetPort } from './ports.js';
import type { SearchIndexerRequired } from './indexer.js';

/** The lastError recorded when a target's provider is not registered or has no context. */
export const SEARCH_NOT_CONFIGURED = 'not_configured';
const OUTCOME_STATUS: Readonly<Record<SearchWriteStatus, SearchIndexStatus>> = {
  applied: 'indexed',
  // The provider already holds an equal or newer revision: nothing is left to do for this key.
  stale: 'indexed',
  pending: 'pending',
  rejected: 'failed',
};

export interface Resolved { readonly provider: SearchProvider; readonly ctx: SearchProviderContext }
interface Plan { readonly record: SearchSourceRecord; readonly attempts: number; readonly upsert: boolean }
export interface Settle { readonly status: SearchIndexStatus; readonly taskId?: string; readonly lastError?: string }
interface WriteTally { readonly written: number; readonly indexed: number }
/** Run one provider call; a provider that throws despite the contract becomes an `unknown`. */
export async function guarded<T>(call: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
  try {
    return await call();
  } catch {
    return providerUnknown({ code: 'unexpected_response', message: 'search provider threw' });
  }
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function targetList(targets: SearchSiteTargets): SearchTarget[] {
  return [targets.active, targets.building].filter((target): target is SearchTarget => target !== null);
}

/**
 * Upsert only a document the target's provider may hold. Vendors are public-only, so a restricted
 * document, a draft, a trashed or a not-yet-live record all become a REMOVAL there: a public→members
 * change must delete the document from the vendor, not update it in place.
 */
function shouldUpsert(record: SearchSourceRecord, provider: SearchProvider): boolean {
  const { document } = record;
  if (document === null) return false;
  return document.visibility.kind === 'public' || provider.capabilities.acceptsRestricted;
}
export function createIndexerResolve({ required, registry }: { required: SearchIndexerRequired; registry: SearchIndexerRequired['registry'] }) {
  return async (target: SearchTarget, workspaceId: string): Promise<Resolved | null> => {
    const provider = registry.get({ id: target.providerId })?.provider;
    if (!provider) return null;
    const ctx = await required.contextFor({ target, workspaceId });
    return ctx ? { provider, ctx } : null;
  };
}

export function createIndexerPlanRow({ now }: { now: SearchIndexerRequired['now'] }) {
  return (target: SearchTarget, plan: Plan, settle: Settle): SearchIndexStateRow => ({
    target, key: plan.record.key, revision: plan.record.revision, deleted: !plan.upsert,
    status: settle.status, attempts: plan.attempts, updatedAtMs: now(),
    ...(settle.taskId === undefined ? {} : { taskId: settle.taskId }),
    ...(settle.lastError === undefined ? {} : { lastError: settle.lastError }),
  });
}

export function createIndexerPutPlan({ state }: { state: SearchIndexStatePort }, dependencies: () => { planRow: ReturnType<typeof createIndexerPlanRow> }) {
  return (target: SearchTarget, plan: Plan, settle: Settle) => {
    const { planRow } = dependencies();
    return state.put({ row: planRow(target, plan, settle) });
  };
}
/**
   * Records worth writing, each with its attempt number. An event/backfill write is skipped when
   * the row already holds an equal or newer revision (a delayed or duplicated event); a retry only
   * skips an OLDER revision, because retrying the same revision is the point of a retry.
   */
  
export function createIndexerFreshRecords({ state }: { state: SearchIndexStatePort }) {
  return async (target: SearchTarget, records: readonly SearchSourceRecord[], retry: boolean) => {
    const fresh: { record: SearchSourceRecord; attempts: number }[] = [];
    for (const record of records) {
      const prior = await state.get({ target, key: record.key });
      const skip = prior !== null && (retry ? prior.revision > record.revision : prior.revision >= record.revision);
      if (skip) continue;
      const attempts = (prior !== null && prior.revision === record.revision ? prior.attempts : 0) + 1;
      fresh.push({ record, attempts });
    }
    return fresh;
  };
}

/**
   * Map one write call's result onto its plans' rows; returns how many ended `indexed`. Each settle
   * is a compare-and-swap on the `pending` mark this write made (its revision, no task): a newer
   * revision written meanwhile owns the row and is never overwritten by this older completion.
   */
  
export function createIndexerSettleCall({ state }: { state: SearchIndexStatePort }, dependencies: () => { planRow: ReturnType<typeof createIndexerPlanRow> }) {
  return async (target: SearchTarget, plans: readonly Plan[], result: ProviderResult<SearchWriteResult>): Promise<number> => {
    const { planRow } = dependencies();
    let indexed = 0;
    for (const plan of plans) {
      const settle = settleOf(plan, result);
      const written = await state.settle({ row: planRow(target, plan, settle), expected: { revision: plan.record.revision, taskId: null } });
      if (written && settle.status === 'indexed') indexed += 1;
    }
    return indexed;
  };
}

export function createIndexerWriteChunks(dependencies: () => { settleCall: ReturnType<typeof createIndexerSettleCall> }) {
  return async <T>(input: { target: SearchTarget; plans: readonly Plan[]; maxBatch: number; payload: (plan: Plan) => T; call: (items: T[]) => Promise<ProviderResult<SearchWriteResult>> }): Promise<number> => {
    const { settleCall } = dependencies();
    let indexed = 0;
    for (const chunk of chunks(input.plans, input.maxBatch)) {
      const result = await guarded(() => input.call(chunk.map(input.payload)));
      indexed += await settleCall(input.target, chunk, result);
    }
    return indexed;
  };
}

/** Write records to ONE target: mark pending, call the provider in batches, settle each row. */
  
export function createIndexerWriteToTarget(dependencies: () => { resolve: ReturnType<typeof createIndexerResolve>; putPlan: ReturnType<typeof createIndexerPutPlan>; freshRecords: ReturnType<typeof createIndexerFreshRecords>; writeChunks: ReturnType<typeof createIndexerWriteChunks> }) {
  return async (input: { target: SearchTarget; workspaceId: string; records: readonly SearchSourceRecord[]; retry: boolean }): Promise<WriteTally> => {
    const { resolve, putPlan, freshRecords, writeChunks } = dependencies();
    const { target } = input;
    const fresh = await freshRecords(target, input.records, input.retry);
    if (fresh.length === 0) return { written: 0, indexed: 0 };
    const resolved = await resolve(target, input.workspaceId);
    if (!resolved) {
      // No provider call is possible; the row records why so `status` can show it.
      const plans: Plan[] = [];
      for (const item of fresh) {
        const plan = { ...item, upsert: item.record.document !== null };
        if (await putPlan(target, plan, { status: 'failed', lastError: SEARCH_NOT_CONFIGURED })) plans.push(plan);
      }
      return { written: plans.length, indexed: 0 };
    }
    const { provider, ctx } = resolved;
    const plans: Plan[] = [];
    for (const item of fresh) {
      const plan = { ...item, upsert: shouldUpsert(item.record, provider) };
      if (await putPlan(target, plan, { status: 'pending' })) plans.push(plan);
    }
    const maxBatch = Math.max(1, provider.capabilities.maxBatch);
    const upserted = await writeChunks({
      target, maxBatch, plans: plans.filter(plan => plan.upsert),
      payload: plan => plan.record.document as SearchDocument,
      call: documents => provider.upsert(ctx, { documents }),
    });
    const removed = await writeChunks({
      target, maxBatch, plans: plans.filter(plan => !plan.upsert),
      payload: (plan): SearchTombstone => ({ key: plan.record.key, revision: plan.record.revision }),
      call: tombstones => provider.remove(ctx, { tombstones }),
    });
    return { written: plans.length, indexed: upserted + removed };
  };
}
export function createIndexerCurrentTargets({ targets }: { targets: SearchTargetPort }) {
  return async (siteId: string) => targetList(await targets.get({ siteId }));
}
/** One plan's row outcome from its write call's result. */
function settleOf(plan: Plan, result: ProviderResult<SearchWriteResult>): Settle {
  if (result.status === 'rejected') return { status: 'failed', lastError: result.error.message };
  // Indeterminate: the write may have happened. Reconcile asks the provider, never marks it failed.
  if (result.status === 'unknown') return { status: 'unknown', lastError: result.error.code };
  const encoded = encodeSearchKey({ key: plan.record.key });
  const outcome = result.value.outcomes.find(candidate => encodeSearchKey({ key: candidate.key }) === encoded);
  if (!outcome) return { status: 'unknown', lastError: 'missing_outcome' };
  const status = OUTCOME_STATUS[outcome.status];
  if (status === 'pending') return result.value.taskId === undefined ? { status } : { status, taskId: result.value.taskId };
  if (status === 'failed') return { status, lastError: outcome.message ?? 'rejected' };
  return { status };
}
