/** @file Typed error for a provider plugin whose boot load outlasted its deadline. */

/**
 * A provider plugin's import + setup outlasted its boot deadline. Its message is built only from the
 * deadline number, so unlike an arbitrary plugin error it is safe to log verbatim (the log describer
 * prints only a class label, which would hide that this was a timeout rather than a failure).
 */
export class ProviderLoadTimeoutError extends Error {
  constructor({ timeoutMs }: { timeoutMs: number }) {
    super(`provider plugin load timed out after ${timeoutMs} ms`);
    this.name = 'ProviderLoadTimeoutError';
  }
}
