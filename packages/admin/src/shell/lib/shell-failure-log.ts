/**
 * @file Where the shell's browser-tab buses report a subscriber that threw. The buses are
 * module-scope singletons with no args object to carry a logger, so the host binds one at its
 * composition root (once, before render). Jini writes no console output of its own: an unbound
 * report is dropped, and listener isolation (one throwing subscriber never stops the rest) holds
 * either way. The bound logger owns redaction; the caught value travels as `error`, never in the
 * message text, so a logger that describes errors safely (core `createConsoleLogger`) never prints it raw.
 */

/** The one logger method the buses call: structurally a subset of core's `Logger`. */
export interface ShellFailureLogger {
  error(required: { message: string }, optional?: { error?: unknown }): void;
}

let bound: ShellFailureLogger | undefined;

/**
 * Binds the host's logger for every shell bus. Rebinding replaces the previous logger.
 * @returns Unbind, restoring the drop-silently default (tests and hot reload).
 * @example bindShellFailureLogger({ logger: createConsoleLogger({ prefix: "[admin]" }) })
 */
export function bindShellFailureLogger({ logger }: { logger: ShellFailureLogger }, _options: Record<string, never> = {}): () => void {
  bound = logger;
  return () => {
    if (bound === logger) bound = undefined;
  };
}

/**
 * Reports one subscriber failure through the bound logger. Never throws: a logger that throws
 * must not break the publish loop that called it.
 * @complexity O(1).
 */
export function reportShellFailure({ message, error }: { message: string; error: unknown }, _options: Record<string, never> = {}): void {
  try {
    bound?.error({ message }, { error });
  } catch {
    // The logger itself failed; nothing safer is left to report it to, and the bus must keep going.
  }
}
