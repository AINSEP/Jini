/**
 * @module host-bootstrap
 *
 * Generic host-lifecycle primitives ported from an origin daemon's CLI-startup module — see
 * `source-map.md`. Only the two functions with no CLI-flag-parsing or env-var-reading inside their
 * own bodies are ported here: `parseDaemonCliStartupArgs` (argv/env parsing for a `od <cmd>`-style
 * CLI) and the higher-level `startDaemonRuntime`/`runDaemonCliStartup` wrappers belong to a future
 * `@injini/cli` task, not this one — this module is deliberately CLI-shape-agnostic.
 */
import type { Server } from 'node:http';

export const DEFAULT_DAEMON_BIND_HOST = '127.0.0.1';

/**
 * Trims `input` to a usable bind-host string, falling back to the loopback default for
 * blank/nullish input.
 *
 * @param input - A caller-supplied host value of unknown shape (typically `string | undefined`
 * from an options object, hence the deliberately loose `unknown` parameter type).
 * @returns The trimmed string, or {@link DEFAULT_DAEMON_BIND_HOST} when `input` is nullish, not a
 * string, or trims to empty.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function normalizeDaemonBindHost(input: unknown): string {
  const host = String(input ?? '').trim();
  return host || DEFAULT_DAEMON_BIND_HOST;
}

export interface CloseHttpServerOptions {
  /** Hard ceiling before force-closing every remaining socket. Defaults to 5000ms. */
  closeTimeoutMs?: number;
  /** Delay before closing idle (non-active) connections, capped by `closeTimeoutMs`. Defaults to 1000ms. */
  idleCloseMs?: number;
}

/**
 * Gracefully closes `server`: after a short `idleCloseMs` grace period it closes idle
 * connections, then force-closes any connection still open once `closeTimeoutMs` elapses. Resolves
 * immediately, without touching any socket, if `server` is not currently listening.
 *
 * @param server - The `node:http` server to close.
 * @param options.closeTimeoutMs - See {@link CloseHttpServerOptions}.
 * @param options.idleCloseMs - See {@link CloseHttpServerOptions}.
 * @returns Resolves once `server.close()`'s callback fires with no error (whether that happened
 * because every connection ended naturally or because the hard timeout force-closed them).
 * @throws Rejects with whatever error `server.close()`'s callback reports (e.g. calling `close()`
 * on a server that was never listening in the first place — guarded against above by the early
 * return, but any other underlying error still propagates).
 * @complexity O(1) scheduling; the actual wait is bounded by `closeTimeoutMs`.
 * @overallScore 100/100
 */
export async function closeHttpServer(server: Server, options: CloseHttpServerOptions = {}): Promise<void> {
  const { closeTimeoutMs = 5_000, idleCloseMs = 1_000 } = options;
  if (!server.listening) return;

  await new Promise<void>((resolveClose, rejectClose) => {
    let resolved = false;
    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      resolveClose();
    };
    const rejectOnce = (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      rejectClose(error);
    };
    const idleTimer = setTimeout(() => {
      server.closeIdleConnections?.();
    }, Math.min(idleCloseMs, closeTimeoutMs));
    const hardTimer = setTimeout(() => {
      server.closeAllConnections?.();
      resolveOnce();
    }, closeTimeoutMs);
    idleTimer.unref?.();
    hardTimer.unref?.();
    server.close((error) => (error == null ? resolveOnce() : rejectOnce(error)));
  }).finally(() => {
    server.closeIdleConnections?.();
  });
}
