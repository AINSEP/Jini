import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminCommentsQueuePage, CommentStatus } from "./comments-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries and
 *  error decoding, so this client only names the method, path and body. */
export type CommentsRequestFn = <T>(required: { method: string; path: string; body?: unknown }) => Promise<T>;

/** What the host injects: its authenticated request and the workspace every path is scoped to. */
export interface CreateCommentsApiArgs { request: CommentsRequestFn; workspaceId: string }

/** The admin API calls of the comments feature, bound to the host's injected `request`.
 *  @example const commentsApi = createCommentsApi({ request, workspaceId }); */
export function createCommentsApi({ request, workspaceId }: CreateCommentsApiArgs, _optional: Record<string, never> = {}) {
  return {
    // Comments — the dashboard reads the queue here; moderation and settings use Jini.
    // Mirrors `getDatabaseTimeline`'s query-param-building shape for the paginated queue read.
    listCommentsQueue: (options: { status?: CommentStatus; cursor?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.limit) params.set("limit", String(options.limit));
      const qs = params.toString();
      return request<AdminCommentsQueuePage>({ method: "GET", path: `/workspaces/${workspaceId}/comments/queue${querySuffix({ query: qs })}` });
    },
  };
}
