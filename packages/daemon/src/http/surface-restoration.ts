import type { SurfaceExchangeStore } from '@jini-ai/core';
import { jsonResponse, type SseSchedulerPort } from '@jini-ai/core/contracts/server';
import { createCommitLatch } from './sse-commit.js';
import { createLineStream, type LineStream } from './line-stream.js';

/** `handled: false` means nothing was written or decided: the caller may fall back (another process may own the exchange). */
export type SurfaceHttpResult = { readonly handled: false } | { readonly handled: true; readonly response: Response };

/** Keepalive interval for a restored card: a legitimate human wait must not expire at the proxy hop's idle-body limit. */
const KEEPALIVE_MS = 15_000;

/** Stream a restored card through the existing authenticated callback route. Only the exchange
 * handle is accepted: tool identity, principal and original arguments come from the shared store.
 * Returns `{ handled: false }` with nothing written when another process may own the exchange.
 * The first card frame opens the answer (200, newline-delimited JSON) and starts the keepalive; a
 * restore that fails before any frame answers 409 instead, and one that finds nothing answers
 * `{ handled: false }`. `signal` aborts the store's restore when the caller goes away.
 * @complexity O(emitted bytes); no answer or credential is retained by this adapter.
 */
export async function restoreSurface({ store, exchangeId, principalId, toolId, scheduler, signal }: {
  readonly store: SurfaceExchangeStore; readonly exchangeId: string; readonly principalId: string; readonly toolId: string;
  readonly scheduler: SseSchedulerPort; readonly signal: AbortSignal;
}, { params }: { readonly params?: Record<string, unknown> } = {}): Promise<SurfaceHttpResult> {
  if (!store.restore) return { handled: false };
  const opened = createCommitLatch();
  let lines: LineStream | undefined;
  const write = (value: unknown): void => {
    if (!lines) {
      // The first frame commits the answer; the line stream's keepalive cannot start before it.
      lines = createLineStream({ scheduler, signal }, { keepAliveMs: KEEPALIVE_MS });
      opened.commit({ response: lines.response });
    }
    lines.write({ line: value });
  };
  const outcome = (async (): Promise<SurfaceHttpResult> => {
    try {
      const result = await store.restore!({ exchangeId, principalId, emit: async emission => { write({ type: 'surface', emission }); } },
        { toolId, signal, ...(params === undefined ? {} : { params }) });
      if (!result.ok && !lines) {
        if (result.reason === 'unknown-or-closed') return { handled: false };
        return { handled: true, response: jsonResponse({ status: 409, body: { code: 'SURFACE_NOT_PENDING', reason: result.reason } }) };
      }
      write({ type: 'restored', ...result });
    } catch {
      // Failure messages may contain host or credential details. Restoration never reports them.
      write({ type: 'restored', ok: false });
    }
    lines?.end();
    return { handled: true, response: lines!.response };
  })();
  return Promise.race([opened.response.then((response): SurfaceHttpResult => ({ handled: true, response })), outcome]);
}
