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
import { describeErrorForLog } from '@jini-ai/core/model-facing-tool-errors';
import { describeLogMeta, type LogDiagnosticsSink, type Logger } from '@jini-ai/core/primitives';

type LogLevel = 'error' | 'info' | 'warn';

// The file line and the console echo carry safe metadata only: `error`/`reason` (and any
// Error-valued meta) are written as their class + approved code, never message, name or stack. A
// caught error's text can quote untrusted input or a credential, and a host's console tee cannot
// protect this file write. Full detail goes only to an injected `diagnostics` sink.
// `meta` is always defined at the `describeLogMeta` call (see `serializeMessage`'s `meta == null`
// guard below) — that guard is the single source of truth for the null check.
function serializeMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  try {
    return `${JSON.stringify({ level, message, timestamp, ...(meta == null ? {} : { meta: describeLogMeta({ meta }) }) })}\n`;
  } catch (error) {
    // The serializer's own error is described like any other: its text can name meta content.
    return `${JSON.stringify({
      level,
      message,
      timestamp,
      meta: { serializationError: describeErrorForLog({ err: error }) },
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

/** Where echoed lines go; defaults to the process's global `console`. */
export type LogConsole = Pick<Console, 'error' | 'info' | 'warn'>;

/**
 * File logger (JSON lines) with an optional console echo. Both carry safe metadata only (see
 * `serializeMessage`). A host that wants the full error injects `diagnostics`: it receives every
 * call unchanged, after the file line; a throwing sink is recorded (class only) and never throws.
 * @complexity O(meta entries) per call plus one append.
 */
export function createFileLogger({ logPath }: { logPath: string }, options: { echoToConsole?: boolean; append?: LogAppend; console?: LogConsole; diagnostics?: LogDiagnosticsSink } = {}): Logger {
  const echo = options.echoToConsole ?? true;
  const out = options.console ?? console;
  const appendOptions = options.append === undefined ? {} : { append: options.append };
  const write = (level: LogLevel, message: string, { meta, error }: { meta?: Record<string, unknown>; error?: unknown }) => {
    const merged = error === undefined ? meta : { ...meta, error };
    appendLogLine({ logPath, line: serializeMessage(level, message, merged) }, appendOptions);
    if (echo) out[level](message, merged === undefined ? '' : describeLogMeta({ meta: merged }));
    if (options.diagnostics !== undefined) deliverDiagnostics({ diagnostics: options.diagnostics, level, message, meta, error }, { write: line => appendLogLine({ logPath, line }, appendOptions) });
  };
  return {
    error: ({ message }, optional = {}) => write('error', message, optional),
    info: ({ message }, optional = {}) => write('info', message, optional),
    warn: ({ message }, optional = {}) => write('warn', message, optional),
  };
}

function deliverDiagnostics(
  { diagnostics, level, message, meta, error }: { diagnostics: LogDiagnosticsSink; level: LogLevel; message: string; meta?: Record<string, unknown>; error?: unknown },
  { write }: { write: (line: string) => void },
): void {
  try {
    diagnostics({ level, message, ...(meta === undefined ? {} : { meta }), ...(error === undefined ? {} : { error }) });
  } catch (sinkError) {
    // The host sink failed: the file line above already recorded the call; record the sink's own
    // failure (class only) so it is not lost, and never throw from a log call.
    write(serializeMessage('warn', 'diagnostics sink failed', { error: sinkError }));
  }
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
