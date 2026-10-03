import { randomUUID } from 'node:crypto';
import type { SurfaceEmission, SurfaceEmitter } from '@jini-ai/core';
import * as implementation from '../surface-exchanges.js';
import type { SchedulerPort } from '../scheduler.js';

export {
  DEFAULT_SURFACE_IDLE_TTL_MS, DEFAULT_SURFACE_MAX_LIFETIME_MS, SURFACE_TYPED_ANSWER_PARAM,
} from '../surface-exchanges.js';
export const scheduler: SchedulerPort = {
  schedule({ delayMs, callback }) { const timer = setTimeout(callback, delayMs); timer.unref?.(); return () => clearTimeout(timer); },
};
type LegacyExchange = { id: string; send(emission: SurfaceEmission): Promise<void>; receive(): Promise<implementation.SurfaceMessage>; close(): void };
function objectExchange(exchange: LegacyExchange): implementation.SurfaceExchange {
  return { id: exchange.id, send: ({ emission }) => exchange.send(emission), receive: () => exchange.receive(), close: () => exchange.close() };
}
/** Test-only adapter retains copied assertion call shapes; production APIs use objects. */
export function createSurfaceExchangeStore(options: { idleTtlMs?: number; maxLifetimeMs?: number; newExchangeId?: () => string } = {}) {
  const store = implementation.createSurfaceExchangeStore({ scheduler, clock: { nowMs: () => Date.now() }, idGenerator: { newId: options.newExchangeId ?? randomUUID }, defaultChannel: 'mcp-ui' }, {
    ...(options.idleTtlMs !== undefined ? { idleTtlMs: options.idleTtlMs } : {}),
    ...(options.maxLifetimeMs !== undefined ? { maxLifetimeMs: options.maxLifetimeMs } : {}),
  });
  return {
    open(binding: implementation.SurfaceExchangeBinding, emit: SurfaceEmitter): LegacyExchange {
      const exchange = store.open({ binding, emit });
      return { id: exchange.id, send: emission => exchange.send({ emission }), receive: () => exchange.receive({}), close: () => exchange.close({}) };
    },
    deliver({ toolId, channel, ...required }: implementation.SurfaceDeliverySpec) {
      return store.deliver(required, {
        ...(toolId === undefined ? {} : { toolId }),
        ...(channel === undefined ? {} : { channel }),
      });
    },
    size: store.size, findTypedAnswerTarget: store.findTypedAnswerTarget,
  };
}
export const askOnce = (exchange: LegacyExchange, emission: SurfaceEmission) => implementation.askOnce({ exchange: objectExchange(exchange), emission });
export const askThenReport = <T>(exchange: LegacyExchange, confirmationEmission: SurfaceEmission, handle: (answer: implementation.SurfaceMessage) => Promise<{ result: T; outcome?: SurfaceEmission }>) => implementation.askThenReport({ exchange: objectExchange(exchange), confirmationEmission, handle });
export const classifyConfirmationAnswer = (answer: implementation.SurfaceMessage) => implementation.classifyConfirmationAnswer({ answer });
export const resolveConfirmationDecision = (exchange: LegacyExchange, emission: SurfaceEmission) => implementation.resolveConfirmationDecision({ exchange: objectExchange(exchange), emission });
