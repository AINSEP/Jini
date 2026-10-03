import type { Clock, IdGenerator } from '@jini-ai/core/primitives';
import type { SurfaceEmission, SurfaceEmitter } from '@jini-ai/core';
import type { SchedulerPort } from './scheduler.js';
export type { SchedulerPort } from './scheduler.js';

export const SURFACE_EXCHANGE_ID_PARAM = '__exchangeId';
export const SURFACE_DISMISSED_PARAM = '__dismissed';
export const SURFACE_TYPED_ANSWER_PARAM = '__typedAnswer';
export const DEFAULT_SURFACE_IDLE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_SURFACE_MAX_LIFETIME_MS = 5.5 * 60 * 1000;
export type SurfaceAnswerChannel = string;
export interface SurfaceExchangeBinding { readonly toolId: string; readonly principalId: string; readonly channel?: SurfaceAnswerChannel }
export type SurfaceMessage = { status: 'received'; params: Record<string, unknown> } | { status: 'expired' } | { status: 'abandoned' };
export type SurfaceDeliveryRejectionReason = 'unknown-or-closed' | 'binding-mismatch';
export type DeliverResult = { ok: true } | { ok: false; reason: SurfaceDeliveryRejectionReason };
export interface SurfaceExchange {
  readonly id: string;
  send(args: { emission: SurfaceEmission }): Promise<void>;
  receive(_args: Record<string, never>): Promise<SurfaceMessage>;
  close(_args: Record<string, never>): void;
}
export interface SurfaceDeliverySpec {
  exchangeId: string; params: Record<string, unknown>; principalId: string; toolId?: string; channel?: SurfaceAnswerChannel;
}
export interface SurfaceExchangeStore {
  open(args: { binding: SurfaceExchangeBinding; emit: SurfaceEmitter }): SurfaceExchange;
  deliver(requiredArgs: Pick<SurfaceDeliverySpec, "exchangeId" | "params" | "principalId">, optionalArgs?: Pick<SurfaceDeliverySpec, "toolId" | "channel">): DeliverResult;
  findTypedAnswerTarget(args: { principalId: string; toolId: string }): string | undefined;
  size(): number;
}
interface Registered { binding: SurfaceExchangeBinding; accept: (params: Record<string, unknown>) => void }

