/** Host-independent logging contract: diagnostics travel as optional structured data. */
export interface Logger {
  info(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  warn(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  error(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
}

/** Minimal console adapter with a required host-owned prefix and structured metadata. */
export function createConsoleLogger({ prefix }: { prefix: string }): Logger {
  const write = (level: 'info' | 'warn' | 'error', message: string, optional: { meta?: Record<string, unknown>; error?: unknown }) => {
    const args: unknown[] = [prefix ? `${prefix} ${message}` : message];
    if (optional.meta !== undefined) args.push(optional.meta);
    if (optional.error !== undefined) args.push(optional.error);
    console[level](...args);
  };
  return {
    info: ({ message }, optional = {}) => write('info', message, optional),
    warn: ({ message }, optional = {}) => write('warn', message, optional),
    error: ({ message }, optional = {}) => write('error', message, optional),
  };
}
