import type { Clock } from '@jini-ai/core/primitives';
import type { DeliverResult, SurfaceEmitter, SurfaceEmission, SurfaceExchangeBinding, SurfaceExchangeStore } from '@jini-ai/core';

type Restore = NonNullable<SurfaceExchangeStore['restore']>;
type Lifetime = NonNullable<SurfaceEmitter['exchangeLifetime']>;
type Delivery = SurfaceExchangeStore['deliver'];
interface Entry {
  binding: SurfaceExchangeBinding;
  lifetime: Lifetime;
  emission?: SurfaceEmission;
  endedAt?: number;
  answered: boolean;
  observers: Set<SurfaceEmitter>;
  finish: () => void;
  ended: Promise<void>;
  restarting?: Promise<DeliverResult>;
  restartAbort?: AbortController;
  replacementId?: string;
  replacementReady?: Promise<string | undefined>;
}

/** Only unanswered public invocations survive a call. Bounded in count, with no timer
 * keeping a process alive. Submitted secrets never enter this cache; late answers stay on the
 * submitting request's stack until they can be delivered to the newly authorized call. */
const MAX_RETAINED = 128;
const unavailable = (): DeliverResult => ({ ok: false, reason: 'unknown-or-closed' });

/** Fan out display-only updates. Losing a tab must never replace the tool's authoritative result.
 * @complexity O(t) in tabs observing this card. */
async function broadcast({ entry, emission }: { entry: Entry; emission: SurfaceEmission }): Promise<void> {
  await Promise.allSettled([...entry.observers].map(observer => observer(emission)));
}

/** Strict binding survives expiry and every retry; restoration cannot weaken ordinary delivery. */
function matches({ entry, principalId, toolId, channel, defaultChannel }: {
  entry: Entry; principalId: string; toolId: string | undefined; channel: string | undefined; defaultChannel: string;
}): boolean {
  if (entry.binding.principalId !== principalId) return false;
  if (toolId !== undefined && entry.binding.toolId !== toolId) return false;
  return (entry.binding.channel ?? defaultChannel) === (channel ?? defaultChannel);
}

/** Subscribe until this request leaves or the shared work finishes. A departing tab cancels a
 * replacement only when no other tab still observes it. It never cancels the original agent call.
 * @complexity O(1) subscription state per request. */
async function join({ entry, emit, work, signal }: {
  entry: Entry; emit: SurfaceEmitter; work: Promise<DeliverResult>; signal: AbortSignal | undefined;
}, { initial }: { initial?: SurfaceEmission } = {}): Promise<DeliverResult> {
  let leave!: () => void;
  const aborted = new Promise<DeliverResult>(resolve => { leave = () => resolve(unavailable()); });
  const observer: SurfaceEmitter = emission => emit(emission);
  entry.observers.add(observer);
  signal?.addEventListener('abort', leave, { once: true });
  if (signal?.aborted) leave();
  try {
    if (initial) await emit(initial);
    return await Promise.race([work, aborted]);
  }
  finally {
    entry.observers.delete(observer);
    signal?.removeEventListener('abort', leave);
    if (entry.observers.size === 0) entry.restartAbort?.abort();
  }
}

/** Restart once, even if several tabs return together. The old scrollback handle survives an
 * interrupted replacement; a received answer consumes both it and the replacement handle.
 * @complexity O(t) per emitted frame, plus the original executor's cost.
 */
function restart({ entry }: { entry: Entry }): Promise<DeliverResult> {
  if (entry.restarting) return entry.restarting;
  const controller = new AbortController();
  entry.restartAbort = controller;
  let identify!: (id: string | undefined) => void;
  entry.replacementReady = new Promise(resolve => { identify = resolve; });
  delete entry.replacementId;
  entry.restarting = Promise.resolve().then(async () => {
    await entry.lifetime.retry({ signal: controller.signal, emit: async emission => {
      entry.emission = emission;
      const metadata = emission.payload['surfaceExchange'] as { exchangeId?: string } | undefined;
      if (metadata?.exchangeId) { entry.replacementId = metadata.exchangeId; identify(metadata.exchangeId); }
      await broadcast({ entry, emission });
    } });
    return entry.replacementId === undefined ? unavailable() : { ok: true } as const;
  }).finally(() => {
    identify(undefined); // Authorization/preparation can refuse before opening any replacement.
    delete entry.restarting;
    delete entry.restartAbort;
  });
  return entry.restarting;
}

