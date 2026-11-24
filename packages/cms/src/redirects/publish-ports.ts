import type { RedirectsWriteDeps } from "./redirects.js";

/**
 * @file The `redirect` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`).
 *
 * `redirect`'s one real dependency: the same write-chokepoint deps bag `createRedirect`/`updateRedirect`
 * themselves take.
 */
export type RedirectPublishPorts = RedirectsWriteDeps;
