/**
 * @file Holds a store close until the boot work the composition started and never awaited has
 * settled, within a bound.
 *
 * Two passes outlive the host's route-deps/app composition returning: the detached legacy
 * publish-credential tail (`RouteDeps.legacyPublishCredentialsReady`) and the BYOK tool surface's
 * installed-extension pass (`createApp`'s `onBootWork`). Both read the store. A site stopped within
 * seconds of boot closed the store under them, and they logged "The database connection is not
 * open" (PGlite: "driver has already been destroyed"). Neither pass takes an abort signal, so the
 * close waits for them instead; the bound keeps a hung pass from hanging shutdown.
 */

import type { Logger } from "@jini-ai/core/primitives";

/** How long a close waits for boot work. Half of `closeWithinBound`'s 4 s, so the close itself
 *  still gets the other half when both run under that one bound (the CLI serve command's shutdown). */
const DEFAULT_BOOT_WORK_TIMEOUT_MS = 2_000;

/**
 * Resolves once every promise in `work` has settled, or after `timeoutMs` (default 2 s), whichever
 * comes first. Never rejects: each pass logs its own failure, and a rejected pass must not stop the
 * close that follows. A pass still running at the bound is logged on `required.logger` and abandoned.
 *
 * @complexity O(n) in the number of passes.
 */
export function awaitBootWorkWithinBound(
  required: { work: readonly Promise<unknown>[]; logger: Logger },
  optional: { timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = optional.timeoutMs ?? DEFAULT_BOOT_WORK_TIMEOUT_MS;
  const { logger } = required;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.error({ message: `[shutdown] boot work did not settle within ${timeoutMs} ms; closing the store anyway` });
      resolve();
    }, timeoutMs);
    timer.unref();
    void Promise.allSettled(required.work).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
