import type { Logger } from "@jini-ai/core/primitives";
import type {
  PreserveLegacySiteTitlesResult,
  SiteTitleFailureEvent,
  SiteTitleFailureReporter,
  SiteTitlePreservationSummaryReporter,
} from "./site-title.js";

/**
 * @file The host's bindings for `@jini-ai/cms`'s site-title reporters. A failed pin or render read
 * is logged with the event's fixed text and its safe fields only (`workspaceId`, `errorClass`): the
 * thrown error itself is never logged, since its message can echo a connection string or a stored
 * value. The same rule as `site-timezone-fallback.ts`.
 */

/**
 * A reporter that logs each site-title failure as an error on the required `logger` (supplied by the host).
 * @complexity O(1).
 */
export function createSiteTitleFailureReporter(
  { logger }: { logger: Pick<Logger, "error"> },
  _optional: Record<string, never> = {},
): SiteTitleFailureReporter {
  return (event: SiteTitleFailureEvent) => {
    const meta = event.errorClass === undefined ? { workspaceId: event.workspaceId } : { workspaceId: event.workspaceId, errorClass: event.errorClass };
    logger.error({ message: event.message }, { meta });
  };
}

/**
 * A reporter that logs one preservation run's counts as info on the required `logger` (supplied by the host).
 * @complexity O(1).
 */
export function createSiteTitlePreservationSummaryReporter(
  { logger }: { logger: Pick<Logger, "info"> },
  _optional: Record<string, never> = {},
): SiteTitlePreservationSummaryReporter {
  return (result: PreserveLegacySiteTitlesResult) => {
    logger.info({
      message: `preserveLegacySiteTitles: pinned=${result.pinnedWorkspaceIds.length} skipped=${result.skippedWorkspaceIds.length} failed=${result.failedWorkspaceIds.length}`,
    });
  };
}
