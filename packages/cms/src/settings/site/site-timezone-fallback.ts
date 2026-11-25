import type { Logger } from "@jini-ai/core/primitives";
import type { SiteTimeZoneFallbackEvent, SiteTimeZoneFallbackReporter } from "./site-timezone.js";

/**
 * @file The host's binding for `@jini-ai/cms`'s timezone fallback reporter. A failed
 * `core.site.timezone` read is logged with the event's fixed text and its safe fields only
 * (`workspaceId`, `errorClass`): the repository error itself is never logged, since its message can
 * echo a connection string or a stored value.
 */

/**
 * A reporter that logs each fallback as an error on the required `logger` (supplied by the host).
 * @complexity O(1).
 */
export function createSiteTimeZoneFallbackReporter(
  { logger }: { logger: Pick<Logger, "error"> },
  _optional: Record<string, never> = {},
): SiteTimeZoneFallbackReporter {
  return (event: SiteTimeZoneFallbackEvent) => {
    logger.error({ message: event.message }, { meta: { workspaceId: event.workspaceId, errorClass: event.errorClass } });
  };
}