/** In-process held calls. Inject a scheduler that unrefs its timers where appropriate. */
export function createSurfaceExchangeStore(
  deps: { scheduler: SchedulerPort; clock: Clock; idGenerator: IdGenerator; defaultChannel: SurfaceAnswerChannel },
  { idleTtlMs = DEFAULT_SURFACE_IDLE_TTL_MS, maxLifetimeMs = DEFAULT_SURFACE_MAX_LIFETIME_MS }: { idleTtlMs?: number; maxLifetimeMs?: number } = {},
): SurfaceExchangeStore {
  if (!Number.isFinite(idleTtlMs) || idleTtlMs <= 0 || !Number.isFinite(maxLifetimeMs) || maxLifetimeMs <= 0) throw new Error('surface deadlines must be finite and positive');
  const openExchanges = new Map<string, Registered>();
  return {
    open({ binding, emit }) {
      const id = deps.idGenerator.newId();
      if (!id || openExchanges.has(id)) throw new Error('surface exchange ID must be unique and nonempty');
      const inbox: Record<string, unknown>[] = [];
      const waiters: ((message: SurfaceMessage) => void)[] = [];
      let terminal: SurfaceMessage | undefined;
      let cancelIdle: (() => void) | undefined;
      let cancelLifetime: (() => void) | undefined;
      const lifetimeDeadline = deps.clock.nowMs() + maxLifetimeMs;
      let idleDeadline = deps.clock.nowMs() + idleTtlMs;
      function end(reason: SurfaceMessage): void {
        if (terminal) return;
        terminal = reason;
        cancelIdle?.();
        cancelLifetime?.();
        openExchanges.delete(id);
        while (waiters.length > 0) waiters.shift()!(reason);
      }
      function expireIfDue(): void {
        const at = deps.clock.nowMs();
        if (at >= idleDeadline || at >= lifetimeDeadline) end({ status: 'expired' });
      }
      function armIdle(): void {
        if (terminal) return;
        cancelIdle?.();
        idleDeadline = deps.clock.nowMs() + idleTtlMs;
        cancelIdle = deps.scheduler.schedule({ delayMs: idleTtlMs, callback: () => end({ status: 'expired' }) });
      }
      // Register only after both timers are installed, so scheduler failure leaves no discoverable exchange.
      try {
        cancelLifetime = deps.scheduler.schedule({ delayMs: maxLifetimeMs, callback: () => end({ status: 'expired' }) });
        armIdle();
      } catch (error) { cancelLifetime?.(); cancelIdle?.(); throw error; }
      openExchanges.set(id, {
        binding: { ...binding },
        accept(params) {
          expireIfDue();
          if (terminal) return;
          armIdle();
          const waiter = waiters.shift();
          if (waiter) waiter({ status: 'received', params });
          else inbox.push(params);
        },
      });
      return {
        id,
        async send({ emission }) {
          expireIfDue();
          if (terminal) throw new Error(`surface exchange ${id} has already ended`);
          armIdle();
          await emit(emission);
        },
        async receive(_args: Record<string, never>) {
          expireIfDue();
          // Preserve the original FIFO contract: already delivered answers precede terminal status.
          const buffered = inbox.shift();
          if (buffered) { armIdle(); return { status: 'received', params: buffered }; }
          if (terminal) return terminal;
          return new Promise<SurfaceMessage>(resolve => waiters.push(resolve));
        },
        close(_args: Record<string, never>) { end({ status: 'abandoned' }); },
      };
    },
    deliver(requiredArgs: Pick<SurfaceDeliverySpec, "exchangeId" | "params" | "principalId">, optionalArgs: Pick<SurfaceDeliverySpec, "toolId" | "channel"> = {}) {
  const spec: SurfaceDeliverySpec = { ...requiredArgs, ...optionalArgs };
      const entry = openExchanges.get(spec.exchangeId);
      if (!entry) return { ok: false, reason: 'unknown-or-closed' };
      if ((spec.toolId !== undefined && entry.binding.toolId !== spec.toolId)
        || (entry.binding.channel ?? deps.defaultChannel) !== (spec.channel ?? deps.defaultChannel)
        || entry.binding.principalId !== spec.principalId) return { ok: false, reason: 'binding-mismatch' };
      entry.accept(spec.params);
      return openExchanges.has(spec.exchangeId) ? { ok: true } : { ok: false, reason: 'unknown-or-closed' };
    },
    findTypedAnswerTarget({ principalId, toolId }) {
      let found: string | undefined;
      for (const [id, entry] of openExchanges) {
        if (entry.binding.principalId !== principalId || entry.binding.toolId !== toolId) continue;
        if (found !== undefined) return undefined;
        found = id;
      }
      return found;
    },
    size: () => openExchanges.size,
  };
}

export async function askOnce({ exchange, emission }: { exchange: SurfaceExchange; emission: SurfaceEmission }): Promise<SurfaceMessage> {
  try { await exchange.send({ emission }); return await exchange.receive({}); }
  finally { exchange.close({}); }
}
export async function askThenReport<T>({ exchange, confirmationEmission, handle }: {
  exchange: SurfaceExchange; confirmationEmission: SurfaceEmission;
  handle: (answer: SurfaceMessage) => Promise<{ result: T; outcome?: SurfaceEmission }>;
}): Promise<T> {
  try {
    await exchange.send({ emission: confirmationEmission });
    const { result, outcome } = await handle(await exchange.receive({}));
    if (outcome !== undefined) { try { await exchange.send({ emission: outcome }); } catch { /* Model result remains authoritative. */ } }
    return result;
  } finally { exchange.close({}); }
}
export type ConfirmationOutcome = { confirmed: true } | { confirmed: false; reason: 'declined' | 'expired' | 'abandoned' };
/** Typed prose is never consent; only an explicit literal decision grants approval. */
export function classifyConfirmationAnswer({ answer }: { answer: SurfaceMessage }): ConfirmationOutcome {
  if (answer.status !== 'received') return { confirmed: false, reason: answer.status };
  return answer.params['decision'] === 'confirm' ? { confirmed: true } : { confirmed: false, reason: 'declined' };
}
export async function resolveConfirmationDecision(args: { exchange: SurfaceExchange; emission: SurfaceEmission }): Promise<ConfirmationOutcome> {
  return classifyConfirmationAnswer({ answer: await askOnce(args) });
}
export interface AssistantSurfaceDeps { readonly surfaceExchanges: SurfaceExchangeStore }
