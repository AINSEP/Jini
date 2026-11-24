import { useCallback } from "react";
import type { QueryKey, QueryResult } from "@jini-ai/core/fetch";
import type { AdminSitesSnapshot } from "@jini-ai/core/contracts/site/admin-sites";
import { useFetchQuery, useInvalidate } from "../../react/kit.js";
import { useContentRefreshSubscription } from "../../shell/hooks/use-content-refresh-subscription.hooks.js";
import { useAdminBootScope } from "../../shell/lib/admin-boot-scope.js";
import type { SitesPort } from "./sites-port.hooks.js";

/** The host's cache key for the site list and the content-refresh resource name it publishes. */
export interface SitesListingScope { listKey: QueryKey; resource: string }

/** Shared Sites read/refresh lifecycle for the screen and its sidebar label.
 * @returns The cached server snapshot, including the current live binding and list status.
 * @complexity O(1) plus the existing cached site-list read.
 */
export function useSitesSnapshot(
  { port, listing }: { port: Pick<SitesPort, "listSites">; listing: SitesListingScope },
  { enabled = true, principalId }: { enabled?: boolean; principalId?: string | null } = {},
): QueryResult<AdminSitesSnapshot> {
  const scope = useAdminBootScope();
  const queryScope = principalId == null ? scope.queryScope : `principal:${principalId}`;
  const list = useFetchQuery({ key: [...listing.listKey, queryScope], fetch: () => port.listSites() }, { enabled: enabled && !scope.checking });
  // Stable identity (not an inline arrow) so the subscription effect does not resubscribe every
  // render — same note as `Jini redirects/react/hooks/use-redirects.hooks.ts`'s own `invalidateList`.
  const invalidate = useInvalidate();
  const invalidateList = useCallback(() => invalidate({ key: listing.listKey }), [invalidate, listing.listKey]);
  useContentRefreshSubscription({ resource: listing.resource, onRefresh: invalidateList });
  return list;
}