/** Deliver a late answer only after a new, authorized exchange exists. The answer is not cached,
 * reused as tool input or broadcast. A second tab cannot repeat an already consumed decision.
 */
async function deliverLate({ entry, principalId, params, deliver }: {
  entry: Entry; principalId: string; params: Record<string, unknown>; deliver: Delivery;
}, options: Parameters<Restore>[1]): Promise<void> {
  const exchangeId = await entry.replacementReady;
  if (exchangeId === undefined || entry.answered || options?.signal?.aborted) return;
  deliver({ exchangeId, principalId, params }, options);
}

/** Shared recovery owner for every exchange channel. The store supplies delivery; the executor
 * supplies retry, so recovery cannot bypass authorization or invent a second handler.
 * @complexity O(n) per open/restore/accepted answer in active entries plus at most 128 retained
 * entries; O(t) per emission to t observing tabs.
 */
export function createSurfaceRestoration(
  { clock, defaultChannel, deliver }: { clock: Clock; defaultChannel: string; deliver: Delivery },
  _options: Record<string, never> = {},
) {
  const entries = new Map<string, Entry>();
  function prune(): void {
    const retained: string[] = [];
    for (const [id, entry] of entries) {
      if (entry.endedAt === undefined || entry.restarting) continue;
      retained.push(id);
    }
    for (const id of retained.slice(0, Math.max(0, retained.length - MAX_RETAINED))) entries.delete(id);
  }
  function forgetAnswered({ id }: { id: string }): void {
    for (const [key, entry] of entries) {
      if (key === id || entry.replacementId === id) { entry.answered = true; entries.delete(key); }
    }
  }
  function track({ id, binding, lifetime }: { id: string; binding: SurfaceExchangeBinding; lifetime: Lifetime }) {
    prune();
    let finish!: () => void;
    const ended = new Promise<void>(resolve => { finish = resolve; });
    const entry: Entry = { binding: { ...binding }, lifetime, answered: false, observers: new Set(), finish, ended };
    entries.set(id, entry);
    return {
      send: async ({ emission }: { emission: SurfaceEmission }) => {
        entry.emission = emission;
        await broadcast({ entry, emission });
      },
      answered: () => forgetAnswered({ id }),
      end: () => {
        entry.endedAt = clock.nowMs();
        entry.finish();
        // A synthetic/nested card cannot safely replay its outer tool. No emitted surface means
        // nobody saw a card to return to; retaining that call would be speculative work.
        if (!entry.emission || entry.answered || binding.toolId !== lifetime.toolId) entries.delete(id);
        prune();
      },
    };
  }
  const restore: Restore = async ({ exchangeId, principalId, emit }, options = {}) => {
    prune();
    const entry = entries.get(exchangeId);
    if (!entry) return unavailable();
    if (!matches({ entry, principalId, toolId: options.toolId, channel: options.channel, defaultChannel })) return { ok: false, reason: 'binding-mismatch' };
    if (options.signal?.aborted) return unavailable();
    if (entry.endedAt === undefined) {
      if (options.params) return deliver({ exchangeId, principalId, params: options.params }, options);
      return join({ entry, emit, work: entry.ended.then(() => ({ ok: true })), signal: options.signal },
        entry.emission ? { initial: entry.emission } : {});
    }
    const work = restart({ entry });
    // Subscribe synchronously before the retry's microtask can emit the first card.
    const observed = join({ entry, emit, work, signal: options.signal },
      entry.replacementId && entry.emission ? { initial: entry.emission } : {});
    if (options.params) await deliverLate({ entry, principalId, params: options.params, deliver }, options);
    return observed;
  };
  return { track, restore };
}
