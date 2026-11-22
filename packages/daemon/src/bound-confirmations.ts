/**
 * @file Human confirmation bound to one exact tool execution, for surfaces whose answering human holds no
 * principal (for example an anonymous page visitor). Two halves:
 * - `createBoundConfirmations` routes a single-use exchange answer back to a server-held binding, with a
 *   cap on held prompts, a cap per quota key, one prompt per run, and claim-before-await replies.
 * - `createBoundConfirmationGate` is an `ExecutionDelegate` that captures a policy snapshot and an input
 *   digest when it prompts, then re-validates both after the click AND immediately before the handler.
 * The host owns copy, policy reading, the prompt's wire shape and every cap value.
 */
import type { SurfaceEmission, SurfaceExchangeStore } from '@jini-ai/core';
import { canonicalArgumentDigest, type DigestCryptoPort } from '@jini-ai/core/records';
import type { ExecutionDelegate, ToolConfirmationRequest, ToolExecutor } from "./tool-executor-types.js";

/** The server-held execution a prompt answers for. No field of it is ever read from the answering client. */
export interface BoundConfirmationBinding<TOwner> {
  readonly runId: string;
  readonly executionId: string;
  /** Host-authenticated quota scope (for example the client address); never a browser claim. */
  readonly quotaKey: string;
  /** Who may answer. Presence is what binds, not truthiness: `0`, `''` and `false` are owners like any
   *  other and must match. Omitted (or `undefined`) means no owner is bound and the exchange ID alone
   *  answers. `null` means "bound to nobody": such a prompt is refused and never emitted. The value is
   *  compared when the answer arrives, so it must not change while the prompt is held: pass a primitive
   *  key or an object nothing mutates. */
  readonly owner?: TOwner;
}

export interface BoundConfirmationRequest<TOwner> {
  readonly binding: BoundConfirmationBinding<TOwner>;
  /** The human-only emission carrying the prompt; the host owns its wire shape and copy. */
  readonly emission: (required: { challengeId: string }) => SurfaceEmission;
  readonly emit: (required: { payload: unknown }) => void;
  /** Re-checked after the click; `false` or a throw denies. */
  readonly validate: () => Promise<boolean>;
  readonly signal?: AbortSignal;
}

export interface BoundConfirmations<TOwner> {
  request(required: BoundConfirmationRequest<TOwner>, optional?: Record<string, never>): Promise<boolean>;
  confirm(required: { challengeId: string; allow: boolean; owner?: TOwner }, optional?: Record<string, never>): Promise<boolean>;
}

/** @agent-note Host-wired. `principalId` and `channel` must be reserved for these prompts so no other
 *  answer route (an admin surface, another tool's exchange) can resolve them. The exchange ID is the
 *  bearer for every prompt (the only credential when no owner is bound), so the store's `idGenerator`
 *  must be unguessable (at least 128 random bits) and the store should be dedicated to these prompts. */
export interface BoundConfirmationsDeps<TOwner> {
  readonly exchanges: SurfaceExchangeStore;
  readonly nowMs: () => number;
  readonly sameOwner: (required: { expected: TOwner; actual: TOwner | undefined }) => boolean;
  readonly principalId: string;
  readonly channel: string;
  readonly limits: { readonly maxHeld: number; readonly perQuotaKey: number };
}

interface HeldConfirmation<TOwner> {
  readonly owner?: TOwner | undefined;
  readonly validate: () => Promise<boolean>;
  readonly expiresAtMs: number;
  readonly deliver: (required: { allow: boolean }) => boolean;
}

/** Whether this answerer may claim the prompt. An owner is bound when one was GIVEN, whatever its value:
 * testing truthiness here would let anyone answer for an owner of `0`, `''` or `false`.
 * @complexity O(1) plus the host's comparison.
 */
function ownerMayAnswer<TOwner>(
  { held, actual, sameOwner }: { held: HeldConfirmation<TOwner>; actual: TOwner | undefined; sameOwner: BoundConfirmationsDeps<TOwner>['sameOwner'] },
  _optional = {},
): boolean {
  return held.owner === undefined || sameOwner({ expected: held.owner, actual });
}

