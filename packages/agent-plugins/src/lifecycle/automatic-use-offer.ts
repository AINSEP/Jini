/** Scope, replay and refusal rules for guidance offers; the controller owns delivery state. */
import type { AgentPluginGuidanceAttempt, AgentPluginGuidanceOffer } from '@jini-ai/core/contracts/site/daemon';

export type GuidanceAttemptLiveness = (
  required: AgentPluginGuidanceAttempt,
  optional?: { signal?: AbortSignal },
) => Promise<boolean>;

/** The one current offer of a logical-turn controller, plus its recorded commit once made. */
export interface StoredGuidanceOffer {
  readonly scope: AgentPluginGuidanceAttempt;
  offerId: string;
  readonly offer: Omit<AgentPluginGuidanceOffer, 'offerId'>;
  /** Display names of the offered full sections, in draft order. */
  readonly offered: ReadonlyMap<string, string>;
  /** Pins the offer saw; they enter the delivered set only when a commit succeeds. */
  readonly loaded: readonly string[];
  readonly isAttemptLive: GuidanceAttemptLiveness;
  committed?: { readonly ids: readonly string[]; readonly result: { readonly guidanceIds: readonly string[] } };
}

export const GUIDANCE_REPLAY_REFUSAL = 'This guidance choice was already recorded for this turn.';
const NOT_CURRENT = 'This guidance offer is no longer current for this turn.';

/** A plain-words refusal; callers must not record any part of the choice after it. */
export function refuseGuidance({ reason }: { reason: 'not-current' | 'replay' | 'unoffered' | 'unavailable' | 'cancelled' }, _options = {}): never {
  const messages = {
    'not-current': NOT_CURRENT,
    replay: GUIDANCE_REPLAY_REFUSAL,
    unoffered: 'This guidance choice includes plugins that were not offered for this turn.',
    unavailable: 'A selected plugin is no longer available, so no guidance was recorded.',
    cancelled: 'Recording this guidance choice was cancelled.',
  } as const;
  throw new Error(messages[reason]);
}

export function guidanceScopeKey({ scope }: { scope: AgentPluginGuidanceAttempt }, _options = {}): string {
  return JSON.stringify([scope.runId, scope.attempt, scope.principalId]);
}

export function sameGuidanceScope({ left, right }: { left: AgentPluginGuidanceAttempt; right: AgentPluginGuidanceAttempt }, _options = {}): boolean {
  return guidanceScopeKey({ scope: left }) === guidanceScopeKey({ scope: right });
}

/** A replaced scope, or an older attempt of the current run, can never offer again. O(1). */
export function isRetiredGuidanceScope({ scope, current, retired }: {
  scope: AgentPluginGuidanceAttempt;
  current: StoredGuidanceOffer | undefined;
  retired: ReadonlySet<string>;
}, _options = {}): boolean {
  if (retired.has(guidanceScopeKey({ scope }))) return true;
  return !!current && current.scope.runId === scope.runId && scope.attempt < current.scope.attempt;
}

/** Replays compare as sets: the same ids in another order are the same choice. O(n log n). */
export function sameGuidanceChoice({ left, right }: { left: readonly string[]; right: readonly string[] }, _options = {}): boolean {
  const normalize = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort());
  return normalize(left) === normalize(right);
}

/** Only unique ids from this offer's full sections may be committed. O(n). */
export function assertOfferedChoice({ stored, deliveredIds }: { stored: StoredGuidanceOffer; deliveredIds: readonly string[] }, _options = {}): void {
  if (new Set(deliveredIds).size !== deliveredIds.length || deliveredIds.some(id => !stored.offered.has(id))) refuseGuidance({ reason: 'unoffered' });
}

/** The commit must name the stored scope and offer exactly. @returns The matching stored offer. */
export function currentGuidanceOffer({ stored, scope, offerId }: {
  stored: StoredGuidanceOffer | undefined;
  scope: AgentPluginGuidanceAttempt;
  offerId: string;
}, _options = {}): StoredGuidanceOffer {
  if (!stored || stored.offerId !== offerId || !sameGuidanceScope({ left: stored.scope, right: scope })) refuseGuidance({ reason: 'not-current' });
  return stored;
}

/** The host's authoritative fence; an abort during the check also refuses. */
export async function assertAttemptLive({ stored, signal }: { stored: StoredGuidanceOffer; signal?: AbortSignal | undefined }, _options = {}): Promise<void> {
  if (signal?.aborted) refuseGuidance({ reason: 'cancelled' });
  const live = await stored.isAttemptLive(stored.scope, signal ? { signal } : {});
  if (signal?.aborted) refuseGuidance({ reason: 'cancelled' });
  if (!live) refuseGuidance({ reason: 'not-current' });
}
