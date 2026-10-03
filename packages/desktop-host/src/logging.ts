/**
 * Generalized from OD `apps/packaged/src/logging.ts`. The file-append
 * logger, the console-shim (so `console.log`/`warn`/`error` also land in
 * the log file), and the fatal-`uncaughtException`/`unhandledRejection`
 * handler-that-removes-itself-then-rethrows pattern are all genuinely
 * generic Electron/Node main-process concerns. Dropped: everything tied to
 * OD's `PackagedNamespacePaths`/`SidecarStamp` (the log path and any
 * startup metadata are now plain caller-supplied strings), and the
 * `OD_DESKTOP_LOG_ECHO` env var name (now a plain boolean option). The
 * "harmless setTypeOfService EINVAL" filter is kept as the *default*
 * predicate (it's a real, still-relevant undici/macOS quirk any Electron
 * app embedding fetch can hit) but is now overridable — a generic host
 * package should not hardcode that a caller's error taxonomy matches OD's.
 */
import { appendFileSync } from 'node:fs';
import type { Logger } from '@jini-ai/core/primitives';

type LogLevel = 'error' | 'info' | 'warn';

function normalizeError(error: unknown): unknown {
  if (error instanceof Error) return { message: error.message, name: error.name, stack: error.stack };
  return error;
}

// `meta` is always defined at this call site (see `serializeMessage`'s
// `meta == null` guard below) — that guard is the single source of truth
// for the null check, so this helper takes a required parameter rather
// than duplicating a defensive (and therefore untestable/dead) check.
function normalizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [key, key === 'error' || key === 'reason' ? normalizeError(value) : value]),
  );
}

function serializeMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  try {
    return `${JSON.stringify({ level, message, timestamp, ...(meta == null ? {} : { meta: normalizeMeta(meta) }) })}\n`;
  } catch (error) {
    return `${JSON.stringify({
      level,
      message,
      timestamp,
      meta: { serializationError: error instanceof Error ? error.message : String(error) },
    })}\n`;
  }
}

export type LogAppend = (args: { path: string; data: string; encoding: BufferEncoding }) => void;

export function appendLogLine({ logPath, line }: { logPath: string; line: string }, { append = ({ path, data, encoding }) => appendFileSync(path, data, encoding) }: { append?: LogAppend } = {}): boolean {
  try {
    append({ path: logPath, data: line, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

export function createFileLogger({ logPath }: { logPath: string }, options: { echoToConsole?: boolean; append?: LogAppend } = {}): Logger {
  const echo = options.echoToConsole ?? true;
  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    appendLogLine({ logPath, line: serializeMessage(level, message, meta) }, options.append === undefined ? {} : { append: options.append });
  };
  const logger: Logger = {
    error({ message }, { meta, error } = {}) {
      write('error', message, error === undefined ? meta : { ...meta, error });
      if (echo) console.error(message, error === undefined ? meta ?? '' : { ...meta, error });
    },
    info({ message }, { meta, error } = {}) {
      write('info', message, error === undefined ? meta : { ...meta, error });
      if (echo) console.info(message, error === undefined ? meta ?? '' : { ...meta, error });
    },
    warn({ message }, { meta, error } = {}) {
      write('warn', message, error === undefined ? meta : { ...meta, error });
      if (echo) console.warn(message, error === undefined ? meta ?? '' : { ...meta, error });
    },
  };
  return logger;
}

/**
 * Matches the known-harmless undici `setTypeOfService EINVAL` shape (see
 * OD issue #895): certain macOS/VPN configurations refuse to let the
 * kernel set the outbound socket's IP_TOS byte, which has no functional
 * effect on the request. `code` is authoritative when present.
 */
export function isHarmlessSocketOptionError({ value }: { value: unknown }): boolean {
  if (!(value instanceof Error)) return false;
  const message = typeof value.message === 'string' ? value.message : '';
  if (!message || !message.includes('setTypeOfService')) return false;
  const code = (value as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && code.length > 0) return code === 'EINVAL';
  return message.includes('EINVAL');
}

export interface InstallFatalExceptionHandlersOptions {
  isHarmless?: (args: { value: unknown }) => boolean;
}

/**
 * Installs `uncaughtException`/`unhandledRejection` handlers that log and
 * swallow harmless errors, and for anything else remove themselves before
 * re-throwing via `setImmediate` — without detaching first, the re-throw
 * would re-enter the same handler and loop forever instead of letting
 * Node's default crash path (and Electron's native error dialog) take
 * over. Returns a function that uninstalls both handlers.
 */
export function installFatalExceptionHandlers({ logger }: { logger: Logger }, options: InstallFatalExceptionHandlersOptions = {}
): () => void {
  const isHarmless = options.isHarmless ?? isHarmlessSocketOptionError;

  const onUncaughtException = (error: unknown): void => {
    if (isHarmless({ value: error })) {
      logger.warn({ message: 'swallowed harmless uncaught exception' }, { meta: { error } });
      return;
    }
    logger.error({ message: 'fatal uncaught exception' }, { meta: { error } });
    process.removeListener('uncaughtException', onUncaughtException);
    setImmediate(() => {
      throw error;
    });
  };

  const onUnhandledRejection = (reason: unknown): void => {
    if (isHarmless({ value: reason })) {
      logger.warn({ message: 'swallowed harmless unhandled rejection' }, { meta: { reason } });
      return;
    }
    logger.error({ message: 'fatal unhandled rejection' }, { meta: { reason } });
    process.removeListener('unhandledRejection', onUnhandledRejection);
    setImmediate(() => {
      throw reason;
    });
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  return () => {
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
  };
}
