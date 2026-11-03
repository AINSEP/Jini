import type { Response } from 'express';
import type { SurfaceExchangeStore } from '@jini-ai/core';

/** Stream a restored card through the existing authenticated callback route. Only the exchange
 * handle is accepted: tool identity, principal and original arguments come from the shared store.
 * Returns false without writing a response when another process may own the exchange.
 * @complexity O(emitted bytes); no answer or credential is retained by this adapter.
 */
export async function tryRestoreSurface({ res, store, exchangeId, principalId, toolId }: {
  res: Response; store: SurfaceExchangeStore; exchangeId: string; principalId: string; toolId: string;
}, { params }: { params?: Record<string, unknown> } = {}): Promise<boolean> {
  if (!store.restore) return false;
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', onClose);
  const write = (value: unknown) => {
    if (res.destroyed) return;
    if (!res.headersSent) res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    res.write(`${JSON.stringify(value)}\n`);
  };
  // The first card frame opens the response. Subsequent heartbeats keep Node fetch's idle-body
  // limit from expiring a legitimate human wait at the proxy hop.
  const heartbeat = setInterval(() => { if (res.headersSent) write({ type: 'keepalive' }); }, 15_000);
  heartbeat.unref();
  try {
    const result = await store.restore({ exchangeId, principalId, emit: async emission => {
      write({ type: 'surface', emission });
    } }, { toolId, signal: controller.signal, ...(params === undefined ? {} : { params }) });
    if (!result.ok && result.reason === 'unknown-or-closed' && !res.headersSent) return false;
    if (!result.ok && !res.headersSent) {
      res.status(409).json({ code: 'SURFACE_NOT_PENDING', reason: result.reason });
      return true;
    }
    write({ type: 'restored', ...result });
    res.end();
    return true;
  } catch {
    // Failure messages may contain host or credential details. Restoration never reports them.
    write({ type: 'restored', ok: false });
    res.end();
    return true;
  } finally { clearInterval(heartbeat); res.off('close', onClose); }
}