/** Re-validates a CLAIMED prompt (expiry before and after the host check) and delivers the answer exactly
 * once, always, even when validation throws: the waiting execution must never be left parked. The answer
 * is `allow` only when the prompt is still valid.
 * @complexity O(1) plus the host's validation.
 */
async function settleHeld<TOwner>(
  { held, allow, nowMs }: { held: HeldConfirmation<TOwner>; allow: boolean; nowMs: () => number },
  _optional = {},
): Promise<boolean> {
  let valid = false;
  let delivered = false;
  try { valid = nowMs() < held.expiresAtMs && await held.validate(); }
  finally {
    valid = valid && nowMs() < held.expiresAtMs;
    delivered = held.deliver({ allow: valid && allow });
  }
  return valid && delivered;
}

/** The random exchange ID is a single-use bearer delivered only on its owning stream. The exchange store
 * owns expiry, buffering, abandonment and timer disposal. This map only routes the human's reply to the
 * server-held binding; no client or model field can retarget a pending execution.
 * @complexity O(1) routing; at most `limits.maxHeld` held prompts, `limits.perQuotaKey` per key, one per run.
 */
export function createBoundConfirmations<TOwner>(deps: BoundConfirmationsDeps<TOwner>, _options = {}): BoundConfirmations<TOwner> {
  const { exchanges, nowMs, principalId, channel, limits } = deps;
  const pending = new Map<string, HeldConfirmation<TOwner>>();
  const turns = new Set<string>();
  const quotaCounts = new Map<string, number>();

  /** Claimed replies are still held streams until finally, so count runs rather than live bearers. */
  function atCapacity({ binding }: { binding: BoundConfirmationBinding<TOwner> }, _optional = {}): boolean {
    return turns.size >= limits.maxHeld || turns.has(binding.runId) || (quotaCounts.get(binding.quotaKey) ?? 0) >= limits.perQuotaKey;
  }

  function releaseHeld({ binding }: { binding: BoundConfirmationBinding<TOwner> }, _optional = {}): void {
    turns.delete(binding.runId);
    const remaining = quotaCounts.get(binding.quotaKey)! - 1;
    if (remaining === 0) quotaCounts.delete(binding.quotaKey);
    else quotaCounts.set(binding.quotaKey, remaining);
  }

  return {
    async request(required, _optional = {}) {
      const { binding, signal } = required;
      const quotaCount = quotaCounts.get(binding.quotaKey) ?? 0;
      if (signal?.aborted || binding.owner === null || atCapacity({ binding })) return false;
      // Identity here is the unguessable human-only exchange ID, not a principal. The server retains
      // the full execution binding; caller input can supply none of these fields.
      const exchange = exchanges.open({ binding: { principalId, toolId: binding.executionId, channel },
        emit: async ({ payload }) => { required.emit({ payload }); } });
      turns.add(binding.runId);
      quotaCounts.set(binding.quotaKey, quotaCount + 1);
      pending.set(exchange.id, { owner: binding.owner, validate: required.validate, expiresAtMs: exchange.expiresAtMs(),
        deliver: ({ allow }) => exchanges.deliver({ exchangeId: exchange.id, principalId, params: { allow } },
          { toolId: binding.executionId, channel }).ok });
      const abandon = () => exchange.close({});
      signal?.addEventListener('abort', abandon, { once: true });
      try {
        await exchange.send({ emission: required.emission({ challengeId: exchange.id }) });
        const answer = await exchange.receive({});
        return answer.status === 'received' && answer.params.allow === true;
      } finally {
        pending.delete(exchange.id);
        releaseHeld({ binding });
        signal?.removeEventListener('abort', abandon);
        exchange.close({});
      }
    },
    async confirm({ challengeId, allow, owner }, _optional = {}) {
      const held = pending.get(challengeId);
      if (!held) return false;
      if (!ownerMayAnswer({ held, actual: owner, sameOwner: deps.sameOwner })) return false;
      // Claim before any await: simultaneous clicks/replays cannot queue a second answer.
      pending.delete(challengeId);
      return settleHeld({ held, allow, nowMs });
    },
  };
}

