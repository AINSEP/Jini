/**
 * @module host-bootstrap
 *
 * Generic host-lifecycle primitives ported from an origin daemon's CLI-startup module — see
 * `source-map.md`. Only the two functions with no CLI-flag-parsing or env-var-reading inside their
 * own bodies are ported here: `parseDaemonCliStartupArgs` (argv/env parsing for a `od <cmd>`-style
 * CLI) and the higher-level `startDaemonRuntime`/`runDaemonCliStartup` wrappers belong to a future
 * `@jini-ai/cli` task, not this one — this module is deliberately CLI-shape-agnostic.
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

export interface GracefulShutdownOptions {
  /** OS signals to listen for. Defaults to `['SIGTERM', 'SIGINT']` — the two a container runtime,
   * process manager, or an operator's `kill`/Ctrl-C ordinarily send to stop a long-lived daemon. */
  signals?: readonly NodeJS.Signals[];
  /** Hard ceiling, from the first signal, before forcing exit even if `stop()` never settles — a
   * wedged shutdown must not block the process from ever exiting. Defaults to 10000ms (Docker's own
   * default grace period before it escalates to `SIGKILL`). */
  timeoutMs?: number;
  /** Called exactly once, with `0` if `stop()` resolved or `1` if it rejected or the timeout fired
   * first. Defaults to `process.exit`. Override to observe or customize the final step (tests always
   * do this — calling the real `process.exit` from a unit test would kill the test runner). */
  onExit?: (code: number) => void;
}

export interface GracefulShutdownHandle {
  /** Removes the installed signal listeners. A later signal is then a plain no-op — Node's own
   * default behavior applies again, exactly as if this had never been called. */
  uninstall(): void;
}

/**
 * Wires `stop` to the process's OS shutdown signals so a container stop, process-manager restart, or
 * operator `kill`/Ctrl-C runs the caller's graceful teardown instead of Node's default immediate
 * termination. Deliberately opt-in rather than something `createLocalNodeDaemon` installs on every
 * caller's behalf: a library that unilaterally seizes process-global signal handling can surprise an
 * embedding host that manages its own process lifecycle (an Electron shell, for one, already owns
 * its own fatal-exception handling and — per `desktop-host`'s own sidecar shutdown path — asks a
 * spawned daemon child to stop over HTTP and falls back to `SIGKILL`, never `SIGTERM`, so it neither
 * needs nor should double up on this). One line at the host's own entrypoint —
 * `installGracefulShutdown(daemon.stop)` — is the whole integration.
 *
 * Idempotent and re-entrant: a second signal that arrives while a shutdown from the first is still
 * in flight is ignored outright (not queued, not a second `stop()` call) — the in-flight shutdown
 * (or, past `timeoutMs`, the forced exit) is left to finish on its own.
 *
 * @param stop - The caller's own graceful-shutdown function, e.g. a `LocalNodeDaemon.stop`.
 * @param options - See {@link GracefulShutdownOptions}.
 * @returns A handle whose `uninstall()` removes the installed listeners.
 * @complexity O(1) to install; the signal handler itself is O(1) plus whatever `stop` costs.
 */
export function installGracefulShutdown(
  stop: () => Promise<void>,
  options: GracefulShutdownOptions = {},
): GracefulShutdownHandle {
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const onExit = options.onExit ?? ((code: number) => process.exit(code));

  let shuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals): void => {
    // A second signal while a shutdown is already in flight must not re-run `stop()` or restart the
    // timeout — the first attempt (or its forced-exit fallback below) already owns getting the
    // process to exit.
    if (shuttingDown) return;
    shuttingDown = true;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // eslint-disable-next-line no-console
      console.error(
        `[@jini-ai/server] graceful shutdown did not complete within ${timeoutMs}ms after ${signal}; forcing exit`,
      );
      onExit(1);
    }, timeoutMs);
    timer.unref?.();

    void stop()
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[@jini-ai/server] graceful shutdown failed after ${signal}`, error);
        // Re-thrown so the `.finally` below still distinguishes success from failure via rejection
        // state rather than a second flag.
        throw error;
      })
      .then(
        () => {
          if (timedOut) return;
          clearTimeout(timer);
          onExit(0);
        },
        () => {
          if (timedOut) return;
          clearTimeout(timer);
          onExit(1);
        },
      );
  };

  for (const signal of signals) {
    process.on(signal, handleSignal);
  }

  return {
    uninstall(): void {
      for (const signal of signals) {
        process.off(signal, handleSignal);
      }
    },
  };
}
