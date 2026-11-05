/** External authorization uses openLink, never a tool invocation. Skip answers only the held
 * exchange; replacing the same URI reports the actual connection without leaving a live link. */
import {
  SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM,
  type SurfaceExchangeConversation, type SurfaceExchangeStore,
  type ToolExecutionContext, type ToolExecutionOptions,
} from '@jini-ai/core';
import { buildOutcomeSurface, type SurfaceOutcomeSpec } from './surfaces/outcome.js';
import type { UIResource, UIResourceUri } from './resource.js';

export type SignInCardState =
  | { state: 'waiting'; signInUrl: string; exchangeId?: string }
  | { state: 'connected' | 'skipped' };

/** Host-owned wording and identity; no connection-provider or product types enter the engine. */
export interface SignInCardSpec {
  uri: UIResourceUri;
  toolId: string;
  app: NonNullable<SurfaceOutcomeSpec['app']>;
  waiting: { title: string; description: string; message: string; openLinkLabel: string; cancelLabel: string };
  connected: { title: string; message: string };
  skipped: { title: string; message: string };
}

/** Render the three states under one URI so the last emission replaces the waiting card.
 * @complexity O(h) time/space in rendered HTML. @overallScore 99; Low: copy safety is host-owned. */
export function buildSignInCard(required: SignInCardSpec & SignInCardState, _optional = {}): UIResource {
  const { uri, app, state } = required;
  if (state !== 'waiting') return buildOutcomeSurface({
    uri, app, ...required[state], state: state === 'connected' ? 'success' : 'partial',
    preferredFrameSize: ['100%', '200px'],
  });
  const { cancelLabel, ...copy } = required.waiting;
  return buildOutcomeSurface({
    uri, app, ...copy, state: 'partial', openLinkUrl: required.signInUrl,
    ...(required.exchangeId ? { cancel: { label: cancelLabel, toolName: required.toolId,
      params: { [SURFACE_EXCHANGE_ID_PARAM]: required.exchangeId, [SURFACE_DISMISSED_PARAM]: true } } } : {}),
    preferredFrameSize: ['100%', '280px'],
  });
}

/** Park one connection watcher; Skip cancels only that watcher, never the enclosing run.
 * OAuth callbacks and credential custody remain with the injected connection owner.
 * @complexity One bounded connection wait, one exchange and at most two emissions.
 * @overallScore 99; Low: connection callbacks must honor their abort signal. */
export async function waitAtSignInCard<Result extends { status: string }>(required: {
  surfaceExchanges: Pick<SurfaceExchangeStore, 'open'>; ctx: ToolExecutionContext; toolId: string;
  card: (state: SignInCardState) => UIResource;
  missingEmitterMessage: string;
  skippedResult: () => Result;
  connect: (input: { signal: AbortSignal; showSignIn: (input: { signInUrl: string }) => Promise<void> }) => Promise<Result>;
}, optional: ToolExecutionOptions = {}): Promise<Result> {
  const { surfaceExchanges, ctx, toolId, card, connect } = required;
  const waiting = new AbortController();
  const signal = AbortSignal.any([ctx.signal, waiting.signal]);
  let exchange: SurfaceExchangeConversation | undefined;
  let skipped = false;
  const closeOnAbort = () => exchange?.close({});
  ctx.signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    ctx.signal.throwIfAborted();
    const result = await connect({ signal, showSignIn: async ({ signInUrl }) => {
      if (!optional.emitSurface) throw new Error(required.missingEmitterMessage);
      ctx.signal.throwIfAborted();
      exchange = surfaceExchanges.open({ binding: { toolId, principalId: ctx.principal.id, channel: 'mcp-ui' }, emit: optional.emitSurface });
      // Register before emission: a fast click may answer while the emitter is still awaiting I/O.
      void exchange.receive({}).then(answer => {
        skipped = answer.status === 'received' && answer.params[SURFACE_DISMISSED_PARAM] === true;
        waiting.abort();
      });
      await exchange.send({ emission: { channel: 'mcp-ui', payload: { resource: card({ state: 'waiting', signInUrl, exchangeId: exchange.id }) } } });
    } });
    if (skipped) {
      await sendFinalCard({ exchange, card, state: 'skipped' });
      return required.skippedResult();
    }
    if (result.status === 'connected') await sendFinalCard({ exchange, card, state: 'connected' });
    return result;
  } finally {
    ctx.signal.removeEventListener('abort', closeOnAbort);
    exchange?.close({});
    waiting.abort();
  }
}

/** A failed human-visible update must never turn a real connection into a tool failure.
 * @complexity O(h), one emission. @overallScore 99; Low: final transport failure is best effort. */
async function sendFinalCard({ exchange, card, state }: {
  exchange: SurfaceExchangeConversation | undefined;
  card: (state: SignInCardState) => UIResource; state: 'connected' | 'skipped';
}, _optional = {}): Promise<void> {
  await exchange?.send({ emission: { channel: 'mcp-ui', payload: { resource: card({ state }) } } }).catch(() => undefined);
}