/** @agent-note Host-wired policy for one surface. `readSnapshot` must carry a revision that changes on every
 *  write: a value hash cannot detect a changed-and-restored policy. */
export interface BoundConfirmationGatePorts<TSnapshot> {
  readonly readSnapshot: () => Promise<TSnapshot>;
  /** `"ask"` holds the execution for a human; `"deny"` resumes it denied. */
  readonly decide: (required: { request: ToolConfirmationRequest; snapshot: TSnapshot }) => 'ask' | 'deny';
  /** Whether the live snapshot still authorizes what the captured one did. Evaluated before the abort check. */
  readonly isCurrent: (required: { captured: TSnapshot; live: TSnapshot }) => boolean;
  readonly requestApproval: (required: { request: ToolConfirmationRequest; validate: () => Promise<boolean> }) => Promise<boolean>;
  readonly reportError: (required: { error: unknown }) => void;
  readonly signal?: AbortSignal;
}

export interface BoundConfirmationGate {
  readonly delegate: ExecutionDelegate;
  /** Single use: consumes the approval. `false` when none was given, it no longer validates, or the run aborted. */
  isApproved(required: { executionId: string; input: unknown }, optional?: Record<string, never>): Promise<boolean>;
  forget(required: { executionId: string }, optional?: Record<string, never>): void;
}

/** Each approval binds one immutable execution. Re-read the snapshot after the click and immediately
 * before the handler. IDs and argument digests never become model-facing results, and no values are
 * retained in the binding. Input is detached before execution.
 * @complexity O(1) per execution plus the host's snapshot reads and input hashing.
 */
export function createBoundConfirmationGate<TSnapshot>(
  { ports, resume, crypto }: { ports: BoundConfirmationGatePorts<TSnapshot>; resume: ToolExecutor['resumeConfirmation']; crypto: DigestCryptoPort },
  _options = {},
): BoundConfirmationGate {
  const approved = new Map<string, (required: { input: unknown }) => Promise<boolean>>();

  /** A disconnect already cancels the executor's pending confirmation; never try to resurrect it.
   * Other cancellation paths may also settle it first; report a failed resume without rejecting.
   */
  function resumeSafely({ executionId, allow }: { executionId: string; allow: boolean }, _optional = {}): void {
    if (ports.signal?.aborted) return;
    try { resume({ executionId, decision: allow ? 'confirm' : 'deny' }); }
    catch (error) { ports.reportError({ error }); }
  }

  async function confirm({ request }: { request: ToolConfirmationRequest }, _optional = {}): Promise<void> {
    let allow = false;
    try {
      const captured = await ports.readSnapshot();
      if (ports.decide({ request, snapshot: captured }) !== 'ask') return;
      // An object envelope keeps omitted arguments JSON-serializable without changing handler input.
      const inputDigest = await canonicalArgumentDigest({ args: { input: request.input }, crypto });
      const validate = async ({ input }: { input: unknown }, _optional = {}) => {
        const live = await ports.readSnapshot();
        const current = ports.isCurrent({ captured, live });
        return !ports.signal?.aborted && current && await canonicalArgumentDigest({ args: { input }, crypto }) === inputDigest;
      };
      allow = await ports.requestApproval({ request, validate: () => validate({ input: request.input }) });
      if (allow) approved.set(request.executionId, validate);
    } catch (error) { ports.reportError({ error }); }
    finally {
      resumeSafely({ executionId: request.executionId, allow });
    }
  }

  const delegate: ExecutionDelegate = { onConfirm(request) {
    // Bare void is the executor's documented resumable seam. The async snapshot read ensures the
    // executor parks before even a synchronous click can call resumeConfirmation.
    void confirm({ request });
  } };
  return { delegate,
    async isApproved({ executionId, input }, _optional = {}) {
      const validate = approved.get(executionId);
      approved.delete(executionId);
      let valid = false;
      try { valid = Boolean(validate) && await validate!({ input }); }
      catch (error) { ports.reportError({ error }); }
      return valid && !ports.signal?.aborted;
    },
    forget({ executionId }, _optional = {}) { approved.delete(executionId); },
  };
}
