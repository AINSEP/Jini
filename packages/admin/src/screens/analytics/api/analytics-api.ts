import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminAnalyticsHit } from "./analytics-api.types.js";

/** What the host injects into {@link createAnalyticsApi}. */
export interface AnalyticsApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the analytics feature, bound to the host's injected collaborators.
 *  @example const analyticsApi = createAnalyticsApi({ request, workspaceId }); */
export function createAnalyticsApi({ request, workspaceId }: AnalyticsApiDeps, _optional: Record<string, never> = {}) {
  return {
    listRecentAnalyticsHits: (options: { limit?: number } = {}) =>
      request<{ hits: AdminAnalyticsHit[] }>(
        { path: `/workspaces/${workspaceId}/analytics/recent-hits${querySuffix({ query: options.limit ? "limit=" + options.limit : "" })}` }
      ),
  };
}
